// What every tool shares. A tool has two halves (as in The Agent Loop):
//   `tool`  what the model sees: a name, a description, a JSON schema
//   `run`   what our code does when the model asks for it
//
// Defence checks live inside `run`, right next to the thing they protect.

import type { Defences, DefenceId } from "../defences/index.js";
import type { Source } from "../defences/boundaries.js";
import type { Scope } from "../defences/intent.js";
import type { Breaker } from "../defences/once.js";
import type { User } from "../data/guesthouse.js";
import type { Lab } from "../lab.js";
import type { Tool } from "../model.js";
import type { Note, Store } from "../store.js";

export interface AgentTool {
  tool: Tool;
  run(input: Record<string, unknown>, ctx: ToolContext): string | Promise<string>;
}

/** Everything one run knows about itself. Created fresh for every request. */
export interface RunState {
  /** What the person typed. */
  request: string;
  /** Lesson 2: what the request allows. Null when the intent anchor is off. */
  scope: Scope | null;
  /** Untrusted sources the agent has read in this run, e.g. "email E4 from …". */
  untrustedRead: string[];
  /** Lesson 6: notes recall returned in this run. */
  recalled: Note[];
  /** Lesson 5: refunds made in this run. */
  refunds: { count: number; total: number };
  breaker: Breaker;
}

export interface ToolContext {
  /** Who the tool acts as. Lesson 4: the signed-in person, or the assistant's service account. */
  user: User;
  /** Who is signed in, from the session cookie. */
  session: User;
  defences: Defences;
  store: Store;
  lab: Lab;
  run: RunState;
  /** Prepares text from outside before the model sees it: normalised (lesson 2) and labelled (lesson 1). */
  outside(source: Source, text: string): string;
}

/** Thrown by a tool when the request is wrong. The loop sends the message back to the model. */
export class ToolError extends Error {}

/** A defence said no. The model reads it like any tool error; the transcript shows which defence. */
export class Refused extends ToolError {
  constructor(
    readonly defence: DefenceId,
    message: string,
  ) {
    super(message);
  }
}

/** Throw if a role rule (or any yes/no check) said no. */
export function allow(verdict: { ok: true } | { ok: false; reason: string }, defence: DefenceId) {
  if (!verdict.ok) throw new Refused(defence, verdict.reason);
}

export const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");
