// The booking tools: find, list, change, refund.
//
// Every tool asks the identity rules before it acts (lesson 4). With that defence off, ctx.user is the
// assistant's service account, which is allowed everything, so the question is asked and always answered yes.

import { CLOSURES, GUESTS, ROOM_NAMES, roomPrice, TODAY, nights, type Booking, type RoomName } from "../data/guesthouse.js";
import { canChangeBooking, canListBookings, canRefund, canSeeBooking } from "../defences/identity.js";
import { checkMoneyFromMemory } from "../defences/memory.js";
import { checkChange, checkRefund, refundKey, type Change } from "../defences/once.js";
import { money } from "../store.js";
import { allow, str, ToolError, type AgentTool, type ToolContext } from "./core.js";

const REF = { type: "string", description: 'A booking reference, like "BK-1042".' };
const nullable = (schema: object) => ({ anyOf: [schema, { type: "null" }] });

function getBooking(ctx: ToolContext, ref: unknown): Booking {
  const booking = ctx.store.booking(str(ref));
  if (!booking) throw new ToolError(`There's no booking "${str(ref)}". References look like BK-1042.`);
  return booking;
}

/** Who did it, for the ledger and the booking history. */
export function actor(ctx: ToolContext) {
  return ctx.user.role === "assistant" ? `assistant service account (chat with ${ctx.session.name})` : `${ctx.user.name} (${ctx.user.role})`;
}

function summary(booking: Booking, ctx: ToolContext) {
  return {
    ref: booking.ref,
    guest: booking.guest_name,
    guest_email: booking.guest_email,
    room: booking.room,
    check_in: booking.check_in,
    check_out: booking.check_out,
    nights: nights(booking.check_in, booking.check_out),
    extras: booking.extras,
    total: booking.total,
    paid: booking.paid,
    refunded: ctx.store.refundedOn(booking.ref),
    owed_to_guest: booking.credit_owed,
    status: booking.status,
  };
}

const stay = (b: Change) => `the ${b.room}, ${b.check_in} to ${b.check_out}`;

export const findBooking: AgentTool = {
  tool: {
    name: "find_booking",
    description: "Look up one booking by its reference.",
    strict: true,
    input_schema: { type: "object", properties: { ref: REF }, required: ["ref"], additionalProperties: false },
  },
  run: ({ ref }, ctx) => {
    const booking = getBooking(ctx, ref);
    allow(canSeeBooking(ctx.user, booking), "identity");
    return JSON.stringify(summary(booking, ctx));
  },
};

export const listBookings: AgentTool = {
  tool: {
    name: "list_bookings",
    description: "List every booking under a guest's email address.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { guest_email: { type: "string", description: "The guest's email address." } },
      required: ["guest_email"],
      additionalProperties: false,
    },
  },
  run: ({ guest_email }, ctx) => {
    const email = str(guest_email).toLowerCase();
    allow(canListBookings(ctx.user, email), "identity");
    if (!GUESTS.some((g) => g.email === email)) throw new ToolError(`No guest with the email ${email}.`);
    return JSON.stringify(ctx.store.bookings().filter((b) => b.guest_email === email).map((b) => summary(b, ctx)));
  },
};

