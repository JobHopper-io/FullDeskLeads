import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadRow } from "../types.js";

export function leadRepository(db: SupabaseClient) {
  return {
    findById: async (id: string): Promise<LeadRow | null> => {
      const { data, error } = await db.from("leads").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    // Day 10 emit: write the finished global lead. why_now/pitch_angle/etc. stay null in the
    // base phase — a hardcoded placeholder stands in for generated intelligence.
    create: async (input: {
      contractVersion: string;
      hiringSignalId: string;
      primaryContactId: string;
      alternateContactIds?: string[];
      whyNow?: string | null;
    }): Promise<LeadRow> => {
      const { data, error } = await db
        .from("leads")
        .insert({
          contract_version: input.contractVersion,
          hiring_signal_id: input.hiringSignalId,
          primary_contact_id: input.primaryContactId,
          alternate_contact_ids: input.alternateContactIds ?? [],
          why_now: input.whyNow ?? null,
          status: "ready",
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
