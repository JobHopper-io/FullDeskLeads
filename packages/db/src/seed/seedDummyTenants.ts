import type { SupabaseClient } from "@supabase/supabase-js";

// TODO(day 2): seed two dummy tenants and two dummy seats to confirm RLS isolation.
export async function seedDummyTenants(_db: SupabaseClient): Promise<void> {
  throw new Error("not implemented");
}
