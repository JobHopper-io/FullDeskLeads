import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceCompanyRow } from "../types.js";

export function sourceCompanyRepository(db: SupabaseClient) {
  return {
    // Registering a board to poll. domain, when known, is what lets normalize resolve this
    // company authoritatively instead of falling back to fuzzy name matching.
    create: async (input: {
      companyName: string;
      source: string;
      sourceToken: string;
      domain?: string | null;
      isActive?: boolean;
    }): Promise<SourceCompanyRow> => {
      const { data, error } = await db
        .from("source_companies")
        .insert({
          company_name: input.companyName,
          source: input.source,
          source_token: input.sourceToken,
          domain: input.domain ?? null,
          is_active: input.isActive ?? true,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    // Ingest worker: job payload is a source_companies id, this resolves it to the full row.
    findById: async (id: string): Promise<SourceCompanyRow | null> => {
      const { data, error } = await db.from("source_companies").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    // Normalize: a raw_signal only carries (source, source_token) — this recovers the
    // company_name that ingest didn't duplicate into raw_payload.
    findByToken: async (source: string, sourceToken: string): Promise<SourceCompanyRow | null> => {
      const { data, error } = await db
        .from("source_companies")
        .select("*")
        .eq("source", source)
        .eq("source_token", sourceToken)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    // The ingest run loop's starting point: every board to poll for a given source.
    listActiveBySource: async (source: string): Promise<SourceCompanyRow[]> => {
      const { data, error } = await db
        .from("source_companies")
        .select("*")
        .eq("source", source)
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
  };
}
