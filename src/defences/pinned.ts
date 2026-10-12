// Defence 6, part two · Pinned tool definitions (lesson 6)
//
// The model decides what to do partly from each tool's description. If a plugin or a tool server can
// change a description while the app runs, it can change the agent's instructions without anyone
// touching the prompt. So every definition is hashed when the app starts, and before each turn the loop
// checks them again. A definition that no longer matches isn't sent to the model, and calls to it are refused.

import { createHash } from "node:crypto";
import type { Tool } from "../model.js";

export type Pins = Map<string, string>;

/** Same definition, same hash, whatever order the keys were written in. */
export function hashDefinition(tool: Tool) {
  return createHash("sha256").update(stableJson(tool)).digest("hex");
}

export function pinDefinitions(tools: Tool[]): Pins {
  return new Map(tools.map((tool) => [tool.name, hashDefinition(tool)]));
}

export interface Drift {
  name: string;
  pinned: string | undefined;
  now: string;
}

/** Tools whose definition differs from the one pinned at startup, including tools that weren't there. */
export function changedDefinitions(tools: Tool[], pins: Pins): Drift[] {
  return tools
    .map((tool) => ({ name: tool.name, pinned: pins.get(tool.name), now: hashDefinition(tool) }))
    .filter((drift) => drift.pinned !== drift.now);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, v]) => `${JSON.stringify(key)}:${stableJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
