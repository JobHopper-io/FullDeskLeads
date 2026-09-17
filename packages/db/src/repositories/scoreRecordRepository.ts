import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoreRecordRow } from "../types.js";

export function scoreRecordRepository(db: SupabaseClient) {
  return {
    // Day 9-10 scoring/emission: one row per (tenant, hiring_signal) while scored but not yet
    // emitted, and per (tenant, lead) once emitted — see setLeadId.
    findByTenantAndHiringSignal: async (tenantId: string, hiringSignalId: string): Promise<ScoreRecordRow | null> => {
      const { data, error } = await db
        .from("score_records")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("hiring_signal_id", hiringSignalId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    // Day 9 score: scoring runs before a lead exists (emission creates it later), so this
    // writes against hiring_signal_id, not lead_id — see migration 0016. Find-then-write rather
    // than a DB-level upsert, since the target is a partial unique index and re-scoring the same
    // (tenant, hiring_signal) pair should update in place, not throw.
    upsertForHiringSignal: async (input: {
      tenantId: string;
      hiringSignalId: string;
      fitScore: number | null;
      freshnessScore: number | null;
      confidenceScore: number | null;
      eligible: boolean;
    }): Promise<ScoreRecordRow> => {
      const existing = await db
        .from("score_records")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("hiring_signal_id", input.hiringSignalId)
        .maybeSingle();
      if (existing.error) throw existing.error;

      const values = {
        tenant_id: input.tenantId,
        hiring_signal_id: input.hiringSignalId,
        fit_score: input.fitScore,
        freshness_score: input.freshnessScore,
        confidence_score: input.confidenceScore,
        eligible: input.eligible,
        computed_at: new Date().toISOString(),
      };

      const { data, error } = existing.data
        ? await db.from("score_records").update(values).eq("id", existing.data.id).select().single()
        : await db.from("score_records").insert(values).select().single();
      if (error) throw error;
      return data;
    },

    // Day 10 emit: once a lead exists for this signal, point this tenant's score_record at it
    // rather than creating a second row.
    setLeadId: async (id: string, leadId: string): Promise<void> => {
      const { error } = await db.from("score_records").update({ lead_id: leadId }).eq("id", id);
      if (error) throw error;
    },
  };
}
