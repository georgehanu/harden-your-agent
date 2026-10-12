// Defence 2 · Intent anchor (lesson 2)
//
// 1. Before the loop starts, a fast model turns the person's request into a scope: the tools it needs,
//    the bookings and guests it's about, and the most money it allows to move. It only ever sees the
//    request, so nothing the agent reads later can widen it.
// 2. Code checks every tool call against the scope. Anything outside it is refused with a message the
//    model can read and pass on.
// 3. Untrusted text is normalised before the model sees it: invisible characters and markup are removed,
//    and the transcript says what went.

import { GUESTS } from "../data/guesthouse.js";
import { askJson, type Call } from "../model.js";
import { money, type Store } from "../store.js";

export interface Scope {
  summary: string;
  tools: string[];
  booking_refs: string[];
  guests: string[];
  open_ended: boolean;
  max_refund: number | null;
}

export const TOOL_NAMES = [
  "find_booking",
  "list_bookings",
  "change_booking",
  "issue_refund",
  "read_inbox",
  "fetch_page",
  "remember",
  "recall",
];

const SYSTEM = `You read one request made to the assistant at tiny-stay, a small guesthouse, and write down its scope:
what the assistant may do to carry it out. Include only what the request needs.

The assistant's tools:
- find_booking: look up one booking by reference
- list_bookings: list a guest's bookings
- change_booking: change a booking's room or dates
- issue_refund: refund money on a booking
- read_inbox: read the guest inbox
- fetch_page: read a web page
- remember: save a note about a guest
- recall: read the saved notes about a guest

Guests: ${GUESTS.map((g) => `${g.name} <${g.email}>`).join(", ")}

Rules:
- A tool is in scope only if the request needs it. Summarising the inbox needs read_inbox, not change_booking.
- booking_refs: the references the request names, like BK-1042.
- guests: the emails of guests the request names, from the list above.
- open_ended: true only when the request covers bookings or guests it can't name in advance, like "everyone who emailed".
- max_refund: the largest single refund the request allows, in pounds, if it states an amount. Otherwise null.`;

export const SCOPE_SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "What the person asked for, in under 12 words." },
    tools: { type: "array", items: { type: "string", enum: TOOL_NAMES } },
    booking_refs: { type: "array", items: { type: "string" }, description: 'References like "BK-1042".' },
    guests: { type: "array", items: { type: "string" }, description: "Guest emails from the list." },
    open_ended: { type: "boolean" },
    max_refund: { anyOf: [{ type: "number" }, { type: "null" }] },
  },
  required: ["summary", "tools", "booking_refs", "guests", "open_ended", "max_refund"],
  additionalProperties: false,
};

export async function extractScope(request: string, calls: Call[], replayKey: string): Promise<Scope> {
  const scope = await askJson<Scope>({
    step: "scope",
    model: "fast",
    system: SYSTEM,
    prompt: `<request>\n${request}\n</request>`,
    schema: SCOPE_SCHEMA,
    replayKey,
    calls,
  });
  // Plain code tidies what the schema can't: references in one format, only guests we know.
  return {
    ...scope,
    tools: scope.tools.filter((tool) => TOOL_NAMES.includes(tool)),
    booking_refs: scope.booking_refs.map((ref) => ref.trim().toUpperCase()),
    guests: scope.guests.map((email) => email.trim().toLowerCase()).filter((email) => GUESTS.some((g) => g.email === email)),
  };
}

/** Null if the call fits the scope. Otherwise the reason, written for the model to read. */
export function checkScope(scope: Scope, tool: string, input: Record<string, unknown>, store: Store): string | null {
  const asked = `The person asked: "${scope.summary}".`;
  if (!scope.tools.includes(tool)) {
    return `${tool} is outside this request. ${asked} Don't do it. If you think it's needed, say so in your answer and let them decide.`;
  }

  const ref = typeof input.ref === "string" ? input.ref.trim().toUpperCase() : null;
  const email = typeof input.guest_email === "string" ? input.guest_email.trim().toLowerCase() : null;
  if (!scope.open_ended && ref) {
    const owner = store.booking(ref)?.guest_email;
    if (!scope.booking_refs.includes(ref) && !(owner && scope.guests.includes(owner))) {
      return `${ref} isn't part of this request. ${asked} Leave it alone, or ask first.`;
    }
  }
  if (!scope.open_ended && email) {
    const named = scope.guests.includes(email) || scope.booking_refs.some((r) => store.booking(r)?.guest_email === email);
    if (!named) return `${email} isn't part of this request. ${asked} Leave them alone, or ask first.`;
  }
  if (tool === "issue_refund" && scope.max_refund !== null && Number(input.amount) > scope.max_refund) {
    return `This request allows refunds up to ${money(scope.max_refund)}, not ${money(Number(input.amount))}.`;
  }
  return null;
}

export function describeScope(scope: Scope) {
  const parts = [
    scope.tools.join(", ") || "no tools",
    scope.open_ended ? "any booking" : [...scope.booking_refs, ...scope.guests].join(", ") || "no bookings",
    scope.max_refund === null ? "" : `refunds up to ${money(scope.max_refund)}`,
  ];
  return parts.filter(Boolean).join(" · ");
}

// ── normalising untrusted text ──────────────────────────────────────────────

export interface Removed {
  comments: number;
  hidden: number;
  tags: number;
  invisible: number;
}

// Characters that take up no space on screen but still reach the model: zero-width spaces and joiners,
// direction overrides, variation selectors, the invisible "tag" block, and friends.
const INVISIBLE =
  /[­͏؜ᅟᅠ឴឵᠋-᠏​-‏‪-‮⁠-⁯ㅤ︀-️﻿ﾠ\u{E0000}-\u{E007F}\u{E0100}-\u{E01EF}]/gu;

// An element a browser wouldn't show: display:none, visibility:hidden, the hidden attribute, aria-hidden.
const HIDDEN =
  /<(\w+)\b[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|\shidden(?=[\s=>/])|aria-hidden\s*=\s*["']?true)[^>]*>[\s\S]*?<\/\1\s*>/gi;

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

/** What a person would see, as plain text, plus a count of what was taken out. */
export function normalise(text: string): { text: string; removed: Removed } {
  const removed: Removed = { comments: 0, hidden: 0, tags: 0, invisible: 0 };
  const out = text
    .replace(/<!--[\s\S]*?(-->|$)/g, () => (removed.comments++, ""))
    .replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, () => (removed.hidden++, ""))
    .replace(HIDDEN, () => (removed.hidden++, ""))
    .replace(/<\/?(p|div|h\d|li|ul|ol|tr|br|section|article|header|footer)\b[^>]*>/gi, () => (removed.tags++, "\n"))
    .replace(/<\/?[a-z][^>]*>/gi, () => (removed.tags++, ""))
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (entity) => ENTITIES[entity])
    .replace(INVISIBLE, () => (removed.invisible++, ""))
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text: out, removed };
}

/** "1 HTML comment, 1 hidden element and 6 invisible characters", or null if nothing was removed. */
export function describeRemoved(removed: Removed): string | null {
  const counts: [number, string][] = [
    [removed.comments, "HTML comment"],
    [removed.hidden, "hidden element"],
    [removed.invisible, "invisible character"],
    [removed.tags, "tag"],
  ];
  const parts = counts.filter(([count]) => count > 0).map(([count, what]) => `${count} ${what}${count === 1 ? "" : "s"}`);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
