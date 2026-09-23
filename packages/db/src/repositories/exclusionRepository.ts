import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExclusionRow, ExclusionType } from "../types.js";

// Enforced at emission (emitLead) for every exclusion_type. Not yet checked by the filter stage —
// the full three-tier exclusion system is still deferred.
export function exclusionRepository(db: SupabaseClient) {
  return {
    listForTenant: async (tenantId: string): Promise<ExclusionRow[]> => {
      const { data, error } = await db.from("exclusions").select("*").eq("tenant_id", tenantId);
      if (error) throw error;
      return data;
    },

    // The exclusion (any type) currently blocking this tenant from being assigned leads at this
    // company, or null. A row with an expires_at in the past no longer blocks (previously_rejected's
    // cooldown is expressed by whoever writes it setting expires_at); null expires_at is permanent.
    findActive: async (tenantId: string, companyId: string): Promise<ExclusionRow | null> => {
      const { data, error } = await db
        .from("exclusions")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("company_id", companyId)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
        .limit(1)
        .maybeSingle();
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
