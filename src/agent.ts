// The agent loop from The Agent Loop, with a place for each defence.
// The model is the brain. This file and the tools decide what actually happens.
//
//   ask the model ──► wants tools? ──no──► that's the answer
//         ▲               │ yes
//         │               ▼
//         └──── run them (checked), send the results back

import { TODAY_LABEL, type User } from "./data/guesthouse.js";
import { BOUNDARY_RULES, labelled, type Source } from "./defences/boundaries.js";
import { actingAs } from "./defences/identity.js";
import type { DefenceId, Defences } from "./defences/index.js";
import { checkScope, describeRemoved, extractScope, normalise, type Scope } from "./defences/intent.js";
import { Breaker } from "./defences/once.js";
import { changedDefinitions } from "./defences/pinned.js";
import type { Lab } from "./lab.js";
import { agentTurn, textOf, toolCallsOf, type Call, type MessageParam, type ToolResult } from "./model.js";
import type { Store } from "./store.js";
import { Refused, ToolError, type RunState, type ToolContext } from "./tools/core.js";
import { currentTools, PINNED } from "./tools/index.js";

export type StopReason = "done" | "max_turns" | "circuit_open" | "max_tokens" | "refusal" | "other";

/** Everything that happened in a run, in order. The terminal and the app both draw these. */
export type AgentEvent =
  | { type: "request"; user: User; text: string }
  | { type: "scope"; scope: Scope }
  | { type: "model"; text: string }
  | { type: "tool_call"; name: string; input: Record<string, unknown> }
  | { type: "tool_result"; name: string; text: string; ok: boolean; defence?: DefenceId }
  | { type: "defence"; defence: DefenceId; text: string }
  | { type: "stop"; reason: StopReason; turns: number };

export interface RunOptions {
  request: string;
  /** Who is signed in, from the session cookie. Never from the chat. */
  session: User;
  defences: Defences;
  store: Store;
  lab: Lab;
  /** Which sample request this is, so replay mode knows which script to play. */
  sample?: string;
  maxTurns?: number;
  onEvent?: (event: AgentEvent) => void;
}

export interface RunResult {
  events: AgentEvent[];
  calls: Call[];
  answer: string;
  stoppedBecause: StopReason;
}

