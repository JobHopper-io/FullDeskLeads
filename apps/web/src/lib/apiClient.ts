import { supabase } from "./supabaseClient";

// The Vite dev server proxies /api to the Fastify API (vite.config.ts).
const BASE = "/api";

// Every call gives up eventually, so a stalled upstream shows as an error instead of a spinner that never ends.
// Generous by default: /leads can legitimately take 20s on a large account.
const DEFAULT_TIMEOUT_MS = 60_000;

async function request<T>(method: string, path: string, body?: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const { data } = await supabase.auth.getSession();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        Authorization: `Bearer ${data.session?.access_token ?? ""}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if ((err as Error).name === "TimeoutError") throw new Error(`the server didn't answer within ${Math.round(timeoutMs / 1000)}s`);
    throw err;
  }
  if (!res.ok) {
    const msg = ((await res.json().catch(() => null)) as { error?: string } | null)?.error;
    throw new Error(msg ?? `${method} ${path} failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const apiGet = <T,>(path: string, opts: { timeoutMs?: number } = {}) => request<T>("GET", path, undefined, opts.timeoutMs);
export const apiPost = <T,>(path: string, body: unknown) => request<T>("POST", path, body);
export const apiPut = <T,>(path: string, body: unknown) => request<T>("PUT", path, body);
