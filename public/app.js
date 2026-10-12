// The staff assistant front end. Vanilla JS: fetch, render, done.
// The one piece worth a second look is the transcript renderer, which is the channel lesson 3 is about.

import { renderMarkdown, escapeHtml as esc } from "./render.js";

const $ = (sel) => document.querySelector(sel);
const api = async (path, body) =>
  (await fetch(path, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : undefined)).json();

let state = await api("/api/state");
let sample = ""; // the sample id behind the request box, or "" for a typed request
let lastEvents = null;
let lastCost = "";

// ── sign in ──────────────────────────────────────────────────────────────────
$("#signin").innerHTML = Object.entries(state.users)
  .map(([key, u]) => `<option value="${key}">${esc(u.name)} · ${u.role}${u.email ? ` (${esc(u.email)})` : ""}</option>`)
  .join("");
$("#signin").onchange = async (e) => {
  await api("/api/session", { as: e.target.value });
  state = await api("/api/state");
  render();
  toast(`Signed in as ${state.user.name} (${state.user.role}). Tools now act as this person.`);
};

// ── sample tasks ─────────────────────────────────────────────────────────────
$("#samples").innerHTML += state.scenarios
  .map((s) => `<option value="${s.id}">L${s.lesson} · ${esc(s.label)}</option>`)
  .join("");
$("#samples").onchange = (e) => {
  sample = e.target.value;
  const sc = state.scenarios.find((s) => s.id === sample);
  if (sc) {
    $("#request").value = sc.request;
    const want = state.users[sc.as];
    if (want && want.role !== state.user.role) toast(`This one makes sense signed in as ${want.name} (${sc.as}). Switch with "Sign in as".`);
  }
};
$("#request").oninput = () => {
  sample = "";
  $("#samples").value = "";
};

$("#run").onclick = run;
$("#request").onkeydown = (e) => {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) run();
};

async function run() {
  const request = $("#request").value.trim();
  if (!request) return toast("Type a request, or pick one from the list.");
  const button = $("#run");
  button.disabled = true;
  button.textContent = "Running…";
  try {
    const result = await api("/api/run", sample ? { sample } : { request });
    if (result.error) return toast(result.error);
    Object.assign(state, pick(result, ["user", "defences", "lab", "bookings", "ledger", "notes"]));
    lastEvents = result.events;
    lastCost = result.cost;
    render();
  } finally {
    button.disabled = false;
    button.textContent = "Run";
  }
}

// ── the transcript ───────────────────────────────────────────────────────────
function renderTranscript() {
  const box = $("#transcript");
  if (!lastEvents) {
    box.innerHTML = `<p class="empty">Pick a task below, or type your own, and watch what the agent does. Turn the defences on and off and run the same task again.</p>`;
    return;
  }
  const safe = state.defences.render;
  box.innerHTML = lastEvents.map((event) => renderEvent(event, safe)).join("") + (lastCost ? `<p class="cost">${esc(lastCost)}</p>` : "");
  box.scrollTop = box.scrollHeight;
}

function renderEvent(event, safe) {
  switch (event.type) {
    case "request":
      return `<div class="msg you"><span class="role">${esc(event.user.name)} · ${event.user.role}</span><p>${esc(event.text)}</p></div>`;
    case "scope":
      return `<div class="line scope"><b>scope</b> ${esc(scopeLine(event.scope))}</div>`;
    case "model":
      return event.text ? `<div class="msg bot"><span class="role">assistant</span><div class="md">${renderMarkdown(event.text, safe)}</div></div>` : "";
    case "tool_call":
      return `<div class="line call">→ <b>${esc(event.name)}</b>(${esc(short(JSON.stringify(event.input)))})</div>`;
    case "tool_result":
      return `<div class="line result ${event.ok ? "ok" : "bad"}">${event.ok ? "←" : "✗"} <code>${esc(short(oneLine(event.text), 220))}</code>${event.defence ? ` <span class="tag">${esc(event.defence)}</span>` : ""}</div>`;
    case "defence":
      return `<div class="line defence">⛉ <b>${esc(event.defence)}</b> ${esc(event.text)}</div>`;
    case "stop":
      return event.reason === "done" ? "" : `<div class="line stop">■ stopped: ${esc(event.reason.replace("_", " "))}</div>`;
    default:
      return "";
  }
}

// ── defences ─────────────────────────────────────────────────────────────────
function renderDefences() {
  $("#defence-list").innerHTML = state.defenceInfo
    .map(
      (d) => `<label class="switch defence-switch">
        <input type="checkbox" data-defence="${d.id}" ${state.defences[d.id] ? "checked" : ""}>
        <span><b>${d.lesson}. ${esc(d.name)}</b><small>${esc(d.what)}</small></span>
      </label>`,
    )
    .join("");
  for (const box of document.querySelectorAll("[data-defence]")) {
    box.onchange = async () => {
      const { defences } = await api("/api/defences", { id: box.dataset.defence, on: box.checked });
      state.defences = defences;
      render();
    };
  }
  const allOn = state.defenceInfo.every((d) => state.defences[d.id]);
  $("#toggle-all").textContent = allOn ? "all off" : "all on";
  $("#toggle-all").onclick = async () => {
    for (const d of state.defenceInfo) await api("/api/defences", { id: d.id, on: !allOn });
    state = await api("/api/state");
    render();
  };
}

// ── lab switches ─────────────────────────────────────────────────────────────
$("#lab-payments").onchange = async (e) => {
  state.lab = (await api("/api/lab", { paymentsDown: e.target.checked })).lab;
};
$("#lab-plugin").onchange = async (e) => {
  state.lab = (await api("/api/lab", { pluginUpdated: e.target.checked })).lab;
  toast(e.target.checked ? "A plugin changed recall's description. Turn the Memory defence on to see it caught." : "");
};