export const changeBooking: AgentTool = {
  tool: {
    name: "change_booking",
    description:
      "Change a booking's room or dates. Pass null for anything that stays the same. " +
      "Set waive_price_difference to true to keep the old price when the new one is higher.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        ref: REF,
        room: nullable({ type: "string", enum: ROOM_NAMES }),
        check_in: nullable({ type: "string", description: "New arrival date, YYYY-MM-DD." }),
        check_out: nullable({ type: "string", description: "New departure date, YYYY-MM-DD." }),
        waive_price_difference: { type: "boolean" },
      },
      required: ["ref", "room", "check_in", "check_out", "waive_price_difference"],
      additionalProperties: false,
    },
  },
  run: (input, ctx) => {
    const booking = getBooking(ctx, input.ref);
    allow(canChangeBooking(ctx.user), "identity");

    const next: Change = {
      room: (str(input.room) || booking.room) as RoomName,
      check_in: str(input.check_in) || booking.check_in,
      check_out: str(input.check_out) || booking.check_out,
    };
    if (!ROOM_NAMES.includes(next.room)) throw new ToolError(`There's no room called "${next.room}". Rooms: ${ROOM_NAMES.join(", ")}.`);
    const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
    if (!isDate(next.check_in) || !isDate(next.check_out) || next.check_out <= next.check_in) {
      throw new ToolError("Dates must be YYYY-MM-DD, with check-out after check-in.");
    }

    // Lesson 5: look at the booking as it is now before changing it.
    if (ctx.defences.once && checkChange(booking, next) === "same") {
      return `No change needed: ${booking.ref} is already ${stay(next)}.`;
    }

    const overlaps = (aFrom: string, aTo: string, bFrom: string, bTo: string) => aFrom < bTo && bFrom < aTo;
    const taken = ctx.store
      .bookings()
      .find((b) => b.ref !== booking.ref && b.room === next.room && b.status !== "cancelled" && overlaps(next.check_in, next.check_out, b.check_in, b.check_out));
    if (taken) throw new ToolError(`The ${next.room} is booked on those dates (${taken.ref}). Try other dates or another room.`);
    const closed = CLOSURES.find((c) => c.room === next.room && overlaps(next.check_in, next.check_out, c.from, c.to));
    if (closed) throw new ToolError(`The ${next.room} is closed from ${closed.from} to ${closed.to} (${closed.why}).`);

    const price = roomPrice(next.room, next.check_in, next.check_out) + booking.extras.reduce((sum, e) => sum + e.amount, 0);
    const waived = input.waive_price_difference === true && price > booking.total;
    const total = waived ? booking.total : price;
    const note = waived ? `, price difference of ${money(price - booking.total)} waived` : "";
    ctx.store.saveBooking({
      ...booking,
      ...next,
      total,
      history: [...booking.history, `${TODAY}: ${stay(booking)} → ${stay(next)}${note}. By ${actor(ctx)}.`],
    });
    return `Changed ${booking.ref}: now ${stay(next)}. Total ${money(total)}${waived ? ` (the ${money(price - booking.total)} difference is waived)` : ""}.`;
  },
};

export const issueRefund: AgentTool = {
  tool: {
    name: "issue_refund",
    description: "Refund money on a booking, back to the card the guest paid with.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        ref: REF,
        amount: { type: "number", description: "Pounds, like 40 or 12.50." },
        reason: { type: "string", description: "Why, in a few words. It goes on the ledger." },
      },
      required: ["ref", "amount", "reason"],
      additionalProperties: false,
    },
  },
  run: (input, ctx) => {
    const booking = getBooking(ctx, input.ref);
    const amount = Number(input.amount);
    const reason = str(input.reason);
    if (!reason) throw new ToolError("Give a reason. It goes on the ledger.");

    allow(canRefund(ctx.user, amount), "identity"); // lesson 4
    if (ctx.defences.memory) checkMoneyFromMemory(ctx, booking, amount); // lesson 6

    let key: string | null = null;
    if (ctx.defences.once) {
      // lesson 5: the same request twice gets the first answer, not a second refund
      const earlier = checkRefund(ctx, booking, amount, reason);
      if (earlier) {
        return `Already done: ${earlier.id} refunded ${money(earlier.amount)} on ${earlier.ref} ("${earlier.reason}"). Same request, so nothing new was refunded.`;
      }
      key = refundKey(booking.ref, amount, reason);
    }

    if (ctx.lab.paymentsDown) throw new ToolError("The payment service didn't answer (timed out after 10s). No refund was made.");

    const entry = ctx.store.addRefund({ ref: booking.ref, amount, reason, by: actor(ctx), at: TODAY, key });
    ctx.run.refunds.count++;
    ctx.run.refunds.total += amount;
    return `Refunded ${money(amount)} on ${booking.ref} (${entry.id}). ${booking.guest_name} will see it in 3 to 5 working days.`;
  },
};
