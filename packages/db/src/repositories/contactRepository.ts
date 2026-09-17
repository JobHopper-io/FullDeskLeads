import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContactRow } from "../types.js";

export function contactRepository(db: SupabaseClient) {
  return {
    // Day 8 enrichment: write a Seamless.AI hit. hiringSignalId is required (not optional) —
    // a contact row is one enrichment result for one specific hiring_signal, not a company-wide
    // cache (see migration 0011). The column itself is nullable only to accommodate the 3 rows
    // written before it existed.
    create: async (input: {
      companyId: string;
      hiringSignalId: string;
      name: string;
      title: string;
      phone?: string | null;
      email?: string | null;
      confidenceScore: number;
      source: string;
      sourceContactId?: string | null;
    }): Promise<ContactRow> => {
      const { data, error } = await db
        .from("contacts")
        .insert({
          company_id: input.companyId,
          hiring_signal_id: input.hiringSignalId,
          name: input.name,
          title: input.title,
          phone: input.phone ?? null,
          email: input.email ?? null,
          confidence_score: input.confidenceScore,
          source: input.source,
          source_contact_id: input.sourceContactId ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    // Day 8 select-contact (highest confidence first) and day 10 reachability gate
    // (caller filters for phone_verified) both read from this ordered candidate list.
    listByCompanyOrderedByConfidence: async (companyId: string): Promise<ContactRow[]> => {
      const { data, error } = await db
        .from("contacts")
        .select("*")
        .eq("company_id", companyId)
        .order("confidence_score", { ascending: false });
      if (error) throw error;
      return data;
    },
  };
}
