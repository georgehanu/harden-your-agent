// Lesson 4 · Acting as whom
// npm run lesson4
//
// Signed in as the guest Ana, the chat asks about Tom's booking and tries to move it. The question the
// agent must get right isn't "is this allowed?" in the prompt. It's "whose session is this?", answered
// in code. Tools act as the person in the signed cookie, never as whoever the chat claims to be.

import { compare } from "./demo.js";
import { RULES } from "../defences/identity.js";
import * as print from "../print.js";

print.banner("Lesson 4 · Acting as whom");

const { off } = await compare({ sample: "guest-peek", lesson: 4 });

const leaked = off.result.events.some((e) => e.type === "tool_result" && e.name === "find_booking" && e.ok);
const changed = off.result.events.some((e) => e.type === "tool_result" && e.name === "change_booking" && e.ok);
print.note(
  leaked || changed
    ? `Off: the tools ran as a service account that can do anything, so a guest ${leaked ? "read another guest's booking" : ""}${leaked && changed ? " and " : ""}${changed ? "moved it" : ""}.`
    : "Off: the tools ran without checking who was asking.",
);
print.note("On: find_booking refused inside the tool (BK-1042 isn't Ana's), and change_booking refused (guests don't change bookings). The model only ever learns it was told no.");

print.rule("The rules, in code (src/defences/identity.ts)");
const width = RULES.map((row) => row[0].length).reduce((a, b) => Math.max(a, b));
for (const [action, owner, receptionist, guest] of RULES) {
  const cells = [owner, receptionist, guest].map((c) => c.padEnd(14)).join("");
  console.log(action ? `  ${action.padEnd(width)}  ${print.dim(cells)}` : print.dim(`  ${"".padEnd(width)}  ${["Owner", "Receptionist", "Guest"].map((c) => c.padEnd(14)).join("")}`));
}

print.note("A role check in a tool beats a sentence in the prompt for the same reason a server-side check beats a disabled button: the client can lie, the server can't be fooled.");
