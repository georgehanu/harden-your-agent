// Notes about guests, kept on disk between runs: remember writes one, recall reads them back.
// Lesson 6 is about everything that can go wrong in between.

import { GUESTS, TODAY } from "../data/guesthouse.js";
import { canUseStaffTool } from "../defences/identity.js";
import { gateNote, provenance, recallable, waiting } from "../defences/memory.js";
import { allow, str, ToolError, type AgentTool } from "./core.js";

const EMAIL = { type: "string", description: "The guest's email address." };

export const remember: AgentTool = {
  tool: {
    name: "remember",
    description: "Save a short note about a guest, for their future stays.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { guest_email: EMAIL, note: { type: "string", description: "One or two sentences." } },
      required: ["guest_email", "note"],
      additionalProperties: false,
    },
  },
  run: ({ guest_email, note }, ctx) => {
    allow(canUseStaffTool(ctx.user, "remember"), "identity");
    const email = str(guest_email).toLowerCase();
    if (!GUESTS.some((g) => g.email === email)) throw new ToolError(`No guest with the email ${email}.`);
    const text = str(note);
    if (!text) throw new ToolError("The note is empty.");

    const gate = gateNote(ctx, text); // lesson 6: who wrote this, really?
    const saved = ctx.store.addNote({ guest_email: email, text, ...gate, created: TODAY });
    if (saved.status === "quarantined") {
      return `Saved ${saved.id} for ${email}, but it's waiting for a person to confirm it: it was written in a run that read untrusted text (${gate.source.ref}). It won't be recalled until someone does.`;
    }
    return `Saved ${saved.id} for ${email}${saved.expires ? `. It expires on ${saved.expires}` : ""}.`;
  },
};

export const recall: AgentTool = {
  tool: {
    name: "recall",
    description: "Read the saved notes about a guest.",
    strict: true,
    input_schema: { type: "object", properties: { guest_email: EMAIL }, required: ["guest_email"], additionalProperties: false },
  },
  run: ({ guest_email }, ctx) => {
    allow(canUseStaffTool(ctx.user, "recall"), "identity");
    const email = str(guest_email).toLowerCase();
    const notes = recallable(ctx, email);
    ctx.run.recalled.push(...notes);

    const held = ctx.defences.memory ? waiting(ctx, email) : 0;
    const footer = held ? `\n\n(${held} more note${held === 1 ? " is" : "s are"} waiting for a person to confirm, so not shown.)` : "";
    if (notes.length === 0) return `No notes for ${email}.${footer}`;

    ctx.run.untrustedRead.push(`notes about ${email}`);
    const shown = notes.map((note) =>
      ctx.outside(
        { kind: "note", id: note.id, from: provenance(note), date: note.created },
        `Note ${note.id}: ${note.text}${note.expires ? ` (kept until ${note.expires})` : ""}`,
      ),
    );
    return shown.join("\n\n") + footer;
  },
};
