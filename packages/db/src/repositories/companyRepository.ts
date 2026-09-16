import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompanyOwnershipType, CompanyRevenueBand, CompanyRow, CompanySizeBand } from "../types.js";

export function companyRepository(db: SupabaseClient) {
  return {
    // Day 4-5 identity resolution: match an incoming posting's company by domain.
    findByDomain: async (domain: string): Promise<CompanyRow | null> => {
      const { data, error } = await db
        .from("companies")
        .select("*")
        .ilike("domain", domain)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    // Day 4-5 identity resolution: narrow candidates for fuzzy name matching. Caller does the
    // exact normalized-name comparison — this just avoids scanning the whole table.
    // ponytail: substring scan over an ilike-narrowed set, fine at low company counts; add a
    // normalized-name column + index if this table grows large enough for it to matter.
    searchByNameFragment: async (fragment: string): Promise<CompanyRow[]> => {
      const escaped = fragment.replace(/[%_]/g, (char) => `\\${char}`);
      const { data, error } = await db.from("companies").select("*").ilike("name", `%${escaped}%`);
      if (error) throw error;
      return data;
    },

    // Day 4-5: create when no domain match exists.
    create: async (input: {
      name: string;
      domain?: string | null;
      industry?: string | null;
      sizeBand?: CompanySizeBand | null;
      revenueBand?: CompanyRevenueBand | null;
      hqLocation?: string | null;
      ownershipType?: CompanyOwnershipType | null;
    }): Promise<CompanyRow> => {
      const { data, error } = await db
        .from("companies")
        .insert({
          name: input.name,
          domain: input.domain ?? null,
          industry: input.industry ?? null,
          size_band: input.sizeBand ?? null,
          revenue_band: input.revenueBand ?? null,
          hq_location: input.hqLocation ?? null,
          ownership_type: input.ownershipType ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
