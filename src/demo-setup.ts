// One-off set-up a scenario needs before it runs.

import { TODAY } from "./data/guesthouse.js";
import type { Store } from "./store.js";

/** Lesson 6: a note already on Ana's file, saved (by an earlier run, with the memory gate off) from an email.
 *  It looks like fact. It isn't checked against her booking. Memory's money check is what catches it. */
export function seedCreditNote(store: Store) {
  store.addNote({
    guest_email: "ana.pereira@example.com",
    text: "Owed a £60 credit for a late check-in on her last visit.",
    source: { kind: "email", ref: "email E4 from ana.pereira@example.com", by: "the assistant (no gate)" },
    status: "active",
    created: TODAY,
    expires: null,
  });
}
