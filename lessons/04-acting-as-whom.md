---
title: Acting as whom
lesson: 4
code: src/defences/identity.ts
run: npm run lesson4
---

# Lesson 4 · Acting as whom

Every tool so far has quietly had the keys to everything. `find_booking` reads any booking. `issue_refund` refunds any amount. That's fine while the only person talking to the agent is trusted staff. The moment a guest can chat to it, the question is no longer "what can this tool do?" but "**who is it doing it for?**"

## The chat is not identity

It's tempting to let the conversation carry the answer: the guest says who they are, the agent believes them. That's the same mistake as trusting a hidden `<input name="role" value="admin">` because the form sent it. The chat is user input. Identity has to come from somewhere the user can't edit.

For tiny-stay that's a signed session cookie (`src/session.ts`). The "Sign in as" switch sets it; it's an HMAC of who you are, so the browser carries it but can't forge it:

```ts
export function verifySession(token) {
  const [payload, signature] = token.split(".");
  if (!timingSafeEqual(sign(payload), signature)) return null; // one edited character and it's rejected
  return userFrom(payload);
}
```

Tools act as that person. Never as whoever the chat claims to be.

## The demo: a guest reaching for someone else's booking

Signed in as the guest Ana, the chat asks about Tom's booking and tries to move it:

```bash
npm run lesson4
```

```text
── Identity OFF ──
tool → find_booking(BK-1042)   ← { guest: "Tom Brennan", room: "Harbour", … }
tool → change_booking(BK-1042, Lighthouse Suite)   ← Changed.
```

A guest just read, and changed, another guest's booking. With it on:

```text
── Identity ON ──
tool ✗ BK-1042 belongs to another guest. Guests can only see their own bookings.   [identity]
model  I can't show you BK-1042. Happy to help with your own booking instead.
```

The refusal happens *inside the tool*, before it reads a thing. The model only ever learns it was told no.

## Role rules live in code, next to the data

```ts
// src/defences/identity.ts
export function canSeeBooking(user, booking) {
  if (isStaff(user) || booking.guest_email === user.email) return yes;
  return no(`${booking.ref} belongs to another guest.`);
}
export function canRefund(user, amount) {
  if (user.role === "owner") return yes;
  if (user.role === "receptionist") return amount <= 100 ? yes : no("Over £100 needs the owner.");
  return no("Guests can't issue refunds.");
}
```

| | Owner | Receptionist | Guest |
| --- | --- | --- | --- |
| See or list bookings | all | all | her own |
| Change a booking | yes | yes | no |
| Refund | any amount | up to £100 | no |
| Inbox and notes | yes | yes | no |
| Export the ledger | yes | no | no |

Two things worth stealing from this. **The check is in the tool, not the prompt.** A sentence in the system prompt saying "guests may only see their own bookings" is the disabled button; the check in `find_booking` is the server saying no. Second, **the rule refuses a cross-tenant request whatever the model intended.** The model asked for `find_booking(BK-1042)` believing it was helping; the tool refused because Ana isn't Tom. The model's intent never entered into it.

## When the defence is off, the tools run as a service account

Switching identity off doesn't make the tools ask the prompt nicely. It makes them run as a built-in `assistant` account that's allowed everything, which is what an agent without identity really is. That's the honest baseline: either every call carries a real user, or every call is effectively an admin.

## Run it

```bash
npm run lesson4
npm start           # sign in as Ana, ask about BK-1042, toggle Identity. Then try as Dev, then Maggie.
```

## Try this

- Sign in as the receptionist (Dev) and ask for a £150 refund. Then sign in as the owner (Maggie) and ask for the same. Same request, different answer, decided in code.
- In the app, try to export the ledger as the receptionist. Where would you add that check? (It's `canExportLedger` in `src/defences/identity.ts`. Role checks are boring to write and that's the nicest thing about them.)
