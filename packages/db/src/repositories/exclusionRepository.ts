import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExclusionRow, ExclusionType } from "../types.js";

// TODO(phase two): not wired into any pipeline stage yet — the base build's structural filter
// (day 6) doesn't check exclusions. The full three-tier exclusion system is explicitly deferred.
export function exclusionRepository(db: SupabaseClient) {
  return {
    listForTenant: async (tenantId: string): Promise<ExclusionRow[]> => {
      const { data, error } = await db.from("exclusions").select("*").eq("tenant_id", tenantId);
      if (error) throw error;
      return data;
    },

    create: async (input: {
      tenantId: string;
      companyId: string;
      exclusionType: ExclusionType;
      expiresAt?: string | null;
    }): Promise<ExclusionRow> => {
      const { data, error } = await db
        .from("exclusions")
        .insert({
          tenant_id: input.tenantId,
          company_id: input.companyId,
          exclusion_type: input.exclusionType,
          expires_at: input.expiresAt ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
