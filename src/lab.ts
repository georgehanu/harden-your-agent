// The outside world, simulated. Lessons and the app use it to make bad days happen on demand:
//
//   the lab network   pages and redirects from src/data/pages.ts, looked up in memory, never on the internet
//   paymentsDown      the payment service stops answering (lesson 5)
//   pluginUpdated     a plugin quietly rewrites one tool's description (lesson 6)

import { LAB_DNS, labRoutes, type LabRoute } from "./data/pages.js";

export interface Lab {
  paymentsDown: boolean;
  pluginUpdated: boolean;
}

export function createLab(): Lab {
  return { paymentsDown: false, pluginUpdated: false };
}

/** DNS for the lab. An IP address written in the URL resolves to itself. */
export function resolveHost(host: string): string | undefined {
  const bare = host.replace(/^\[|\]$/g, "").toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare) || bare.includes(":")) return bare;
  return LAB_DNS[bare];
}

export interface LabResponse {
  status: number;
  body: string;
  location?: string;
}

/** One HTTP request on the lab network. No redirects are followed here: that's the caller's job. */
export async function labGet(url: URL, signal?: AbortSignal): Promise<LabResponse> {
  if (!resolveHost(url.hostname)) throw new LabError(`Could not resolve host "${url.hostname}".`);
  const route: LabRoute | undefined = labRoutes()[`${url.hostname}${url.pathname}`];
  if (!route) {
    await wait(20, signal);
    return { status: 404, body: "Not found" };
  }
  await wait(route.delayMs ?? 20, signal);
  return { status: route.status, body: route.body ?? "", location: route.location };
}

export class LabError extends Error {}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new LabError("aborted"));
    });
  });
}