// ── views ────────────────────────────────────────────────────────────────────
for (const tab of document.querySelectorAll(".tab")) {
  tab.onclick = () => {
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    document.querySelectorAll(".views .view").forEach((v) => (v.hidden = v.id !== `view-${tab.dataset.view}`));
  };
}
$("#reset").onclick = async () => {
  state = await api("/api/reset");
  lastEvents = null;
  lastCost = "";
  render();
  toast("Sample data reset.");
};

function renderViews() {
  $("#view-bookings").innerHTML = `<table class="data"><thead><tr><th>Ref</th><th>Guest</th><th>Room</th><th>Dates</th><th>Paid</th><th>Refunded</th><th>Owed</th></tr></thead><tbody>${state.bookings
    .map(
      (b) => `<tr><td>${b.ref}</td><td>${esc(b.guest_name)}</td><td>${esc(b.room)}</td><td class="nowrap">${b.check_in} → ${b.check_out}</td><td>${money(b.paid)}</td><td>${money(
        refundedOn(b.ref),
      )}</td><td>${b.credit_owed ? money(b.credit_owed) : "—"}</td></tr>`,
    )
    .join("")}</tbody></table>`;

  $("#view-ledger").innerHTML = state.ledger.length
    ? `<table class="data"><thead><tr><th>#</th><th>Ref</th><th>Amount</th><th>Reason</th><th>By</th></tr></thead><tbody>${state.ledger
        .map((e) => `<tr><td>${e.id}</td><td>${e.ref}</td><td>${money(e.amount)}</td><td>${esc(e.reason)}</td><td class="small">${esc(e.by)}</td></tr>`)
        .join("")}</tbody></table><p class="muted small">Total refunded: ${money(state.ledger.reduce((s, e) => s + e.amount, 0))} · ${state.ledger.length} ${
        state.ledger.length === 1 ? "entry" : "entries"
      }</p>`
    : `<p class="muted">No refunds yet.</p>`;

  const canConfirm = state.user.role === "owner" || state.user.role === "receptionist";
  $("#view-memory").innerHTML = state.notes.length
    ? state.notes
        .map(
          (n) => `<div class="note ${n.status}">
          <p>${esc(n.text)}</p>
          <div class="note-meta"><span class="badge ${n.status}">${n.status}</span> <span class="muted small">${esc(n.guest_email)}</span></div>
          <div class="muted small">source: ${esc(sourceLine(n))}${n.expires ? ` · kept until ${n.expires}` : " · no expiry"}</div>
          ${n.status === "quarantined" && canConfirm ? `<div class="note-actions"><button class="small" data-confirm="${n.id}">Confirm</button><button class="ghost small" data-discard="${n.id}">Discard</button></div>` : ""}
        </div>`,
        )
        .join("")
    : `<p class="muted">No notes.</p>`;
  for (const button of document.querySelectorAll("[data-confirm]")) button.onclick = () => note(button.dataset.confirm, "confirm");
  for (const button of document.querySelectorAll("[data-discard]")) button.onclick = () => note(button.dataset.discard, "discard");

  $("#view-roles").innerHTML = `<table class="data roles">${state.rules
    .map((row, i) => `<tr>${row.map((cell) => `<${i === 0 ? "th" : "td"}>${esc(cell)}</${i === 0 ? "th" : "td"}>`).join("")}</tr>`)
    .join("")}</table><p class="muted small">These live in code (src/defences/identity.ts), checked inside every tool.</p>`;
}

async function note(id, action) {
  const result = await api("/api/note", { id, action });
  if (result.error) return toast(result.error);
  state.notes = result.notes;
  renderViews();
  toast(action === "confirm" ? "Note confirmed. It can be recalled now." : "Note discarded.");
}

// ── helpers ──────────────────────────────────────────────────────────────────
function render() {
  $("#mode").textContent = state.live ? `live · ${state.models.smart}` : "replay mode";
  $("#mode").title = state.live ? "" : "Pre-written model turns for the sample requests. Add ANTHROPIC_API_KEY to .env to run live.";
  $("#signin").value = Object.keys(state.users).find((k) => state.users[k].role === state.user.role) ?? "owner";
  $("#who").textContent = `tools act as ${state.user.name} (${state.user.role})`;
  $("#lab-payments").checked = state.lab.paymentsDown;
  $("#lab-plugin").checked = state.lab.pluginUpdated;
  renderDefences();
  renderTranscript();
  renderViews();
}

const money = (n) => `£${Number(n).toFixed(2)}`;
const refundedOn = (ref) => state.ledger.filter((e) => e.ref === ref).reduce((s, e) => s + e.amount, 0);
const oneLine = (t) => String(t).replace(/\s+/g, " ").trim();
const short = (t, max = 150) => (t.length > max ? t.slice(0, max - 1) + "…" : t);
const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in obj).map((k) => [k, obj[k]]));
const scopeLine = (s) =>
  `tools: ${s.tools.join(", ") || "none"} · ${s.open_ended ? "any booking" : [...s.booking_refs, ...s.guests].join(", ") || "no bookings named"}${
    s.max_refund === null ? "" : ` · refunds ≤ £${s.max_refund}`
  }`;
const sourceLine = (n) => (n.source.kind === "unknown" ? "not recorded" : `${n.source.kind} — ${n.source.ref}${n.confirmed_by ? `, confirmed by ${n.confirmed_by}` : ""}`);

let toastTimer;
function toast(message) {
  const el = $("#toast");
  if (!message) return (el.hidden = true);
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

render();
