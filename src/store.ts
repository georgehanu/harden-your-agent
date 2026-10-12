// Bookings, the refunds ledger and guest notes, kept as JSON files in .data/<name>/.
// The app uses .data/app. Each lesson starts from a fresh copy, so you can run them as often as you like.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { BOOKINGS, SEED_NOTES, type Booking } from "./data/guesthouse.js";

export interface LedgerEntry {
  id: string;
  ref: string;
  amount: number;
  reason: string;
  /** Who the refund was made as: a person, or the assistant's service account. */
  by: string;
  at: string;
  /** Idempotency key (lesson 5). Null when the refund was made without one. */
  key: string | null;
}

export interface NoteSource {
  kind: "staff" | "email" | "page" | "note" | "unknown";
  /** What it came from: "typed by Dev", "email E4 from …", a URL. */
  ref: string;
  /** Who was signed in when the note was written. */
  by: string;
}

export interface Note {
  id: string;
  guest_email: string;
  text: string;
  source: NoteSource;
  status: "active" | "quarantined" | "discarded";
  created: string;
  /** ISO date. Null means the note never expires. */
  expires: string | null;
  confirmed_by?: string;
}

const FILES = { bookings: "bookings.json", ledger: "ledger.json", notes: "notes.json" } as const;

export class Store {
  readonly dir: URL;

  constructor(name: string) {
    this.dir = new URL(`../.data/${name}/`, import.meta.url);
    if (!existsSync(new URL(FILES.bookings, this.dir))) this.reset();
  }

  /** A clean copy of the sample data, for a lesson run. */
  static fresh(name: string) {
    const store = new Store(name);
    store.reset();
    return store;
  }

  reset() {
    rmSync(this.dir, { recursive: true, force: true });
    mkdirSync(this.dir, { recursive: true });
    this.write("bookings", structuredClone(BOOKINGS));
    this.write("ledger", []);
    this.write("notes", structuredClone(SEED_NOTES));
  }

  bookings(): Booking[] {
    return this.read("bookings");
  }

  booking(ref: string): Booking | undefined {
    return this.bookings().find((b) => b.ref.toUpperCase() === String(ref).trim().toUpperCase());
  }

  saveBooking(updated: Booking) {
    this.write("bookings", this.bookings().map((b) => (b.ref === updated.ref ? updated : b)));
  }

  ledger(): LedgerEntry[] {
    return this.read("ledger");
  }

  refundedOn(ref: string) {
    return this.ledger()
      .filter((entry) => entry.ref === ref)
      .reduce((sum, entry) => sum + entry.amount, 0);
  }

  addRefund(entry: Omit<LedgerEntry, "id">): LedgerEntry {
    const ledger = this.ledger();
    const saved = { id: `R-${String(ledger.length + 1).padStart(4, "0")}`, ...entry };
    this.write("ledger", [...ledger, saved]);
    return saved;
  }

  notes(): Note[] {
    return this.read("notes");
  }

  addNote(note: Omit<Note, "id">): Note {
    const notes = this.notes();
    const saved = { id: `N-${String(notes.length + 1).padStart(3, "0")}`, ...note };
    this.write("notes", [...notes, saved]);
    return saved;
  }

  saveNote(updated: Note) {
    this.write("notes", this.notes().map((n) => (n.id === updated.id ? updated : n)));
  }

  private read<T>(file: keyof typeof FILES): T {
    return JSON.parse(readFileSync(new URL(FILES[file], this.dir), "utf8"));
  }

  private write(file: keyof typeof FILES, data: unknown) {
    writeFileSync(new URL(FILES[file], this.dir), JSON.stringify(data, null, 2) + "\n");
  }
}

export const money = (amount: number) => `£${amount.toFixed(2)}`;
