// Builds the GitHub Pages site in docs/ from lessons/*.md.
// Usage: npm run site

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js";

const REPO = "https://github.com/georgehanu/harden-your-agent";
const X = "https://x.com/georgehanu";
const SITE = "https://georgehanu.github.io/harden-your-agent/";
// The share image is built by the hub (georgehanu.github.io) from its guide data, so every guide's
// link preview uses the same template. The index and every lesson use it.
const OG_IMAGE = "https://georgehanu.github.io/og/guides/harden-your-agent.png";
const OG_IMAGE_ALT =
  "Harden Your Agent: add the defences a real product needs to a small TypeScript agent, each proved by a test. Coding with AI, by George Hanu.";
const root = new URL("../", import.meta.url);
const out = new URL("docs/", root);
mkdirSync(out, { recursive: true });

const marked = new Marked(
  markedHighlight({
    emptyLangClass: "hljs",
    langPrefix: "hljs language-",
    highlight(code, lang) {
      const language = hljs.getLanguage(lang) ? lang : "plaintext";
      return hljs.highlight(code, { language }).value;
    },
  }),
);

const lessons = readdirSync(new URL("lessons/", root))
  .filter((file) => file.endsWith(".md"))
  .sort()
  .map((file) => {
    const raw = readFileSync(new URL(`lessons/${file}`, root), "utf8").replace(/\r\n/g, "\n");
    const [, front, body] = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const meta = Object.fromEntries(
      front.split("\n").map((line) => {
        const [key, ...rest] = line.split(":");
        return [key.trim(), rest.join(":").trim().replace(/^"|"$/g, "")];
      }),
    );
    return { file, slug: file.replace(/\.md$/, ""), ...meta, body };
  });

const summaries = {
  1: "Where untrusted text gets in, and why a system prompt is not a boundary.",
  2: "An intent anchor and normalisation keep the agent on the task you set.",
  3: "The screen and the fetch tool are channels too. Lock both down.",
  4: "Act as the signed-in person, with role rules checked in code.",
  5: "Make the tools that move money safe to retry, and hard to push past sense.",
  6: "Notes you can trust: a write gate, provenance, expiry, and pinned tools.",
  7: "The hardening test suite, and a one-page checklist for CI.",
};

const EPILOGUE = "7";
const label = (lesson) => (lesson.lesson === EPILOGUE ? "Epilogue" : `Lesson ${lesson.lesson}`);
const num = (lesson) => (lesson.lesson === EPILOGUE ? "+" : lesson.lesson);

function rewriteLinks(html) {
  return html
    .replace(/href="(\d\d-[a-z-]+)\.md"/g, 'href="$1.html"')
    .replace(/href="\.\.\/(src|harden|public)\/([^"]*)"/g, `href="${REPO}/blob/main/$1/$2"`);
}

const attr = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

