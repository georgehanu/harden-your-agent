// Defence 3 · Fetch policy (lesson 3)
//
// fetch_page runs on your server, inside your network, and the URL often comes from text you don't
// control: an email, a page, a guest in the chat. So the safe version:
//
//   - reads only http and https, on the normal ports, from an allowlist of partner hosts
//   - looks up the address and refuses anything that points inwards: loopback, private, link-local
//   - checks every redirect hop again, because an allowed host can redirect anywhere
//   - stops at 200 KB and 1.5 seconds
//
// The lab network (src/lab.ts) stands in for the internet, so all of this runs without a real request.

import { LabError, labGet, resolveHost } from "../lab.js";
import { Refused, ToolError } from "../tools/core.js";

export const FETCH_POLICY = {
  allowedHosts: ["harbour-tours.test", "porthwen-taxis.test"],
  maxBytes: 200_000,
  maxMs: 1500,
  maxRedirects: 3,
};

export interface Fetched {
  url: string;
  body: string;
  /** Every URL visited, first to last. */
  hops: string[];
}

export async function fetchPage(address: string, safe: boolean): Promise<Fetched> {
  let url = parse(address);
  const hops = [url.href];
  const deadline = Date.now() + FETCH_POLICY.maxMs;

  for (let redirects = 0; ; redirects++) {
    if (safe) {
      const problem = checkUrl(url);
      if (problem) throw new Refused("render", hops.length > 1 ? `${hostOf(hops.at(-2)!)} redirected to ${url.href}. ${problem}` : problem);
    }

    const response = safe ? await withDeadline(url, deadline) : await get(url);
    if (response.status >= 300 && response.status < 400 && response.location) {
      if (redirects >= (safe ? FETCH_POLICY.maxRedirects : 10)) {
        throw safe ? new Refused("render", `Too many redirects after ${address}. Stopped.`) : new ToolError("Too many redirects.");
      }
      url = parse(new URL(response.location, url).href);
      hops.push(url.href);
      continue;
    }
    if (safe && response.body.length > FETCH_POLICY.maxBytes) {
      throw new Refused("render", `${url.host} sent ${Math.round(response.body.length / 1000)} KB. The limit is ${FETCH_POLICY.maxBytes / 1000} KB.`);
    }
    if (response.status !== 200) throw new ToolError(`${url.href} answered ${response.status}.`);
    return { url: url.href, body: response.body, hops };
  }
}

/** Why this URL may not be fetched, or null if it's fine. Every hop goes through here. */
export function checkUrl(url: URL): string | null {
  if (url.protocol !== "http:" && url.protocol !== "https:") return `${url.protocol} URLs aren't allowed, only http and https.`;
  if (url.username || url.password) return "URLs with a username or password aren't allowed.";
  if (url.port && url.port !== "80" && url.port !== "443") return `Port ${url.port} isn't allowed, only the normal web ports.`;

  const host = url.hostname.toLowerCase();
  const address = resolveHost(host);
  const blocked = address ? blockedAddress(address) : null;
  const listed = FETCH_POLICY.allowedHosts.includes(host);
  if (!listed && blocked) return `${host} isn't on the allowlist of partner sites, and it resolves to ${address}, a ${blocked} address.`;
  if (!listed) return `${host} isn't on the allowlist of partner sites.`;
  if (blocked) return `${host} resolves to ${address}, a ${blocked} address.`;
  return null;
}

/** "loopback", "private", "link-local"… for addresses a server should never fetch on a stranger's say-so. */
export function blockedAddress(ip: string): string | null {
  const address = ip.replace(/^\[|\]$/g, "").toLowerCase();
  const v4 = address.match(/^(?:::ffff:)?(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if (a === 127) return "loopback";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "private";
    if (a === 169 && b === 254) return "link-local";
    if (a === 100 && b >= 64 && b <= 127) return "shared (carrier-grade NAT)";
    if (a === 0) return "unspecified";
    if (a >= 224) return "multicast or reserved";
    return null;
  }
  if (address === "::1") return "loopback";
  if (address === "::") return "unspecified";
  if (/^fe[89ab]/.test(address)) return "link-local";
  if (/^f[cd]/.test(address)) return "private";
  if (/^ff/.test(address)) return "multicast or reserved";
  return null;
}

function parse(address: string) {
  try {
    return new URL(address);
  } catch {
    throw new ToolError(`"${address}" isn't a URL. Use a full address like http://harbour-tours.test/trips.`);
  }
}

async function get(url: URL) {
  try {
    return await labGet(url);
  } catch (error) {
    if (error instanceof LabError) throw new ToolError(error.message);
    throw error;
  }
}

async function withDeadline(url: URL, deadline: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(0, deadline - Date.now()));
  try {
    return await labGet(url, controller.signal);
  } catch (error) {
    if (!(error instanceof LabError)) throw error;
    if (controller.signal.aborted) throw new Refused("render", `${url.host} took longer than ${FETCH_POLICY.maxMs / 1000}s. Stopped.`);
    throw new ToolError(error.message);
  } finally {
    clearTimeout(timer);
  }
}

const hostOf = (href: string) => new URL(href).host;
