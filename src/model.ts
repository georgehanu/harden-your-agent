// Every model call goes through this file.
//
//   askJson()    one model call, JSON back, shaped by a JSON schema (the intent anchor in lesson 2)
//   agentTurn()  one turn of the agent loop: the conversation and the tools in, the model's next move out
//
// Live mode calls Claude with the official Anthropic SDK.
// Replay mode plays pre-written turns for the sample requests, so everything runs without an API key.
// The loop, the tools and every defence are the same real code in both modes.

import "./env.js";
import Anthropic from "@anthropic-ai/sdk";
import { REPLAYS, SCRIPTS } from "./replays.js";

/** Two models: a strong one runs the agent, a fast cheap one does the small structured step. */
export const MODELS = {
  smart: process.env.SMART_MODEL || "claude-opus-5-5",
  fast: process.env.FAST_MODEL || "claude-haiku-5-5",
};

// USD per million tokens (input, output). Check current prices before relying on these.
const PRICES: Record<string, [number, number]> = {
  "claude-opus-5-5": [4, 20],
  "claude-haiku-5-5": [0.1, 0.5],
};

export const live = Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
const client = live ? new Anthropic() : null;

export type Message = Anthropic.Beta.BetaMessage;
export type MessageParam = Anthropic.Beta.BetaMessageParam;
export type Tool = Anthropic.Beta.BetaTool;
export type ToolUseBlock = Anthropic.Beta.BetaToolUseBlock;
export type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;

export interface Call {
  step: string;
  model: string;
  ms: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface AskOptions {
  /** Shown in traces and the UI, e.g. "scope". */
  step: string;
  model: keyof typeof MODELS;
  system: string;
  prompt: string;
  effort?: "low" | "medium" | "high";
  /** Which pre-written answer to use in replay mode. */
  replayKey: string;
  /** Collects one entry per call, for the cost line under each run. */
  calls: Call[];
}

/** The AI step failed. Callers catch this and show the message instead of crashing. */
export class AIError extends Error {}

const REPLAY_ONLY = "Replay mode only knows the sample requests. Add ANTHROPIC_API_KEY to .env to try your own.";

export async function askJson<T>(options: AskOptions & { schema: Record<string, unknown> }): Promise<T> {
  const text = await request(options);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AIError(`The ${options.step} step returned something that isn't JSON.`);
  }
}