function page({ title, description, body, current }) {
  const url = current === "index" ? SITE : `${SITE}${current}.html`;
  const social = `<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${attr(title)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:image" content="${OG_IMAGE}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${attr(OG_IMAGE_ALT)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:creator" content="@georgehanu">
<meta name="twitter:title" content="${attr(title)}">
<meta name="twitter:description" content="${attr(description)}">
<meta name="twitter:image" content="${OG_IMAGE}">
<meta name="twitter:image:alt" content="${attr(OG_IMAGE_ALT)}">`;
  const nav = lessons
    .map((l) => `<a href="${l.slug}.html"${l.slug === current ? ' aria-current="page"' : ""}><span>${num(l)}</span>${l.title}</a>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
${social}
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>&#128737;</text></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
<script data-goatcounter="https://georgehanu.goatcounter.com/count" async src="https://gc.zgo.at/count.js"></script>
</head>
<body>
<header class="top">
  <a class="brand" href="index.html"><span class="loop">&#128737;</span> Harden Your Agent</a>
  <nav class="top-links">
    <a href="${REPO}">GitHub</a>
    <a class="follow" href="${X}">Follow @georgehanu</a>
  </nav>
</header>
${
  current === "index"
    ? body
    : `<div class="layout">
  <aside class="side"><div class="side-title">Lessons</div>${nav}</aside>
  <main class="lesson">${body}</main>
</div>`
}
<footer class="foot">
  <p>Written by <a href="${X}">George Hanu</a>. I teach developers to build software with AI: small examples, explained clearly.</p>
  <p><a href="${X}">Follow on X</a> · <a href="${REPO}">Source on GitHub</a> · MIT licensed</p>
</footer>
</body>
</html>
`;
}

lessons.forEach((lesson, i) => {
  const prev = lessons[i - 1];
  const next = lessons[i + 1];
  const meta =
    lesson.run || lesson.code
      ? `<div class="meta">${lesson.run ? `<span>Run</span><code>${lesson.run}</code>` : ""}${
          lesson.code ? `<a href="${REPO}/blob/main/${lesson.code}">View the code →</a>` : ""
        }</div>`
      : "";
  const pager = `<nav class="pager">${
    prev ? `<a href="${prev.slug}.html"><small>← ${label(prev)}</small>${prev.title}</a>` : "<span></span>"
  }${next ? `<a class="next" href="${next.slug}.html"><small>${label(next)} →</small>${next.title}</a>` : ""}</nav>`;
  const cta = `<aside class="cta"><strong>Found this useful?</strong> I post small, practical AI coding examples most days.
  <a href="${X}">Follow @georgehanu on X</a></aside>`;

  writeFileSync(
    new URL(`${lesson.slug}.html`, out),
    page({
      title: `${label(lesson)}: ${lesson.title} · Harden Your Agent`,
      description: `${lesson.title}. Part of Harden Your Agent: add the defences a real product needs to a small TypeScript agent, each proved by a test.`,
      body: `${meta}${rewriteLinks(marked.parse(lesson.body))}${cta}${pager}`,
      current: lesson.slug,
    }),
  );
});

const cards = lessons
  .map(
    (l) => `<a class="card" href="${l.slug}.html">
      <span class="num">${num(l)}</span>
      <span class="card-title">${l.title}</span>
      <span class="card-sub">${summaries[l.lesson] ?? ""}</span>
    </a>`,
  )
  .join("\n");

const home = `
<main class="home">
  <section class="hero">
    <p class="eyebrow">Free · 6 lessons + epilogue · TypeScript · A real agent</p>
    <h1>Your agent works.<br><em>Now harden it.</em></h1>
    <p class="lead">Take a small TypeScript agent for a guesthouse and add, one lesson at a time, the defences a real
      product needs: boundaries, an intent anchor, a render and fetch policy, identity, idempotency, and memory you can
      trust. Each defence is a small module, switchable, and proved by a test you can run.</p>
    <div class="actions">
      <a class="btn primary" href="${lessons[0].slug}.html">Start lesson 1</a>
      <a class="btn" href="${REPO}">Get the code</a>
    </div>
  </section>

  <section class="terminal" aria-label="Example run">
    <div class="bar"><i></i><i></i><i></i><span>npm run lesson5</span></div>
<pre><span class="t-you">you</span>    Refund Lena the £15 cot fee on BK-1043.

<span class="t-dim">── Once OFF ─────────────────────────────</span>
<span class="t-cyan">tool →</span> issue_refund(BK-1043, £15)  <span class="t-green">←</span> <span class="t-dim">Refunded £15.00 (R-0001)</span>
<span class="t-cyan">tool →</span> issue_refund(BK-1043, £15)  <span class="t-green">←</span> <span class="t-dim">Refunded £15.00 (R-0002)</span>
<span class="t-red">ledger: 2 refunds, £30.00</span>        <span class="t-dim">the guest was paid twice</span>

<span class="t-dim">── Once ON ──────────────────────────────</span>
<span class="t-cyan">tool →</span> issue_refund(BK-1043, £15)  <span class="t-green">←</span> <span class="t-dim">Refunded £15.00 (R-0001)</span>
<span class="t-cyan">tool →</span> issue_refund(BK-1043, £15)  <span class="t-red">✗</span> <span class="t-dim">Already done. Nothing new refunded.</span>
<span class="t-green">ledger: 1 refund, £15.00</span>        <span class="t-dim">safe to retry</span></pre>
  </section>

  <section class="points">
    <div><h3>A real agent, not snippets</h3><p>A staff assistant for a small guesthouse: an inbox, partner pages, bookings, a refunds ledger and notes on disk. Run it with <code>npm start</code>.</p></div>
    <div><h3>No API key to start</h3><p>Every lesson and the app run in replay mode with pre-written model turns. The loop, the tools and all six defences are the real code. Add a key to run it live.</p></div>
    <div><h3>Each defence is a test</h3><p><code>npm run harden-check</code> runs a corpus of fixtures through the code-level defences with a pass/fail table, meant for CI.</p></div>
  </section>

  <section>
    <h2>The lessons</h2>
    <div class="cards">${cards}</div>
  </section>

  <section class="start">
    <h2>Run it in a minute</h2>
<pre><code>git clone ${REPO}.git
cd harden-your-agent
npm install
npm run lesson1</code></pre>
    <p>Node.js 20 or newer. Then try <code>npm start</code> and open <code>http://localhost:3100</code>.</p>
  </section>

  <section class="author">
    <div>
      <h2>Hi, I'm George.</h2>
      <p>I'm a senior web developer. I teach developers to build software with AI, from useful scripts to app features.
        Small examples, explained clearly. This builds on <a href="https://georgehanu.github.io/the-agent-loop/">The Agent Loop</a>:
        there you build an agent; here you make one safe enough to ship. If it helped, the best thanks is a follow.</p>
      <a class="btn primary" href="${X}">Follow @georgehanu on X</a>
    </div>
  </section>
</main>`;

writeFileSync(
  new URL("index.html", out),
  page({
    title: "Harden Your Agent · The defences a real agent needs",
    description:
      "Six lessons that add the defences a real product needs to a small TypeScript agent: boundaries, intent, render and fetch, identity, idempotency, memory. Each proved by a test. By George Hanu.",
    body: home,
    current: "index",
  }),
);

writeFileSync(new URL(".nojekyll", out), "");
writeFileSync(new URL("style.css", out), readFileSync(new URL("scripts/site.css", root), "utf8"));
console.log(`Built ${lessons.length + 1} pages in docs/`);
