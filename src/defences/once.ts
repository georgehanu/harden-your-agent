// Defence 5 · Once (lesson 5)
//
// Agents retry. A response goes missing, a person asks twice, a loop goes round again.
// Reading twice is harmless. Refunding twice isn't. So before issue_refund or change_booking acts:
//
//   1. an idempotency key from (ref, amount, reason): the same refund twice returns the first one
//   2. a state check: read the ledger and the booking before acting, not after
//   3. a budget per run: at most 2 refunds and £150 in one run, whatever the model has planned
//   4. a circuit breaker: 3 tool errors in a row and the run stops for a person
//   5. a plausibility check: the numbers that drive an action must make sense against the booking
//      record, wherever they came from (the request, an email, a partner's web page)

import { createHash } from "node:crypto";
import { nights, TODAY, type Booking, type RoomName } from "../data/guesthouse.js";
import { money, type LedgerEntry } from "../store.js";
import { Refused, type ToolContext } from "../tools/core.js";

export const RUN_BUDGET = { refunds: 2, total: 150 };
export const BREAKER_AFTER = 3;
export const MAX_NIGHTS = 14;

/** Same booking, same amount, same reason (give or take case and punctuation): same key. */
export function refundKey(ref: string, amount: number, reason: string) {
  const words = reason.toLowerCase().replace(/[^a-z0-9£ ]+/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha256").update(`${ref.toUpperCase()}|${amount.toFixed(2)}|${words}`).digest("hex").slice(0, 16);
}

/** Runs before a refund touches the ledger. Returns the earlier refund if this one was already made. */
export function checkRefund(ctx: ToolContext, booking: Booking, amount: number, reason: string): LedgerEntry | undefined {
  // 5. Plausible numbers, part one: is it even a refund amount?
  if (!(amount > 0) || Math.round(amount * 100) !== amount * 100) {
    throw new Refused("once", `${amount} isn't a refund amount. Use pounds and pence, more than zero.`);
  }

  // 1. The same request again returns the first result. Nothing new happens.
  const ledger = ctx.store.ledger();
  const earlier = ledger.find((entry) => entry.key === refundKey(booking.ref, amount, reason));
  if (earlier) return earlier;

  // 2. Look before acting: a near-identical refund, or a booking with nothing left to refund.
  const similar = ledger.find((entry) => entry.ref === booking.ref && entry.amount === amount);
  if (similar) {
    throw new Refused(
      "once",
      `A ${money(amount)} refund on ${booking.ref} already exists (${similar.id}, "${similar.reason}"). If this really is a second, separate refund, a person should make it.`,
    );
  }
  if (booking.status === "cancelled") throw new Refused("once", `${booking.ref} is cancelled and was settled then.`);

  // 5. Plausible numbers, part two: checked against the record, not against whatever text suggested them.
  const refunded = ctx.store.refundedOn(booking.ref);
  if (amount > booking.paid - refunded) {
    throw new Refused(
      "once",
      `${money(amount)} is more than ${booking.ref} has left to refund: ${money(booking.paid)} paid, ${money(refunded)} already refunded. Check where that number came from.`,
    );
  }

  // 3. A budget per run, so one confused loop can't empty the till.
  const { count, total } = ctx.run.refunds;
  if (count >= RUN_BUDGET.refunds) {
    throw new Refused("once", `This run has already made ${count} refunds, the most one run may make. Stop and tell the person what's left.`);
  }
  if (total + amount > RUN_BUDGET.total) {
    throw new Refused(
      "once",
      `That would take this run's refunds to ${money(total + amount)}. One run may refund up to ${money(RUN_BUDGET.total)}. Stop and tell the person what's left.`,
    );
  }
  return undefined;
}

export interface Change {
  room: RoomName;
  check_in: string;
  check_out: string;
}

/** Runs before a booking changes. Returns "same" when the booking is already like that. */
export function checkChange(booking: Booking, next: Change): "same" | undefined {
  if (booking.status === "cancelled" || booking.status === "checked_out") {
    throw new Refused("once", `${booking.ref} is ${booking.status.replace("_", " ")}. It can't be changed now.`);
  }
  if (next.room === booking.room && next.check_in === booking.check_in && next.check_out === booking.check_out) return "same";

  const stay = nights(next.check_in, next.check_out);
  if (stay > MAX_NIGHTS) throw new Refused("once", `${stay} nights isn't a plausible change. Check the dates.`);
  if (next.check_in !== booking.check_in && next.check_in < TODAY) throw new Refused("once", `${next.check_in} is in the past.`);
  return undefined;
}

/** 4. Counts tool errors in a row. Opens after BREAKER_AFTER; one success resets it. */
export class Breaker {
  private inARow = 0;
  open = false;

  record(ok: boolean) {
    this.inARow = ok ? 0 : this.inARow + 1;
    if (this.inARow >= BREAKER_AFTER) this.open = true;
  }
}
