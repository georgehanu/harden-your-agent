// Defence 4 · Identity (lesson 4)
//
// The agent holds the keys to every booking. The question is whose behalf it's acting on.
//
// With this defence on, tools act as the person in the signed session cookie (src/session.ts), and
// each tool asks the rules below before it reads or changes anything. Whatever the chat says about
// who's typing changes nothing: the tools never see the chat.
//
// With it off, tools run as the assistant's own service account, which can do anything, and the
// house rules exist only as a paragraph in the system prompt.

import type { Booking, User } from "../data/guesthouse.js";
import { money } from "../store.js";
import type { Defences } from "./index.js";

/** What tools run as when this defence is off: a service account that's allowed everything. */
export const ASSISTANT: User = { id: "assistant", name: "the assistant", role: "assistant" };

export const RECEPTIONIST_REFUND_LIMIT = 100;

export type Verdict = { ok: true } | { ok: false; reason: string };
const yes: Verdict = { ok: true };
const no = (reason: string): Verdict => ({ ok: false, reason });

/** The user a tool acts as. Taken from the session, never from anything the model wrote. */
export function actingAs(session: User, defences: Defences): User {
  return defences.identity ? session : ASSISTANT;
}

const isStaff = (user: User) => user.role === "owner" || user.role === "receptionist" || user.role === "assistant";

export function canSeeBooking(user: User, booking: Booking): Verdict {
  if (isStaff(user) || booking.guest_email === user.email) return yes;
  return no(`${booking.ref} belongs to another guest. Guests can only see their own bookings.`);
}

export function canListBookings(user: User, guestEmail: string): Verdict {
  if (isStaff(user) || guestEmail.trim().toLowerCase() === user.email) return yes;
  return no("Guests can only list their own bookings.");
}

export function canChangeBooking(user: User): Verdict {
  return isStaff(user) ? yes : no("Guests can't change bookings here. A member of staff can.");
}

export function canRefund(user: User, amount: number): Verdict {
  if (user.role === "owner" || user.role === "assistant") return yes;
  if (user.role === "receptionist") {
    if (amount <= RECEPTIONIST_REFUND_LIMIT) return yes;
    return no(`Receptionists can refund up to ${money(RECEPTIONIST_REFUND_LIMIT)} at a time. ${money(amount)} needs the owner.`);
  }
  return no("Guests can't issue refunds. A member of staff can.");
}

/** read_inbox, remember and recall: staff only. */
export function canUseStaffTool(user: User, tool: string): Verdict {
  return isStaff(user) ? yes : no(`${tool} is for staff only.`);
}

export function canExportLedger(user: User): Verdict {
  return user.role === "owner" || user.role === "assistant" ? yes : no("Only the owner can export the ledger.");
}

/** The same rules, as a table for the lesson and the app. */
export const RULES: [string, string, string, string][] = [
  ["", "Owner", "Receptionist", "Guest"],
  ["Look up or list bookings", "all", "all", "her own"],
  ["Change a booking", "yes", "yes", "no"],
  ["Refund", "any amount", `up to ${money(RECEPTIONIST_REFUND_LIMIT)}`, "no"],
  ["Read the inbox, read and write notes", "yes", "yes", "no"],
  ["Fetch a partner page", "yes", "yes", "yes"],
  ["Export the ledger", "yes", "no", "no"],
];
