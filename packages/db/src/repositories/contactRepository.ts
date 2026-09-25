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
      contactCity?: string | null;
      contactState?: string | null;
      companyHqCity?: string | null;
      companyHqState?: string | null;
      siteVsCorporate?: "site" | "corporate" | null;
      tier?: "function" | "site" | "hr" | null;
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
          contact_city: input.contactCity ?? null,
          contact_state: input.contactState ?? null,
          company_hq_city: input.companyHqCity ?? null,
          company_hq_state: input.companyHqState ?? null,
          site_vs_corporate: input.siteVsCorporate ?? null,
          tier: input.tier ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    // Every current contact found for this signal, highest confidence first (earliest write breaks ties, so the
    // order is stable). Several per signal since migration 0024. Rows a corrected re-enrichment superseded (0029) are
    // skipped: they stay in the table as history but are never candidates. Which one is the primary is decided in the
    // pipeline (assignPrimaryAndAlternates: best tier first), not here.
    listByHiringSignalId: async (hiringSignalId: string): Promise<ContactRow[]> => {
      const { data, error } = await db
        .from("contacts")
        .select("*")
        .eq("hiring_signal_id", hiringSignalId)
        .is("superseded_at", null)
        .order("confidence_score", { ascending: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return data;
    },

    // The row for this person on this signal, if any (the unique key guarantees at most one), superseded or not.
    findBySignalAndPerson: async (hiringSignalId: string, sourceContactId: string): Promise<ContactRow | null> => {
      const { data, error } = await db
        .from("contacts")
        .select("*")
        .eq("hiring_signal_id", hiringSignalId)
        .eq("source_contact_id", sourceContactId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    // A re-enrichment found a person already stored for this signal: same human, so the row is reused, not
    // duplicated. Only columns that are still empty get filled (never overwrite what was stored), and it is made
    // current again if it had been superseded.
    reuse: async (
      id: string,
      fill: { contactCity?: string | null; contactState?: string | null; companyHqCity?: string | null; companyHqState?: string | null; siteVsCorporate?: "site" | "corporate" | null; tier?: "function" | "site" | "hr" | null },
    ): Promise<ContactRow> => {
      const { data: row, error: readError } = await db.from("contacts").select("*").eq("id", id).single();
      if (readError) throw readError;
      const patch: Record<string, unknown> = { superseded_at: null };
      const empty: [keyof ContactRow, unknown][] = [
        ["contact_city", fill.contactCity], ["contact_state", fill.contactState], ["company_hq_city", fill.companyHqCity],
        ["company_hq_state", fill.companyHqState], ["site_vs_corporate", fill.siteVsCorporate], ["tier", fill.tier],
      ];
      for (const [column, value] of empty) if (row[column] === null && value !== undefined && value !== null) patch[column] = value;
      const { data, error } = await db.from("contacts").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },

    // Mark every current contact on this signal that is NOT in keepIds as superseded. Nothing is deleted.
    // Returns the ids it marked.
    supersedeAllExcept: async (hiringSignalId: string, keepIds: string[]): Promise<string[]> => {
      let query = db.from("contacts").update({ superseded_at: new Date().toISOString() }).eq("hiring_signal_id", hiringSignalId).is("superseded_at", null);
      if (keepIds.length > 0) query = query.not("id", "in", `(${keepIds.join(",")})`);
      const { data, error } = await query.select("id");
      if (error) throw error;
      return data.map((r) => r.id as string);
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
