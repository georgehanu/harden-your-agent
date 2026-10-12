// The signed session cookie (lesson 4).
// The server signs "who you are" with a secret only it knows (HMAC-SHA256). The browser carries the
// cookie but can't change it: edit one character and the signature no longer matches.

import "./env.js";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { USERS, type User } from "./data/guesthouse.js";

export const COOKIE = "stay_session";
const SECRET = process.env.SESSION_SECRET || randomBytes(32).toString("hex");
const MAX_AGE_SECONDS = 12 * 60 * 60;

export type SignInAs = keyof typeof USERS;

export function signSession(as: SignInAs, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ as, iat: Math.floor(now / 1000) })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The user in a valid, unexpired token. Null for anything else. */
export function verifySession(token: string | undefined, now = Date.now()): User | null {
  if (!token) return null;
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length > 0) return null;

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

  try {
    const { as, iat } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof iat !== "number" || now / 1000 - iat > MAX_AGE_SECONDS) return null;
    return Object.hasOwn(USERS, as) ? USERS[as as SignInAs] : null;
  } catch {
    return null;
  }
}

/** Reads the session from a Cookie header. */
export function sessionFrom(cookieHeader: string | undefined): User | null {
  const token = (cookieHeader ?? "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE}=`))
    ?.slice(COOKIE.length + 1);
  return verifySession(token);
}

export function sessionCookie(as: SignInAs) {
  return `${COOKIE}=${signSession(as)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}`;
}

function sign(payload: string) {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}
