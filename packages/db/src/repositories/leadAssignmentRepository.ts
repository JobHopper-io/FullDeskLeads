import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadAssignmentRow } from "../types.js";

export function leadAssignmentRepository(db: SupabaseClient) {
  return {
    // Day 10 emit: the tenant-scoped join between a global lead and this tenant. A lead can
    // only be assigned to a given tenant once (enforced by the tenant_id+lead_id unique index).
    create: async (input: { tenantId: string; leadId: string; seatId?: string | null }): Promise<LeadAssignmentRow> => {
      const { data, error } = await db
        .from("lead_assignments")
        .insert({
          tenant_id: input.tenantId,
          lead_id: input.leadId,
          seat_id: input.seatId ?? null,
          delivered_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },

    // Day 10 emit idempotency: the same (tenant_id, lead_id) pair must only ever get one
    // assignment — checked explicitly rather than relying on the unique index throwing, since
    // emitLead needs to distinguish "already assigned, reuse it" from a real error.
    findByTenantAndLead: async (tenantId: string, leadId: string): Promise<LeadAssignmentRow | null> => {
      const { data, error } = await db
        .from("lead_assignments")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("lead_id", leadId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },

    // Day 12 queue view.
    listForTenant: async (tenantId: string): Promise<LeadAssignmentRow[]> => {
      const { data, error } = await db.from("lead_assignments").select("*").eq("tenant_id", tenantId);
      if (error) throw error;
      return data;
    },

    // Day 13 lead card, Layer 1 fields only: company name, contact name/title/phone,
    // freshness tag, placeholder why-now text.
    findLeadCardById: async (tenantId: string, id: string) => {
      const { data, error } = await db
        .from("lead_assignments")
        .select(
          `id, state,
           lead:leads (
             why_now,
             hiring_signal:hiring_signals ( freshness_band, company:companies ( name ) ),
             primary_contact:contacts!primary_contact_id ( name, title, phone )
           )`,
        )
        .eq("tenant_id", tenantId)
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  };
}
