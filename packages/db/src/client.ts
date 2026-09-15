import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "@fdl/shared";

/** Bypasses RLS. Workers only — never expose this client to a request handler. */
export function createServiceClient(env: Pick<Env, "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

/** Respects RLS as the given user. API request handlers only. */
export function createScopedClient(
  env: Pick<Env, "SUPABASE_URL" | "SUPABASE_ANON_KEY">,
  userAccessToken: string,
): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY ?? "", {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${userAccessToken}` } },
  });
}
