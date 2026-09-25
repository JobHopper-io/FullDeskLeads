import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadRow } from "../types.js";

export function leadRepository(db: SupabaseClient) {
  return {
    findById: async (id: string): Promise<LeadRow | null> => {
      const { data, error } = await db.from("leads").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },

    // Day 10 emit: leads are global, so the same hiring_signal reaching two eligible tenants
    // must reuse this one row rather than creating a duplicate.
    findByHiringSignalId: async (hiringSignalId: string): Promise<LeadRow | null> => {
      const { data, error } = await db.from("leads").select("*").eq("hiring_signal_id", hiringSignalId).maybeSingle();
      if (error) throw error;
      return data;
    },

    // A corrected re-enrichment changed which contacts belong to this lead: point it at them. The old contact rows
    // stay in the table (superseded), only the lead's pointers move.
    setContacts: async (leadId: string, primaryContactId: string, alternateContactIds: string[]): Promise<void> => {
      const { error } = await db
        .from("leads")
        .update({ primary_contact_id: primaryContactId, alternate_contact_ids: alternateContactIds, updated_at: new Date().toISOString() })
        .eq("id", leadId);
      if (error) throw error;
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
