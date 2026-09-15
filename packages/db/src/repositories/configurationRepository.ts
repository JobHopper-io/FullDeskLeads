import type { SupabaseClient } from "@supabase/supabase-js";

// TODO(day 9): per-tenant target industry, geography, company size band. Read by scoring.
export function configurationRepository(db: SupabaseClient) {
  return {
    findForTenant: async (tenantId: string) => {
      const { data, error } = await db.from("configuration").select("*").eq("tenant_id", tenantId).single();
      if (error) throw error;
      return data;
    },
  };
}
