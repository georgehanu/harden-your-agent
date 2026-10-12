// The six defences, one per lesson. Each one is a small module in this folder and a switch in the app.
// They all start off, so you can watch each one change what happens.

export const DEFENCES = [
  {
    id: "boundaries",
    lesson: 1,
    name: "Boundaries",
    what: "Emails, pages and notes reach the model as labelled data with their source, and the system prompt says what that means.",
    file: "src/defences/boundaries.ts",
  },
  {
    id: "intent",
    lesson: 2,
    name: "Intent anchor",
    what: "The request becomes a scope before the agent reads anything. Code checks every tool call against it. Hidden text is removed.",
    file: "src/defences/intent.ts",
  },
  {
    id: "render",
    lesson: 3,
    name: "Render and fetch policy",
    what: "No remote images, every link shows its real host, no raw HTML. fetch_page only reads allowed public hosts, within limits.",
    file: "src/defences/render.ts + fetch.ts",
  },
  {
    id: "identity",
    lesson: 4,
    name: "Identity",
    what: "Tools act as the person in the signed session, never as whoever the chat claims. Role rules live in code.",
    file: "src/defences/identity.ts",
  },
  {
    id: "once",
    lesson: 5,
    name: "Once",
    what: "Refunds and changes are safe to retry: idempotency keys, state checks, a budget per run, a circuit breaker, plausible numbers.",
    file: "src/defences/once.ts",
  },
  {
    id: "memory",
    lesson: 6,
    name: "Memory",
    what: "Notes from emails or pages wait for a person. Every note has a source and an expiry. Memory can't move money alone. Tools are pinned.",
    file: "src/defences/memory.ts + pinned.ts",
  },
] as const;

export type DefenceId = (typeof DEFENCES)[number]["id"];
export type Defences = Record<DefenceId, boolean>;

export const DEFENCE_IDS = DEFENCES.map((d) => d.id) as DefenceId[];

export function allOff(): Defences {
  return Object.fromEntries(DEFENCE_IDS.map((id) => [id, false])) as Defences;
}

export function allOn(): Defences {
  return Object.fromEntries(DEFENCE_IDS.map((id) => [id, true])) as Defences;
}

/** The defences from lessons 1 to `lesson`, switched on. Lesson demos use this: each lesson adds one. */
export function upTo(lesson: number): Defences {
  return Object.fromEntries(DEFENCES.map((d) => [d.id, d.lesson <= lesson])) as Defences;
}

export function defenceName(id: DefenceId) {
  const defence = DEFENCES.find((d) => d.id === id)!;
  return `${defence.name} (lesson ${defence.lesson})`;
}
