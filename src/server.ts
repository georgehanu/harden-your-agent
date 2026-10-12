// The tiny-stay staff assistant. Plain node:http, no framework.
// npm start, then open http://localhost:3100
//
// The agent, the tools and the six defences are exactly the code the lessons use. The browser adds the
// one channel a terminal can't show: what the screen renders from the model's output (lesson 3), done
// here by a small hand-written markdown renderer in public/app.js.

import "./env.js";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { runAgent } from "./agent.js";
import { ROOMS, USERS, type User } from "./data/guesthouse.js";
import { TAXI_LOGO } from "./data/pages.js";
import { allOff, DEFENCE_IDS, DEFENCES, type Defences } from "./defences/index.js";
import { RECEPTIONIST_REFUND_LIMIT, RULES } from "./defences/identity.js";
import { confirmNote, discardNote } from "./defences/memory.js";
import { createLab } from "./lab.js";
import { costLine, live, MODELS } from "./model.js";
import { SAMPLE_IDS } from "./replays.js";
import { SCENARIOS, scenario } from "./scenarios.js";
import { seedCreditNote } from "./demo-setup.js";
import { COOKIE, sessionCookie, sessionFrom, type SignInAs } from "./session.js";
import { Store } from "./store.js";

const PORT = Number(process.env.PORT) || 3100;
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

// One running world, because it's a single-seat demo. The session is the exception: it lives in the
// signed cookie, so the "Sign in as" switch is the only thing that decides who the tools act as.
const store = new Store("app");
const lab = createLab();
let defences: Defences = allOff();

const handlers: Record<string, (body: Record<string, unknown>, user: User, res: ServerResponse) => Promise<object | void> | object | void> = {
  "GET /api/state": (_body, user) => state(user),

  "POST /api/session": (body, _user, res) => {
    const as = String(body.as) as SignInAs;
    if (!Object.hasOwn(USERS, as)) return { error: "No such sign-in." };
    res.setHeader("Set-Cookie", sessionCookie(as));
    return { ok: true, user: USERS[as] };
  },

  "POST /api/defences": (body) => {
    const id = String(body.id);
    if (!DEFENCE_IDS.includes(id as never)) return { error: "No such defence." };
    defences = { ...defences, [id]: Boolean(body.on) };
    return { defences };
  },

  "POST /api/lab": (body) => {
    if (body.paymentsDown !== undefined) lab.paymentsDown = Boolean(body.paymentsDown);
    if (body.pluginUpdated !== undefined) lab.pluginUpdated = Boolean(body.pluginUpdated);
    return { lab: { paymentsDown: lab.paymentsDown, pluginUpdated: lab.pluginUpdated } };
  },

  "POST /api/reset": () => {
    store.reset();
    return state(currentUser(undefined));
  },

  "POST /api/note": (body, user) => {
    const note = store.notes().find((n) => n.id === String(body.id));
    if (!note) return { error: "No such note." };
    if (user.role !== "owner" && user.role !== "receptionist") return { error: "Only staff can confirm a note." };
    store.saveNote(body.action === "confirm" ? confirmNote(note, `${user.name} (${user.role})`) : discardNote(note));
    return { notes: store.notes() };
  },

  "POST /api/run": async (body, user) => {
    const sample = typeof body.sample === "string" && SAMPLE_IDS.includes(body.sample) ? body.sample : undefined;
    const sc = sample ? scenario(sample) : undefined;
    const request = sc ? sc.request : String(body.request ?? "").trim();
    if (!request) return { error: "Type a request, or pick one from the list." };
    if (sc?.setup === "credit_note") seedCreditNote(store);

    const result = await runAgent({ request, session: user, defences, store, lab, sample });
    return { events: result.events, cost: costLine(result.calls), stoppedBecause: result.stoppedBecause, ...state(user) };
  },
};

function state(user: User) {
  return {
    live,
    models: MODELS,
    user,
    users: Object.fromEntries(Object.entries(USERS).map(([key, value]) => [key, { name: value.name, role: value.role, email: value.email ?? null }])),
    defences,
    defenceInfo: DEFENCES,
    lab: { paymentsDown: lab.paymentsDown, pluginUpdated: lab.pluginUpdated },
    scenarios: SCENARIOS.map((s) => ({ id: s.id, shows: s.shows, lesson: s.lesson, as: s.as, request: s.request, label: s.label })),
    rooms: ROOMS,
    bookings: store.bookings(),
    ledger: store.ledger(),
    notes: store.notes(),
    rules: RULES,
    refundLimit: RECEPTIONIST_REFUND_LIMIT,
  };
}

const currentUser = (cookie: string | undefined): User => sessionFrom(cookie) ?? USERS.owner;

createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const route = `${req.method} ${url.pathname}`;

  // The taxi logo: a real image on this server, so the renderer demo in lesson 3 has something to block.
  if (req.method === "GET" && url.pathname === "/lab/img/taxi-logo.svg") {
    res.writeHead(200, { "content-type": "image/svg+xml", "cache-control": "no-store" });
    return res.end(TAXI_LOGO);
  }

  const handler = handlers[route];
  if (handler) {
    try {
      const body = req.method === "POST" ? JSON.parse((await readBody(req)) || "{}") : {};
      const result = await handler(body, currentUser(req.headers.cookie), res);
      return json(res, 200, result ?? {});
    } catch (error) {
      console.error(error);
      return json(res, 200, { error: error instanceof Error ? error.message : "Something went wrong." });
    }
  }

  if (req.method === "GET") {
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (/^[\w.-]+$/.test(file)) {
      try {
        const content = await readFile(new URL(`../public/${file}`, import.meta.url));
        res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "text/plain" });
        return res.end(content);
      } catch {
        // fall through
      }
    }
  }
  json(res, 404, { error: "Not found" });
}).listen(PORT, () => {
  console.log(`\ntiny-stay assistant running at http://localhost:${PORT}`);
  console.log(live ? `live · agent: ${MODELS.smart}` : "replay mode · pre-written model turns for the sample requests. Add ANTHROPIC_API_KEY to .env to run live.");
  console.log(`cookie: ${COOKIE} · defences all off at first · ${store.bookings().length} bookings loaded`);
});

function json(res: ServerResponse, status: number, data: object) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 100_000) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
