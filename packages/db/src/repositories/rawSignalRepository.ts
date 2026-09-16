import type { SupabaseClient } from "@supabase/supabase-js";
import type { RawSignalRow } from "../types.js";

export function rawSignalRepository(db: SupabaseClient) {
  return {
    findById: async (id: string): Promise<RawSignalRow | null> => {
      const { data, error } = await db.from("raw_signals").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    // Ingest: store the validated posting before it's resolved into a hiring_signal.
    create: async (input: {
      source: string;
      sourceToken?: string | null;
      rawPayload: unknown;
      fetchedAt: string;
    }): Promise<RawSignalRow> => {
      const { data, error } = await db
        .from("raw_signals")
        .insert({
          source: input.source,
          source_token: input.sourceToken ?? null,
          raw_payload: input.rawPayload,
          fetched_at: input.fetchedAt,
        })
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
