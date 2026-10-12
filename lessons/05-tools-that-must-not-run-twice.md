---
title: Tools that must not run twice
lesson: 5
code: src/defences/once.ts
run: npm run lesson5
---

# Lesson 5 · Tools that must not run twice

Reading a file twice is harmless. Refunding a guest twice is a phone call from your boss. Agents retry: a tool result goes missing, a person asks the same thing again, a loop goes round once more "to be sure". So the tools that change the world have to be safe to run again. This is ordinary backend discipline, and the agent makes it compulsory rather than optional.

Five small guards, all in `src/defences/once.ts`, all checked before `issue_refund` or `change_booking` does anything.

## 1. An idempotency key

A key from `(ref, amount, reason)`, so the same refund asked twice is one refund:

```ts
export function refundKey(ref, amount, reason) {
  const words = reason.toLowerCase().replace(/[^a-z0-9£ ]+/g, " ").trim();
  return sha256(`${ref.toUpperCase()}|${amount.toFixed(2)}|${words}`).slice(0, 16);
}
```

```bash
npm run lesson5
```

```text
── Once OFF ──
tool → issue_refund(BK-1043, £15)   ← Refunded £15.00 (R-0001)
tool → issue_refund(BK-1043, £15)   ← Refunded £15.00 (R-0002)      ledger: £30.00

── Once ON ──
tool → issue_refund(BK-1043, £15)   ← Refunded £15.00 (R-0001)
tool → issue_refund(BK-1043, £15)   ✗ Already done. Same request, nothing new refunded.   ledger: £15.00
```

The second call found the first's key and returned it. Idempotent by construction, the way a payment API wants you to work anyway.

## 2. Look before you act

Read the ledger and the booking *before* the side effect, not after. A near-identical refund already there, or a booking that's cancelled, stops the call. You're reconstructing the current state from the record, not trusting the model's memory of it.

## 3. A budget per run

```ts
export const RUN_BUDGET = { refunds: 2, total: 150 };
```

Whatever the model has planned, one run may make at most two refunds and move at most £150. A confused loop can be wrong, but it can't be wrong for very much. Pick limits that cover the honest cases and nothing more.

## 4. A circuit breaker

```text
Circuit breaker: the payment service stops answering
  3 failed tool call(s), then the run stopped itself: circuit open.
```

Three tool errors in a row and the run stops for a person. A loop that keeps hitting the same wall is a bill that keeps growing, and the wall is rarely something a fourth try fixes.

## 5. Plausible numbers

The number that drives an action has to make sense against the record, wherever it came from. Harbour Tours' cancellations page says Sam is owed **£1,900** for a boat trip. A boat trip is £19; someone fat-fingered a decimal, or the page is lying.

```text
── Plausibility ON ──   (signed in as the owner, so the £100 role limit isn't what stops it)
tool ✗ £1,900 is more than BK-1044 has left to refund: £209 paid, £0 refunded. Check where that number came from.
```

The refund is checked against what the booking actually took, not against what a partner's web page claims. This is the lesson-2 idea — a number from outside is untrusted — applied to the one place it hurts most.

## None of this is AI code

Idempotency keys, a state check, a budget, a breaker, a sanity check. You'd write every one of these for a plain HTTP endpoint that moves money. The agent doesn't need new kinds of safety; it needs the old kinds made mandatory, because now the thing calling your endpoint improvises.

## Run it

```bash
npm run lesson5
npm start           # run the "refund a cot fee" task with Once off, then on, and watch the ledger
```

## Try this

- In the app, turn on "Payment service is down" (under *Make things go wrong*) and run a refund a few times with Once on. Watch the circuit breaker trip.
- Lower `RUN_BUDGET.total` to £10 and run the £15 cot refund. The budget refuses it. Where should the message tell the person to go next? A good limit also says what to do when you hit it.
