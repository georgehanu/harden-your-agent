// The shared runner for the lesson demos. Each lesson runs one scenario twice: with its defence off,
// then on. Same request, same sample, same code. Only the switch changes, so the difference is the defence.

import { USERS } from "../data/guesthouse.js";
import { seedCreditNote } from "../demo-setup.js";
import { type AgentEvent, type RunResult, runAgent } from "../agent.js";
import { type DefenceId, defenceName, upTo } from "../defences/index.js";
import { createLab } from "../lab.js";
import { costLine } from "../model.js";
import { scenario } from "../scenarios.js";
import { Store } from "../store.js";
import * as print from "../print.js";

export interface DemoOptions {
  /** The scenario to run. */
  sample: string;
  /** The lesson number: defences 1..(lesson-1) are the "off" baseline, this lesson's is the switch. */
  lesson: number;
  /** Defaults to the lesson's own defence. */
  defence?: DefenceId;
  /** Turn the lab's plugin update on (lesson 6). */
  pluginUpdated?: boolean;
  label?: { off: string; on: string };
}

export interface Side {
  result: RunResult;
  store: Store;
}

/** Run one scenario with `defence` off, then on, printing both. */
export async function compare(options: DemoOptions): Promise<{ off: Side; on: Side }> {
  const sc = scenario(options.sample)!;
  const defence = options.defence ?? (["", "boundaries", "intent", "render", "identity", "once", "memory"][options.lesson] as DefenceId);
  const label = options.label ?? { off: `${defenceName(defence)} OFF`, on: `${defenceName(defence)} ON` };

  print.rule(sc.request);
  const off = await once(options, defence, false);
  print.rule(label.off);
  draw(off.result);

  const on = await once(options, defence, true);
  print.rule(label.on);
  draw(on.result);

  return { off, on };
}

async function once(options: DemoOptions, defence: DefenceId, state: boolean) {
  const sc = scenario(options.sample)!;
  // Everything up to the previous lesson is already on. This lesson's defence is the one we flip.
  const defences = upTo(options.lesson - 1);
  defences[defence] = state;

  const store = Store.fresh(`lesson-${options.sample}-${state ? "on" : "off"}`);
  if (sc.setup === "credit_note") seedCreditNote(store);
  const lab = createLab();
  if (options.pluginUpdated) lab.pluginUpdated = true;

  const result = await runAgent({ request: sc.request, session: USERS[sc.as], defences, store, lab, sample: sc.id });
  return { result, store };
}

/** Draw a run's events the way the app's transcript does, but for the terminal. */
export function draw(result: RunResult) {
  for (const event of result.events) drawEvent(event);
  console.log(print.dim(`\n  ${costLine(result.calls)}`));
}

function drawEvent(event: AgentEvent) {
  switch (event.type) {
    case "request":
      console.log(`  ${print.bold(print.blue(`${event.user.name} (${event.user.role})`))}  ${event.text}`);
      break;
    case "scope":
      console.log(`  ${print.dim("scope")}  ${print.dim(scopeLine(event.scope))}`);
      break;
    case "model":
      if (event.text) console.log(`  ${print.bold(print.magenta("model"))}  ${print.indent(event.text, 9).trimStart()}`);
      break;
    case "tool_call":
      console.log(`  ${print.cyan("tool →")} ${event.name}(${print.dim(short(JSON.stringify(event.input)))})`);
      break;
    case "tool_result":
      console.log(`  ${event.ok ? print.green("tool ←") : print.red("tool ✗")} ${print.dim(short(oneLine(event.text)))}${event.defence ? print.yellow(`  [${event.defence}]`) : ""}`);
      break;
    case "defence":
      console.log(`  ${print.yellow(`⛉ ${event.defence}`)}  ${print.dim(short(event.text, 140))}`);
      break;
    case "stop":
      if (event.reason !== "done") console.log(`  ${print.yellow(`■ stopped: ${event.reason.replace("_", " ")}`)}`);
      break;
  }
}

const scopeLine = (scope: { summary: string; tools: string[]; booking_refs: string[]; guests: string[]; open_ended: boolean; max_refund: number | null }) =>
  `tools: ${scope.tools.join(", ") || "none"} · ${scope.open_ended ? "any booking" : [...scope.booking_refs, ...scope.guests].join(", ") || "no bookings named"}${scope.max_refund === null ? "" : ` · refunds ≤ £${scope.max_refund}`}`;

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();
const short = (text: string, max = 120) => (text.length > max ? text.slice(0, max - 1) + "…" : text);
