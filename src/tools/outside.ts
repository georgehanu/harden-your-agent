// The two tools that read from outside tiny-stay: the guest inbox and the web.
// Whatever they return is untrusted, so it goes through ctx.outside() on its way to the model.

import { INBOX } from "../data/inbox.js";
import { fetchPage } from "../defences/fetch.js";
import { canUseStaffTool } from "../defences/identity.js";
import { allow, str, type AgentTool } from "./core.js";

export const readInbox: AgentTool = {
  tool: {
    name: "read_inbox",
    description: "Read today's emails in the guest inbox.",
    strict: true,
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  run: (_, ctx) => {
    allow(canUseStaffTool(ctx.user, "read_inbox"), "identity");
    ctx.run.untrustedRead.push(`inbox (emails ${INBOX[0].id} to ${INBOX.at(-1)!.id})`);
    return INBOX.map((email) =>
      ctx.outside(
        { kind: "email", id: email.id, from: email.from, date: email.received },
        `Email ${email.id}\nFrom: ${email.from_name} <${email.from}>\nReceived: ${email.received}\nSubject: ${email.subject}\n\n${email.body}`,
      ),
    ).join("\n\n");
  },
};

export const fetchPageTool: AgentTool = {
  tool: {
    name: "fetch_page",
    description: "Read a web page and return what it says.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "The full address, like http://harbour-tours.test/trips." } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  run: async ({ url }, ctx) => {
    // Lesson 3: with the defence on, fetchPage checks the host, the address, every redirect, size and time.
    const page = await fetchPage(str(url), ctx.defences.render);
    ctx.run.untrustedRead.push(`page ${page.url}`);
    return ctx.outside({ kind: "page", id: page.url, from: new URL(page.url).host }, page.body);
  },
};
