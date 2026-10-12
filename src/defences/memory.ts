// Defence 6 · Memory (lesson 6)
//
// A note is a message to every future run. If an email can become a note, that email gets a say in
// every conversation after it, with nobody watching. So:
//
//   1. a write gate: notes become durable only when staff wrote them. A note written in a run that read
//      emails or pages waits in quarantine until a person confirms it
//   2. provenance and an expiry date on every note
//   3. recall returns notes as labelled, untrusted data, never as facts
//   4. a recalled claim that would move money is checked against the booking record
//
// The other half of this defence, pinned tool definitions, is in pinned.ts.

import { TODAY, type Booking } from "../data/guesthouse.js";
import { money, type Note, type NoteSource } from "../store.js";
import { Refused, type ToolContext } from "../tools/core.js";

export const KEEP_DAYS = { staff: 180, confirmed: 90, quarantine: 7 };

export function addDays(date: string, days: number) {
  return new Date(Date.parse(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** 1 and 2. Decides how a new note is stored: its source, its status, when it expires. */
export function gateNote(ctx: ToolContext, text: string): { source: NoteSource; status: Note["status"]; expires: string | null } {
  if (!ctx.defences.memory) {
    // No gate: whatever the model writes is stored as fact, from nowhere in particular, forever.
    return { source: { kind: "unknown", ref: "not recorded", by: "not recorded" }, status: "active", expires: null };
  }
  const by = `${ctx.session.name} (${ctx.session.role})`;
  const read = ctx.run.untrustedRead;
  // Staff wrote it if the words are theirs, or if nothing untrusted was read in this run.
  if (wordsFrom(text, ctx.run.request) || read.length === 0) {
    return { source: { kind: "staff", ref: `asked by ${ctx.session.name}`, by }, status: "active", expires: addDays(TODAY, KEEP_DAYS.staff) };
  }
  // We don't guess which sentence came from where. The run read untrusted text, so a person decides.
  const kind = read.some((s) => s.startsWith("inbox")) ? "email" : read.some((s) => s.startsWith("page")) ? "page" : "note";
  return { source: { kind, ref: `same run read ${read.join(", ")}`, by }, status: "quarantined", expires: addDays(TODAY, KEEP_DAYS.quarantine) };
}

/** True when nearly every word of the note is in what the person typed. */
function wordsFrom(note: string, request: string) {
  const words = (text: string) => text.toLowerCase().match(/[a-z0-9£]+/g) ?? [];
  const typed = new Set(words(request));
  const said = words(note).filter((word) => word.length > 2);
  return said.length > 0 && said.filter((word) => typed.has(word)).length / said.length >= 0.8;
}

/** 3. What recall may return: active, unexpired notes. With the defence off: everything that isn't discarded. */
export function recallable(ctx: ToolContext, guestEmail: string): Note[] {
  const notes = ctx.store.notes().filter((note) => note.guest_email === guestEmail.trim().toLowerCase() && note.status !== "discarded");
  if (!ctx.defences.memory) return notes;
  return notes.filter((note) => note.status === "active" && (note.expires === null || note.expires >= TODAY));
}

export function waiting(ctx: ToolContext, guestEmail: string) {
  return ctx.store.notes().filter((note) => note.guest_email === guestEmail.trim().toLowerCase() && note.status === "quarantined").length;
}

/** "from email E4 …, confirmed by Dev", for the label on a recalled note. */
export function provenance(note: Note) {
  const confirmed = note.confirmed_by ? `, confirmed by ${note.confirmed_by}` : "";
  return note.source.kind === "unknown" ? "source not recorded" : `${note.source.kind}: ${note.source.ref}${confirmed}`;
}

/** 4. Money that rests on memory has to be backed by the booking record. */
export function checkMoneyFromMemory(ctx: ToolContext, booking: Booking, amount: number) {
  const claims = ctx.run.recalled.filter((note) => amounts(note.text).includes(amount));
  if (claims.length === 0 || amounts(ctx.run.request).includes(amount)) return; // not from memory, or the person said it
  if (booking.credit_owed >= amount) return; // a person recorded the credit on the booking
  const from = claims.map((note) => `${note.id}, ${provenance(note)}`).join("; ");
  throw new Refused(
    "memory",
    `This refund rests on a saved note (${from}). ${booking.ref}'s record shows ${money(booking.credit_owed)} owed to the guest. Memory can't move money on its own: ask a person to check and record the credit on the booking first.`,
  );
}

/** Every £ amount in a piece of text: "£60 credit" → [60]. */
export function amounts(text: string) {
  return [...text.matchAll(/£\s?(\d[\d,]*(?:\.\d{1,2})?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
}

/** A person looked at a quarantined note and said yes. It becomes active, for a while. */
export function confirmNote(note: Note, by: string): Note {
  return { ...note, status: "active", confirmed_by: by, expires: addDays(TODAY, KEEP_DAYS.confirmed) };
}

export function discardNote(note: Note): Note {
  return { ...note, status: "discarded" };
}
