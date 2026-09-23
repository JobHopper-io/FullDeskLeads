import { supabase } from "./supabaseClient";

// The Vite dev server proxies /api to the Fastify API (vite.config.ts).
const BASE = "/api";

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${data.session?.access_token ?? ""}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export const apiGet = <T,>(path: string) => request<T>("GET", path);
export const apiPost = <T,>(path: string, body: unknown) => request<T>("POST", path, body);
