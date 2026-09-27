import type { SupabaseClient } from "@supabase/supabase-js";
import type { HiringSignalPostingRow } from "../types.js";

export function hiringSignalPostingRepository(db: SupabaseClient) {
  return {
    // Records one board copy of a hiring_signal (see migration 0030). Idempotent: re-ingesting the same copy is a no-op.
    add: async (input: { hiringSignalId: string; source: string; sourceToken: string; sourcePostingId: string }): Promise<void> => {
      const { error } = await db.from("hiring_signal_postings").upsert(
        {
          hiring_signal_id: input.hiringSignalId,
          source: input.source,
          source_token: input.sourceToken,
          source_posting_id: input.sourcePostingId,
        },
        { onConflict: "hiring_signal_id,source,source_posting_id", ignoreDuplicates: true },
      );
      if (error) throw error;
    },

    listByHiringSignalId: async (hiringSignalId: string): Promise<HiringSignalPostingRow[]> => {
      const { data, error } = await db.from("hiring_signal_postings").select("*").eq("hiring_signal_id", hiringSignalId).order("created_at");
      if (error) throw error;
      return data;
    },
  };
}
