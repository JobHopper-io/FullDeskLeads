import type { SupabaseClient } from "@supabase/supabase-js";
import type { ScoreRecordRow } from "../types.js";

export function scoreRecordRepository(db: SupabaseClient) {
  return {
    // Day 10 emit: one row per (tenant, lead) — upsert on the unique index.
    upsert: async (input: {
      tenantId: string;
      leadId: string;
      fitScore?: number | null;
      freshnessScore?: number | null;
      confidenceScore?: number | null;
      priorityScore?: number | null;
    }): Promise<ScoreRecordRow> => {
      const { data, error } = await db
        .from("score_records")
        .upsert(
          {
            tenant_id: input.tenantId,
            lead_id: input.leadId,
            fit_score: input.fitScore ?? null,
            freshness_score: input.freshnessScore ?? null,
            confidence_score: input.confidenceScore ?? null,
            priority_score: input.priorityScore ?? null,
            computed_at: new Date().toISOString(),
          },
          { onConflict: "tenant_id,lead_id" },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
