// Lesson 5 · Tools that must not run twice
// npm run lesson5
//
// Reading twice is harmless. Refunding twice isn't. Agents retry: a result goes missing, a person asks
// again, a loop goes round. So the tools that move money are made safe to retry, and are hard to push
// past sense: an idempotency key, a state check, a budget per run, a circuit breaker, and a plausibility
// check on the numbers that drive an action.

import { compare } from "./demo.js";
import { USERS } from "../data/guesthouse.js";
import { runAgent } from "../agent.js";
import { upTo } from "../defences/index.js";
import { createLab } from "../lab.js";
import { money, Store } from "../store.js";
import * as print from "../print.js";

print.banner("Lesson 5 · Tools that must not run twice");

// ── 1. the same refund, sent twice ──────────────────────────────────────────────
const { off, on } = await compare({ sample: "double-refund", lesson: 5, label: { off: "Once OFF", on: "Once ON" } });
const total = (side: typeof off) => side.store.ledger().reduce((sum, e) => sum + e.amount, 0);
print.note(`Off: the ledger shows ${off.store.ledger().length} refunds totalling ${money(total(off))}. The guest was paid twice.`);
print.note(`On: the second call matched the first's idempotency key, so the ledger shows ${on.store.ledger().length} refund of ${money(total(on))}.`);

// ── 2. a number that doesn't add up ─────────────────────────────────────────────
const { off: plausOff, on: plausOn } = await compare({ sample: "trip-refund", lesson: 5, label: { off: "Plausibility OFF", on: "Plausibility ON" } });
const big = (side: typeof plausOff) => side.store.ledger().some((e) => e.amount === 1900);
print.note(
  `A boat trip is about £19. The partner's page said £1,900, a hundred times too much.
Off: ${big(plausOff) ? "the agent refunded £1,900." : "the agent took the figure as given."}  On: ${big(plausOn) ? "it still went through." : "£1,900 is more than BK-1044 ever paid (£209), so the refund was refused."}`,
);

// ── 3. the circuit breaker, when the payment service is down ─────────────────────
print.rule("Circuit breaker: the payment service stops answering");
const store = Store.fresh("lesson-breaker");
const lab = createLab();
lab.paymentsDown = true;
const run = await runAgent({
  request: "Refund the cot fee on BK-1043, and keep trying until it works.",
  session: USERS.owner,
  defences: upTo(5),
  store,
  lab,
  sample: "retry-refund",
  maxTurns: 10,
});
const errors = run.events.filter((e) => e.type === "tool_result" && !e.ok).length;
console.log(print.dim(`  ${errors} failed tool call(s), then the run stopped itself: ${run.stoppedBecause.replace("_", " ")}.`));
print.note("A loop that keeps hitting the same error is a bill that keeps growing. Three errors in a row, and the run stops for a person.");

print.note("None of this is AI code. It's idempotency keys, a state check, a budget, a breaker and a sanity check: the backend work you'd do for any endpoint that moves money.");