async function request(options: AskOptions & { schema?: Record<string, unknown> }): Promise<string> {
  const started = Date.now();
  const model = MODELS[options.model];

  if (!client) {
    const answer = REPLAYS[options.replayKey];
    if (answer === undefined) throw new AIError(REPLAY_ONLY);
    await pause();
    options.calls.push({ step: options.step, model: "replay", ms: Date.now() - started, inputTokens: 0, outputTokens: 0, usd: 0 });
    return typeof answer === "string" ? answer : JSON.stringify(answer);
  }

  const smart = options.model === "smart";
  let response: Message;
  try {
    response = await client.beta.messages.create({
      model,
      max_tokens: 8000,
      system: options.system,
      messages: [{ role: "user", content: options.prompt }],
      output_config: {
        effort: options.effort ?? (smart ? "medium" : "low"),
        ...(options.schema ? { format: { type: "json_schema" as const, schema: options.schema } } : {}),
      },
      // On the smart model: if a safety classifier declines, retry on Anthropic's recommended fallback.
      ...(smart ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
  } catch (error) {
    if (error instanceof Anthropic.APIError) throw new AIError(`The AI service returned an error (${error.status}).`);
    throw error;
  }

  record(options.calls, options.step, model, started, response);
  if (response.stop_reason === "refusal") throw new AIError("The model declined this request.");
  if (response.stop_reason === "max_tokens") throw new AIError("The answer was cut off.");
  return textOf(response);
}

// ── the agent loop's model call ─────────────────────────────────────────────

export interface TurnOptions {
  step: string;
  system: string;
  messages: MessageParam[];
  tools: Tool[];
  /** Which pre-written script to play in replay mode. */
  replayKey: string;
  calls: Call[];
}

/** One turn: the model reads the whole conversation and answers, or asks for tools. */
export async function agentTurn(options: TurnOptions): Promise<Message> {
  const started = Date.now();

  if (!client) {
    const script = SCRIPTS[options.replayKey];
    if (!script) throw new AIError(REPLAY_ONLY);
    checkToolResults(options.messages);
    const reply = script(seen(options.messages, options.tools));
    await pause();
    options.calls.push({ step: options.step, model: "replay", ms: Date.now() - started, inputTokens: 0, outputTokens: 0, usd: 0 });
    return replayMessage(reply, options.messages.length);
  }

  let response: Message;
  try {
    response = await client.beta.messages.create({
      model: MODELS.smart,
      max_tokens: 16000,
      system: options.system,
      messages: options.messages,
      tools: options.tools,
      output_config: { effort: "medium" },
      // If a safety classifier declines, retry on Anthropic's recommended fallback.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
  } catch (error) {
    if (error instanceof Anthropic.APIError) throw new AIError(`The AI service returned an error (${error.status}).`);
    throw error;
  }
  record(options.calls, options.step, MODELS.smart, started, response);
  return response;
}

function record(calls: Call[], step: string, model: string, started: number, response: Message) {
  const { input_tokens, output_tokens } = response.usage;
  const [inPrice, outPrice] = PRICES[model] ?? [0, 0];
  calls.push({
    step,
    model,
    ms: Date.now() - started,
    inputTokens: input_tokens,
    outputTokens: output_tokens,
    usd: (input_tokens * inPrice + output_tokens * outPrice) / 1_000_000,
  });
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 120)); // a little realism

// ── replay mode ─────────────────────────────────────────────────────────────

/** One pre-written model turn: some text, some tool calls, or both. */
export interface Reply {
  text?: string;
  tools?: { name: string; input: Record<string, unknown> }[];
}

export interface ToolOutcome {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  text: string;
  /** The result arrived wrapped as labelled, untrusted data (lesson 1). */
  labelled: boolean;
}

/** What a replay script can see: the same conversation a model would read. */
export interface Seen {
  /** 1 for the model's first turn in this run. */
  turn: number;
  request: string;
  /** Every tool result so far, oldest first. */
  results: ToolOutcome[];
  /** The results that came back since the model's previous turn. */
  last: ToolOutcome[];
  /** The latest result from one tool. */
  result(name: string): ToolOutcome | undefined;
  /** Some tool result so far contains this text (case-insensitive). */
  saw(text: string): boolean;
  /** The tool's definition as offered this turn, or undefined if it isn't offered. */
  offered(name: string): Tool | undefined;
}

/** A pre-written script reads the conversation and returns the model's next turn. */
export type Script = (seen: Seen) => Reply;

function seen(messages: MessageParam[], tools: Tool[]): Seen {
  const asked = new Map<string, { name: string; input: Record<string, unknown> }>();
  const results: ToolOutcome[] = [];
  let last: ToolOutcome[] = [];
  let turn = 1;

  for (const message of messages) {
    if (typeof message.content === "string") continue;
    if (message.role === "assistant") {
      turn++;
      for (const block of message.content) {
        if (block.type === "tool_use") asked.set(block.id, { name: block.name, input: block.input as Record<string, unknown> });
      }
      continue;
    }
    const batch: ToolOutcome[] = [];
    for (const block of message.content) {
      if (block.type !== "tool_result") continue;
      const call = asked.get(block.tool_use_id);
      const text =
        typeof block.content === "string"
          ? block.content
          : (block.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
      batch.push({ name: call?.name ?? "unknown", input: call?.input ?? {}, ok: !block.is_error, text, labelled: text.includes("<untrusted ") });
    }
    if (batch.length > 0) {
      results.push(...batch);
      last = batch;
    }
  }

  const first = messages[0];
  return {
    turn,
    request: typeof first?.content === "string" ? first.content : "",
    results,
    last,
    result: (name) => [...results].reverse().find((r) => r.name === name),
    saw: (text) => results.some((r) => r.text.toLowerCase().includes(text.toLowerCase())),
    offered: (name) => tools.find((t) => t.name === name),
  };
}

function replayMessage(reply: Reply, n: number): Message {
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  if (reply.text) content.push({ type: "text", text: reply.text, citations: null });
  (reply.tools ?? []).forEach((call, i) => {
    content.push({ type: "tool_use", id: `toolu_replay_${String(n).padStart(2, "0")}_${i}`, name: call.name, input: call.input });
  });
  return {
    id: `msg_replay_${n}`,
    type: "message",
    role: "assistant",
    model: "replay",
    content,
    stop_reason: reply.tools?.length ? "tool_use" : "end_turn",
    stop_sequence: null,
  } as unknown as Message;
}

// The real API rejects a conversation where a tool_use has no matching tool_result
// in the very next user message. Replay mode enforces the same rule, so mistakes fail the same way.
function checkToolResults(messages: MessageParam[]) {
  messages.forEach((message, index) => {
    if (message.role !== "assistant" || typeof message.content === "string") return;
    const callIds = message.content.flatMap((block) => (block.type === "tool_use" ? [block.id] : []));
    if (callIds.length === 0) return;
    const next = messages[index + 1];
    if (!next) return;
    const answered = new Set(
      typeof next.content === "string" ? [] : next.content.flatMap((block) => (block.type === "tool_result" ? [block.tool_use_id] : [])),
    );
    const missing = callIds.filter((id) => !answered.has(id));
    if (missing.length > 0) {
      throw new Error(`400 invalid_request_error: messages.${index + 1}: tool_use ids were found without tool_result blocks immediately after: ${missing.join(", ")}`);
    }
  });
}

// ── small helpers ───────────────────────────────────────────────────────────

/** All the text blocks of a reply, joined. */
export function textOf(message: Message): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
}

/** All the tool calls of a reply. */
export function toolCallsOf(message: Message): ToolUseBlock[] {
  return message.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
}

/** "3 calls · 0.4s · $0.0031". */
export function costLine(calls: Call[]) {
  const ms = calls.reduce((sum, call) => sum + call.ms, 0);
  const usd = calls.reduce((sum, call) => sum + call.usd, 0);
  const money = calls.every((call) => call.model === "replay") ? "replay, no cost" : `$${usd.toFixed(4)}`;
  return `${calls.length} call${calls.length === 1 ? "" : "s"} · ${(ms / 1000).toFixed(1)}s · ${money}`;
}