export async function runAgent(options: RunOptions): Promise<RunResult> {
  const { request, session, defences, store, lab, maxTurns = 10 } = options;
  const replayKey = options.sample ?? "custom";
  const events: AgentEvent[] = [];
  const calls: Call[] = [];
  const emit = (event: AgentEvent) => {
    events.push(event);
    options.onEvent?.(event);
  };
  const finish = (stoppedBecause: StopReason, turns: number, answer = ""): RunResult => {
    emit({ type: "stop", reason: stoppedBecause, turns });
    return { events, calls, answer, stoppedBecause };
  };

  const run: RunState = { request, scope: null, untrustedRead: [], recalled: [], refunds: { count: 0, total: 0 }, breaker: new Breaker() };
  emit({ type: "request", user: session, text: request });

  // Lesson 2: pin down what was asked before the agent has read a single untrusted word.
  if (defences.intent) {
    run.scope = await extractScope(request, calls, `scope:${replayKey}`);
    emit({ type: "scope", scope: run.scope });
  }

  const ctx: ToolContext = {
    user: actingAs(session, defences), // lesson 4: the signed-in person, or a service account
    session,
    defences,
    store,
    lab,
    run,
    outside(source, text) {
      let out = text;
      if (defences.intent) {
        // Lesson 2: the model reads what a person would see, and the transcript says what went.
        const clean = normalise(text);
        const removed = describeRemoved(clean.removed);
        if (removed) emit({ type: "defence", defence: "intent", text: `Removed ${removed} from ${sourceName(source)} before the model saw it.` });
        out = clean.text;
      }
      // Lesson 1, and lesson 6 for notes: labelled data, with where it came from.
      return defences.boundaries || (source.kind === "note" && defences.memory) ? labelled(source, out) : out;
    },
  };

  const system = systemPrompt(session, defences);
  const messages: MessageParam[] = [{ role: "user", content: request }];

  for (let turn = 1; turn <= maxTurns; turn++) {
    // Lesson 6: definitions were hashed at startup. One that has changed is not offered to the model.
    const tools = currentTools(lab);
    const drift = defences.memory ? changedDefinitions(tools.map((t) => t.tool), PINNED) : [];
    const drifted = drift.map((d) => d.name);
    for (const d of turn === 1 ? drift : []) {
      emit({
        type: "defence",
        defence: "memory",
        text: `${d.name}'s definition has changed since startup (sha256 ${d.pinned?.slice(0, 8) ?? "none"} → ${d.now.slice(0, 8)}). It isn't offered to the model, and calls to it are refused.`,
      });
    }
    const offered = tools.filter((t) => !drifted.includes(t.tool.name));

    const reply = await agentTurn({ step: "agent", system, messages, tools: offered.map((t) => t.tool), replayKey: `agent:${replayKey}`, calls });
    const text = textOf(reply);
    if (text) emit({ type: "model", text });

    // Only run tools when the model actually finished asking for them.
    if (reply.stop_reason !== "tool_use") {
      const reason: StopReason =
        reply.stop_reason === "end_turn" ? "done" : reply.stop_reason === "max_tokens" || reply.stop_reason === "refusal" ? reply.stop_reason : "other";
      return finish(reason, turn, text);
    }

    messages.push({ role: "assistant", content: reply.content });
    const results: ToolResult[] = [];
    for (const call of toolCallsOf(reply)) {
      const input = (call.input ?? {}) as Record<string, unknown>;
      emit({ type: "tool_call", name: call.name, input });
      const outcome = await runTool(call.name, input, ctx, drifted);
      emit({ type: "tool_result", name: call.name, ...outcome });
      results.push({ type: "tool_result", tool_use_id: call.id, content: outcome.text, ...(outcome.ok ? {} : { is_error: true }) });
      if (defences.once) run.breaker.record(outcome.ok);
    }
    messages.push({ role: "user", content: results });

    // Lesson 5: three errors in a row means something is wrong that another try won't fix.
    if (defences.once && run.breaker.open) {
      const message = "Stopped after three tool errors in a row. Nothing more will be tried in this run. A person should take a look.";
      emit({ type: "defence", defence: "once", text: message });
      return finish("circuit_open", turn, message);
    }
  }
  return finish("max_turns", maxTurns);
}

async function runTool(name: string, input: Record<string, unknown>, ctx: ToolContext, drifted: string[]) {
  const agentTool = currentTools(ctx.lab).find((t) => t.tool.name === name);
  try {
    if (!agentTool) throw new ToolError(`Unknown tool "${name}".`);
    if (drifted.includes(name)) throw new Refused("memory", `${name} is switched off: its definition changed while the app was running.`);
    if (ctx.run.scope) {
      const problem = checkScope(ctx.run.scope, name, input, ctx.store); // lesson 2
      if (problem) throw new Refused("intent", problem);
    }
    return { ok: true, text: await agentTool.run(input, ctx) };
  } catch (error) {
    if (!(error instanceof ToolError)) throw error; // our bug, not the model's: crash loudly
    return { ok: false, text: error.message, ...(error instanceof Refused ? { defence: error.defence } : {}) };
  }
}

export function systemPrompt(session: User, defences: Defences) {
  return [
    `You are the assistant at tiny-stay, a four-room guesthouse in Porthwen. Today is ${TODAY_LABEL}.`,
    `Signed in: ${session.name} (${session.role})${session.email ? `, ${session.email}` : ""}.`,
    "Use the tools to look things up and make changes. Keep answers short and plain. Markdown is fine: bold, links, lists, code.",
    "House rules: guests may only see their own bookings. Receptionists may refund up to £100 at a time. Only the owner exports the ledger.",
    ...(defences.boundaries ? [BOUNDARY_RULES] : []),
  ].join("\n\n");
}

function sourceName(source: Source) {
  if (source.kind === "page") return source.from ?? source.id;
  return `${source.kind} ${source.id}`;
}
