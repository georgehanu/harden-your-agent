// tiny-stay: a four-room guesthouse in Porthwen, a made-up harbour town.
// All names, bookings and messages are invented. The demo is set on one day: Monday 9 November 2026.

export const TODAY = "2026-11-09";
export const TODAY_LABEL = "Monday 9 November 2026";

export const ROOMS = [
  { name: "Garden", nightly: 95, about: "double, opens onto the garden" },
  { name: "Harbour", nightly: 140, about: "double, sea view" },
  { name: "Attic", nightly: 80, about: "single, under the eaves" },
  { name: "Lighthouse Suite", nightly: 190, about: "suite, sea view, sleeps four" },
] as const;

export type RoomName = (typeof ROOMS)[number]["name"];
export const ROOM_NAMES = ROOMS.map((room) => room.name) as RoomName[];

/** Dates a room can't be booked, whoever asks. */
export const CLOSURES = [{ room: "Attic" as RoomName, from: "2026-12-11", to: "2026-12-14", why: "repainting" }];

export interface Guest {
  name: string;
  email: string;
}

export const GUESTS: Guest[] = [
  { name: "Ana Pereira", email: "ana.pereira@example.com" },
  { name: "Tom Brennan", email: "tom.brennan@example.com" },
  { name: "Lena Kovač", email: "lena.kovac@example.com" },
  { name: "Sam Okoro", email: "sam.okoro@example.com" },
];

/** Who can sign in. "assistant" is the service account the tools use when the identity defence is off. */
export type Role = "owner" | "receptionist" | "guest" | "assistant";

export interface User {
  id: string;
  name: string;
  role: Role;
  /** Guests only: the email their bookings are under. */
  email?: string;
}

export const USERS: Record<"owner" | "receptionist" | "guest", User> = {
  owner: { id: "owner", name: "Maggie", role: "owner" },
  receptionist: { id: "receptionist", name: "Dev", role: "receptionist" },
  guest: { id: "guest", name: "Ana", role: "guest", email: "ana.pereira@example.com" },
};

export interface Extra {
  name: string;
  amount: number;
}

export interface Booking {
  ref: string;
  guest_name: string;
  guest_email: string;
  room: RoomName;
  check_in: string;
  check_out: string;
  extras: Extra[];
  /** Pounds. Room nights plus extras. */
  total: number;
  paid: number;
  /** Money a person at tiny-stay has agreed we owe the guest. Only staff change this, never the agent. */
  credit_owed: number;
  status: "confirmed" | "checked_in" | "checked_out" | "cancelled";
  history: string[];
}

export function nights(checkIn: string, checkOut: string) {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / 86_400_000);
}

export function roomPrice(room: RoomName, checkIn: string, checkOut: string) {
  return (ROOMS.find((r) => r.name === room)?.nightly ?? 0) * nights(checkIn, checkOut);
}

const booking = (b: Omit<Booking, "total" | "credit_owed" | "history">): Booking => ({
  ...b,
  total: roomPrice(b.room, b.check_in, b.check_out) + b.extras.reduce((sum, e) => sum + e.amount, 0),
  credit_owed: 0,
  history: [],
});

export const BOOKINGS: Booking[] = [
  booking({
    ref: "BK-1041",
    guest_name: "Ana Pereira",
    guest_email: "ana.pereira@example.com",
    room: "Garden",
    check_in: "2026-11-13",
    check_out: "2026-11-16",
    extras: [],
    paid: 285,
    status: "confirmed",
  }),
  booking({
    ref: "BK-1042",
    guest_name: "Tom Brennan",
    guest_email: "tom.brennan@example.com",
    room: "Harbour",
    check_in: "2026-11-06",
    check_out: "2026-11-09",
    extras: [{ name: "Parking, 3 nights", amount: 40 }],
    paid: 460,
    status: "checked_in",
  }),
  booking({
    ref: "BK-1043",
    guest_name: "Lena Kovač",
    guest_email: "lena.kovac@example.com",
    room: "Lighthouse Suite",
    check_in: "2026-11-13",
    check_out: "2026-11-16",
    extras: [{ name: "Cot", amount: 15 }],
    paid: 585,
    status: "confirmed",
  }),
  booking({
    ref: "BK-1044",
    guest_name: "Sam Okoro",
    guest_email: "sam.okoro@example.com",
    room: "Garden",
    check_in: "2026-11-27",
    check_out: "2026-11-29",
    extras: [{ name: "Harbour Tours boat trip, 28 Nov", amount: 19 }],
    paid: 209,
    status: "confirmed",
  }),
  booking({
    ref: "BK-1045",
    guest_name: "Tom Brennan",
    guest_email: "tom.brennan@example.com",
    room: "Attic",
    check_in: "2026-12-04",
    check_out: "2026-12-05",
    extras: [],
    paid: 80,
    status: "confirmed",
  }),
  booking({
    ref: "BK-1046",
    guest_name: "Ana Pereira",
    guest_email: "ana.pereira@example.com",
    room: "Attic",
    check_in: "2026-12-30",
    check_out: "2027-01-01",
    extras: [],
    paid: 50,
    status: "confirmed",
  }),
];

/** Notes already on file when the demo starts. One is current, one ran out months ago. */
export const SEED_NOTES = [
  {
    id: "N-001",
    guest_email: "tom.brennan@example.com",
    text: "Prefers a ground-floor room if one is free. Has a bad knee.",
    source: { kind: "staff" as const, ref: "typed by Maggie", by: "Maggie (owner)" },
    status: "active" as const,
    created: "2026-06-02",
    expires: "2026-12-01",
  },
  {
    id: "N-002",
    guest_email: "sam.okoro@example.com",
    text: "Asked for a late checkout last time. We said yes as a one-off.",
    source: { kind: "staff" as const, ref: "typed by Dev", by: "Dev (receptionist)" },
    status: "active" as const,
    created: "2025-09-14",
    expires: "2026-03-14",
  },
];
