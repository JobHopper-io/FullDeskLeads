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
    // function, packages/db/migrations/0010) instead of the (company_id, source,
    // source_posting_id) unique index, which only ever collapses one source's own re-fetch.
    // Returns every candidate in scope with its similarity score and location, unfiltered — the
    // caller decides (and logs) the threshold and location match, so every comparison is
    // visible, not just the ones that end up flagged as duplicates.
    findSimilarHiringSignals: async (
      companyId: string,
      roleTitle: string,
      detectedSince: string,
    ): Promise<{ hiringSignalId: string; roleTitle: string; location: string | null; similarityScore: number }[]> => {
      const { data, error } = await db.rpc("find_similar_hiring_signal", {
        p_company_id: companyId,
        p_role_title: roleTitle,
        p_detected_since: detectedSince,
      });
      if (error) throw error;
      return (data ?? []).map(
        (row: { hiring_signal_id: string; role_title: string; location: string | null; similarity_score: number }) => ({
          hiringSignalId: row.hiring_signal_id,
          roleTitle: row.role_title,
          location: row.location,
          similarityScore: row.similarity_score,
        }),
      );
    },

    // Day 8 run-enrichment script: active hiring_signals with no contacts row of their own yet.
    // Confirmed bug (fixed by migration 0011): this used to check company_id, which meant a
    // contact found for *any one* role at a company caused every other hiring_signal there —
    // regardless of role — to be wrongly skipped. Scoped to hiring_signal_id directly now — one
    // contact per hiring_signal, not one per company. Two queries rather than a SQL anti-join,
    // fine at current data volume.
    //
    // status = 'active' matters here, not just as a default: this is a second, direct path into
    // enrichHiringSignal that bypasses the filter/enrich queue entirely (run-enrichment.ts calls
    // it straight). Without this clause, a hiring_signal the filter stage just marked 'excluded'
    // would still get enriched via the script even though the queue path correctly blocks it —
    // confirmed and closed as part of wiring the filter stage's exclusion rule.
    listWithoutContact: async (): Promise<HiringSignalRow[]> => {
      const { data: contactRows, error: contactsError } = await db
        .from("contacts")
        .select("hiring_signal_id")
        .not("hiring_signal_id", "is", null);
      if (contactsError) throw contactsError;
      const enrichedHiringSignalIds = [...new Set((contactRows ?? []).map((row) => row.hiring_signal_id as string))];

      let query = db.from("hiring_signals").select("*").eq("status", "active");
      if (enrichedHiringSignalIds.length > 0) {
        query = query.not("id", "in", `(${enrichedHiringSignalIds.join(",")})`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return data;
    },

    // Day 6 early filter, extended for the internal-mobility exclusion rule: reason is written
    // alongside status so a decision like 'excluded' is auditable, not a bare status flip.
    setStatus: async (id: string, status: HiringSignalStatus, reason?: string | null): Promise<void> => {
      const { error } = await db
        .from("hiring_signals")
        .update({ status, status_reason: reason ?? null })
        .eq("id", id);
      if (error) throw error;
    },

    // Day 10 scoring: freshness band (fresh/recent/ageing/stale).
    setFreshnessBand: async (id: string, band: HiringSignalFreshnessBand): Promise<void> => {
      const { error } = await db.from("hiring_signals").update({ freshness_band: band }).eq("id", id);
      if (error) throw error;
    },
  };
}
