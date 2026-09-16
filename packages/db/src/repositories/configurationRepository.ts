import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConfigurationRow } from "../types.js";

export function configurationRepository(db: SupabaseClient) {
  return {
    // Day 9-10 scoring: the fit check reads the tenant's active configuration row.
    findActiveForTenant: async (tenantId: string): Promise<ConfigurationRow | null> => {
      const { data, error } = await db
        .from("configurations")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("is_active", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    // Day 2 seed script.
    create: async (input: {
      tenantId: string;
      targetIndustries: string[];
      targetGeographies: string[];
      targetSizeBands: string[];
    }): Promise<ConfigurationRow> => {
      const { data, error } = await db
        .from("configurations")
        .insert({
          tenant_id: input.tenantId,
          target_industries: input.targetIndustries,
          target_geographies: input.targetGeographies,
          target_size_bands: input.targetSizeBands,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
