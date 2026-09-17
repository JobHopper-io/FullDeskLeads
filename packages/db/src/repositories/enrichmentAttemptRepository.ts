import type { SupabaseClient } from "@supabase/supabase-js";
import type { EnrichmentAttemptRow } from "../types.js";

export function enrichmentAttemptRepository(db: SupabaseClient) {
  return {
    // Day 8 enrichment: durable per-signal outcome record. enrichHiringSignal writes one of
    // these on every call, success or not, so results survive past terminal stdout.
    create: async (input: {
      hiringSignalId: string;
      status: string;
      contactId?: string | null;
      confidence?: number | null;
      message?: string | null;
      requestId?: string | null;
      searchResultId?: string | null;
    }): Promise<EnrichmentAttemptRow> => {
      const { data, error } = await db
        .from("enrichment_attempts")
        .insert({
          hiring_signal_id: input.hiringSignalId,
          status: input.status,
          contact_id: input.contactId ?? null,
          confidence: input.confidence ?? null,
          message: input.message ?? null,
          request_id: input.requestId ?? null,
          search_result_id: input.searchResultId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
