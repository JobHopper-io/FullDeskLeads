import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantPlan, TenantRow, TenantStatus } from "../types.js";

export function tenantRepository(db: SupabaseClient) {
  return {
    findById: async (id: string): Promise<TenantRow | null> => {
      const { data, error } = await db.from("tenants").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    // Day 2 seed script.
    create: async (input: { name: string; plan?: TenantPlan; status?: TenantStatus }): Promise<TenantRow> => {
      const { data, error } = await db.from("tenants").insert(input).select().single();
      if (error) throw error;
      return data;
    },
  };
}
