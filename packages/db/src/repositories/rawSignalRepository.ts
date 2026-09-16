import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawSignalRow } from "../types.js";

export function rawSignalRepository(db: SupabaseClient) {
  return {
    // Day 4-5 ingest: store the raw fetch before Zod validation.
    create: async (input: { source: string; rawPayload: unknown; fetchedAt: string }): Promise<RawSignalRow> => {
      const { data, error } = await db
        .from("raw_signals")
        .insert({ source: input.source, raw_payload: input.rawPayload, fetched_at: input.fetchedAt })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    // Day 4-5: record the outcome of normalize/validation against this raw payload.
    markProcessed: async (id: string, processingError?: string): Promise<void> => {
      const { error } = await db
        .from("raw_signals")
        .update({ processed: true, processing_error: processingError ?? null })
        .eq("id", id);
      if (error) throw error;
    },
  };
}
