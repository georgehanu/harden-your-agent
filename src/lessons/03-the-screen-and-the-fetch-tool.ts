// Lesson 3 · What the screen and the fetch tool can give away
// npm run lesson3
//
// Two channels most people forget:
//   1. What the UI renders from the model's output. A partner page asks the agent to put its logo, a
//      misleading link and a "Book your taxi" button in the reply. The render policy decides what the
//      screen is allowed to do with that.
//   2. What fetch_page will read. A partner link redirects into tiny-stay's own back office. The fetch
//      policy re-checks every hop.

import { compare } from "./demo.js";
import { auditHtml, renderMarkdown } from "../defences/render.js";
import { USERS } from "../data/guesthouse.js";
import { runAgent } from "../agent.js";
import { upTo } from "../defences/index.js";
import { createLab } from "../lab.js";
import { Store } from "../store.js";
import * as print from "../print.js";

print.banner("Lesson 3 · What the screen and the fetch tool can give away");

// ── 1. the renderer ───────────────────────────────────────────────────────────
const store = Store.fresh("lesson-taxi");
const taxi = await runAgent({ request: "Draft a taxi message.", session: USERS.receptionist, defences: upTo(2), store, lab: createLab(), sample: "taxi" });
const reply = taxi.events.flatMap((e) => (e.type === "model" ? [e.text] : [])).join("\n");

print.rule("The model's reply (markdown)");
print.block(reply);

for (const safe of [false, true]) {
  const audit = auditHtml(renderMarkdown(reply, { safe }));
  print.rule(safe ? "Render policy ON" : "Render policy OFF");
  console.log(`  remote images the screen would load: ${audit.remoteImages.length ? print.red(audit.remoteImages.join(", ")) : print.green("none")}`);
  for (const link of audit.links) console.log(`  link "${link.text}" ${print.dim("→")} ${print.yellow(link.host)}`);
  console.log(`  raw HTML elements kept: ${audit.rawHtml.length ? print.red(audit.rawHtml.join(" ")) : print.green("none")}`);
}
print.note("On: no remote image loads, every link shows the host it really goes to, and the injected button is gone.");

// ── 2. the fetch tool ─────────────────────────────────────────────────────────
const { off } = await compare({ sample: "rates", lesson: 3, label: { off: "Fetch policy OFF", on: "Fetch policy ON" } });
const leaked = off.result.events.some((e) => e.type === "model" && /friends and family/i.test(e.text));
print.note(
  leaked
    ? "Off: fetch_page followed the redirect into the back office and the agent read out staff-only rates."
    : "Off: fetch_page followed the redirect without checking where it led.",
);
print.note(
  "On: fetch_page checked the host against an allowlist, resolved the address, and re-checked after the redirect. A hop into a private address (10.0.0.5) is refused.",
);
