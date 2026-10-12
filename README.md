# Harden Your Agent

**Your agent works. Now make it safe to ship. Six lessons, one real TypeScript agent, each defence proved by a test.**

By George Hanu · [@georgehanu](https://x.com/georgehanu) · [Read it as a website](https://georgehanu.github.io/harden-your-agent/)

You can build an agent: a model, some tools, a loop. Getting it to *work* is the easy part. This series takes a small agent for a guesthouse and adds, one lesson at a time, the defences a real product needs when the agent reads untrusted text and can change the world. Every defence is a small, switchable module, and every one is proved by a test you can run.

```text
npm run lesson5

you    Refund Lena the £15 cot fee on BK-1043.

── Once OFF ──
tool → issue_refund(BK-1043, £15)   ← Refunded £15.00 (R-0001)
tool → issue_refund(BK-1043, £15)   ← Refunded £15.00 (R-0002)      ledger: £30.00, paid twice
── Once ON ──
tool → issue_refund(BK-1043, £15)   ← Refunded £15.00 (R-0001)
tool → issue_refund(BK-1043, £15)   ✗ Already done. Nothing new refunded.   ledger: £15.00
```

## The lessons

| # | Lesson | Defence | Run |
| --- | --- | --- | --- |
| 1 | [Where untrusted text gets in](lessons/01-where-untrusted-text-gets-in.md) | Boundaries: label outside text as data | `npm run lesson1` |
| 2 | [Keep the agent on task](lessons/02-keep-the-agent-on-task.md) | Intent anchor + normalisation | `npm run lesson2` |
| 3 | [What the screen and the fetch tool can give away](lessons/03-the-screen-and-the-fetch-tool.md) | Render policy + safe fetch | `npm run lesson3` |
| 4 | [Acting as whom](lessons/04-acting-as-whom.md) | Identity from a signed session, role checks in code | `npm run lesson4` |
| 5 | [Tools that must not run twice](lessons/05-tools-that-must-not-run-twice.md) | Idempotency, budgets, circuit breaker, plausibility | `npm run lesson5` |
| 6 | [Memory you can trust](lessons/06-memory-you-can-trust.md) | Write gate, provenance, expiry, cross-check, pinned tools | `npm run lesson6` |
| + | [The hardening test suite](lessons/07-the-hardening-test-suite.md) | A corpus for CI, and a one-page checklist | `npm run harden-check` |

Each lesson takes 5 to 10 minutes to read, and its demo runs the same scenario with the defence off, then on, so you see the difference deterministically.

## Quick start

You need Node.js 20 or newer.

```bash
git clone https://github.com/georgehanu/harden-your-agent.git
cd harden-your-agent
npm install
npm run lesson1
```

Then run the app:

```bash
npm start
```

Open http://localhost:3100. Sign in as the Owner, Receptionist or guest Ana; chat to the assistant; toggle each defence in the **Defences** panel and run the same task again.

**No API key needed to start.** Without a key, every lesson and the app run in *replay mode*: the model's turns are pre-written for the sample requests, but everything else is real. The loop runs, the tools read and write files on disk, and all six defences are the exact code that would run live.

**To run against Claude**, copy `.env.example` to `.env` and add your key from the [Claude Console](https://platform.claude.com/):

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Two models are used: `claude-opus-5-5` runs the agent, `claude-haiku-5-5` reads the request into a scope (lesson 2). Change them with `SMART_MODEL` and `FAST_MODEL` in `.env`.

## What's inside

```text
lessons/              the six lessons and the epilogue (start here)
src/agent.ts          the agent loop, with a place for each defence
src/defences/         one module per defence: boundaries, intent, render, fetch, identity, once, memory, pinned
src/tools/            the eight tools: bookings, inbox, pages, notes
src/model.ts          live Claude calls + replay mode, with the cost line
src/server.ts         the app's server (plain node:http)
public/               the staff assistant UI (vanilla JS, its own markdown renderer)
src/data/             the invented guesthouse: guests, bookings, inbox, lab pages
harden/check.ts       the hardening test suite: npm run harden-check
scripts/build-site.mjs  builds the lessons into docs/ for GitHub Pages
```

Everything is simulated locally. The "partner web pages" live in `src/data/pages.ts` and are served from an in-memory lab network; there is no external endpoint anywhere in the product.

## Who it's for

Developers who've built an agent, or used the ones that exist, and want to understand what it takes to put one in front of real users. You should be comfortable with TypeScript. No security background needed: the point of the series is that these defences are ordinary backend work, made mandatory because the thing calling your code now improvises.

This builds on [The Agent Loop](https://georgehanu.github.io/the-agent-loop/): there you build the agent; here you make one safe enough to ship. Its companion, [AI Buttons](https://georgehanu.github.io/ai-buttons/), covers the simpler case of AI features that aren't agents at all.

## License

MIT. Use the code in your own projects, workshops or teaching. A link back is appreciated.
