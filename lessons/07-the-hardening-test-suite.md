---
title: The hardening test suite
lesson: 7
code: harden/check.ts
run: npm run harden-check
---

# Epilogue · The hardening test suite

Six defences. Each one proved by a terminal demo where you watch it off, then on. Demos are good for learning and useless for CI: nobody reads a transcript on every pull request. So the same fixtures run as a test suite.

```bash
npm run harden-check
```

```text
Hardening check · 29 cases

PASS  boundaries   untrusted text is wrapped with its source
PASS  intent       a tool outside the scope is refused
PASS  intent       normalisation strips comments, hidden elements and invisible characters
PASS  render       the safe renderer blocks remote images, shows link hosts, drops raw HTML
PASS  render       fetch_page re-checks after a redirect into a private address
PASS  identity     a guest can't see another guest's booking
PASS  once         the same refund twice returns the first, not a second
PASS  once         the circuit breaker opens after three errors in a row
PASS  memory       a refund that rests on memory is cross-checked against the booking
PASS  memory       a changed tool definition is detected; the hash ignores key order
…
By defence
  ✓ boundaries   3/3   ✓ intent 4/4   ✓ render 6/6   ✓ identity 5/5   ✓ once 6/6   ✓ memory 5/5

all passed  (29/29)
```

## It tests the code, not the model

This is the whole reason the suite can exist. Every case drives a **code-level** defence and asserts a yes/no outcome: the scope check refuses an out-of-scope tool, `fetch_page` refuses a redirect to a private address, `canSeeBooking` refuses a cross-tenant lookup, the idempotency key collapses a double refund. None of it calls the model.

That's deliberate, and it's the thread running through all six lessons. You cannot unit-test "the model resists a cleverly worded email", because the answer is "usually", and usually isn't a test. You *can* unit-test the code that holds whatever the model does. So that's where the defences live, and that's what this suite guards.

A nice property falls out: **a test that proves "on" works should also prove "off" fails.** The suite includes cases that run a defence with the switch off and assert the bad thing happens. If "off" ever stops failing, the test was checking nothing.

```ts
check("identity", "the same lookup with identity off is not refused", async () => {
  const leak = await runTool(findBooking, { ref: "BK-1042" }, ctxFor("guest", store, allOff()));
  return expect(leak.ok, "with identity off the tool should run — else this test proves nothing");
});
```

## Drop it into CI

It exits non-zero on any failure, so it's one line in a workflow:

```yaml
- run: npm run typecheck
- run: npm run harden-check
```

Add a case every time a real request surprises you. A production incident becomes case thirty, and it never comes back quietly.

## The one-page checklist

Before an agent that can act on the world goes near a customer:

- [ ] **Boundaries.** Every tool result from outside is wrapped as labelled data with its source, and the system prompt says so. (You know which tools those are. You wrote the list in lesson 1.)
- [ ] **Intent.** The request is turned into a scope before the agent reads anything, and every tool call is checked against it. Untrusted text is normalised to what a person would see, and removals are logged.
- [ ] **Render.** The UI renders no remote images, shows every link's real host, auto-navigates nowhere, and allows no raw HTML.
- [ ] **Fetch.** Server-side fetches use an allowlist, refuse loopback/private/link-local addresses, re-check after redirects, and cap size and time.
- [ ] **Identity.** Tools act as the user from a signed session, never from the chat. Role rules are in code, and cross-tenant access is refused inside the tool.
- [ ] **Idempotency.** Actions that change the world are safe to retry: an idempotency key, a state check before the side effect, a budget per run, a circuit breaker, and a plausibility check on numbers from outside.
- [ ] **Memory.** Only person-authored notes become durable; the rest wait for confirmation. Every note has a source and an expiry. Recall returns data. Memory alone can't move money. Tool definitions are pinned at startup.
- [ ] **A test for each.** A corpus runs the code-level defences in CI, and the "off" cases fail.

## The one idea, if you keep one

A prompt is advice to the model. A boundary is code the model runs inside. Lesson 1's label helped and couldn't be trusted; everything after it was code, and could be. When you build your own agent, write the advice, by all means. Then, for everything that reads untrusted text or changes the world, write the code too, and a test that fails without it.

That's the series. If it helped, tell me what you hardened: [@georgehanu](https://x.com/georgehanu).

## Where to go next

- Anthropic, [*Building effective agents*](https://www.anthropic.com/engineering/building-effective-agents), for the patterns underneath the loop.
- The OWASP [Top 10 for LLM Applications](https://owasp.org/www-project-top-10-for-large-language-model-applications/), which names most of what these lessons defend against.
- [The Agent Loop](https://georgehanu.github.io/the-agent-loop/), the companion that builds the agent this series hardens.
