import { createServiceClient } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import type { SupabaseClient } from "@supabase/supabase-js";

// Internal to this package: runIngestForCompany/normalizeRawSignal take plain typed
// input/output with no db client parameter, so each keeps a shared connection here rather
// than reconnecting on every call.
let client: SupabaseClient | undefined;

export function getDb(): SupabaseClient {
  client ??= createServiceClient(loadEnv());
  return client;
}
