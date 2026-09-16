import type { SupabaseClient } from "@supabase/supabase-js";
import type { HiringSignalFreshnessBand, HiringSignalRow, HiringSignalStatus } from "../types.js";

export function hiringSignalRepository(db: SupabaseClient) {
  return {
    findById: async (id: string): Promise<HiringSignalRow | null> => {
      const { data, error } = await db.from("hiring_signals").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    // Day 4-5 normalize: source-level dedup via the (company_id, source, source_posting_id) unique index.
    upsertBySourcePosting: async (input: {
      companyId: string;
      rawSignalId?: string | null;
      roleTitle: string;
      location?: string | null;
      department?: string | null;
      source: string;
      sourcePostingId: string;
      postedDate?: string | null;
    }): Promise<HiringSignalRow> => {
      const { data, error } = await db
        .from("hiring_signals")
        .upsert(
          {
            company_id: input.companyId,
            raw_signal_id: input.rawSignalId ?? null,
            role_title: input.roleTitle,
            location: input.location ?? null,
            department: input.department ?? null,
            source: input.source,
            source_posting_id: input.sourcePostingId,
            posted_date: input.postedDate ?? null,
          },
          { onConflict: "company_id,source,source_posting_id" },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    // Day 6 cross-source dedup: the same real-world posting has a different source_posting_id,
    // and often differently-worded role_title text, per source — so this matches on company +
    // a freshness window + fuzzy title similarity (via the find_similar_hiring_signal SQL
    // function, packages/db/migrations/0009) instead of the (company_id, source,
    // source_posting_id) unique index, which only ever collapses one source's own re-fetch.
    // Returns every candidate in scope with its similarity score, unfiltered — the caller
    // decides (and logs) the threshold, so every comparison is visible, not just the ones that
    // end up flagged as duplicates.
    findSimilarHiringSignals: async (
      companyId: string,
      roleTitle: string,
      detectedSince: string,
    ): Promise<{ hiringSignalId: string; roleTitle: string; similarityScore: number }[]> => {
      const { data, error } = await db.rpc("find_similar_hiring_signal", {
        p_company_id: companyId,
        p_role_title: roleTitle,
        p_detected_since: detectedSince,
      });
      if (error) throw error;
      return (data ?? []).map((row: { hiring_signal_id: string; role_title: string; similarity_score: number }) => ({
        hiringSignalId: row.hiring_signal_id,
        roleTitle: row.role_title,
        similarityScore: row.similarity_score,
      }));
    },

    // Day 6 early filter.
    setStatus: async (id: string, status: HiringSignalStatus): Promise<void> => {
      const { error } = await db.from("hiring_signals").update({ status }).eq("id", id);
      if (error) throw error;
    },

    // Day 10 scoring: freshness band (fresh/recent/ageing/stale).
    setFreshnessBand: async (id: string, band: HiringSignalFreshnessBand): Promise<void> => {
      const { error } = await db.from("hiring_signals").update({ freshness_band: band }).eq("id", id);
      if (error) throw error;
    },
  };
}
