import type { SupabaseClient } from "@supabase/supabase-js";
import type { LeadAssignmentRow } from "../types.js";

/** The states a recruiter can still work (the web's isActive). expired / suppressed are terminal. */
export const WORKABLE_ASSIGNMENT_STATES = ["new", "viewed", "contacted"] as const;

/** An assignment a recruiter can still work, with its signal's current status: what the lead sweep re-checks. */
export interface WorkableAssignment {
  id: string;
  tenant_id: string;
  state: string;
  lead_id: string;
  hiring_signal_id: string;
  signal_status: string;
  role_title: string;
  company: string;
}

export function leadAssignmentRepository(db: SupabaseClient) {
  return {
    // Day 10 emit: the tenant-scoped join between a global lead and this tenant. A lead can
    // only be assigned to a given tenant once (enforced by the tenant_id+lead_id unique index).
    create: async (input: { tenantId: string; leadId: string; seatId?: string | null; outsideFilters?: boolean }): Promise<LeadAssignmentRow> => {
      const { data, error } = await db
        .from("lead_assignments")
        .insert({
          tenant_id: input.tenantId,
          lead_id: input.leadId,
          seat_id: input.seatId ?? null,
          outside_filters: input.outsideFilters ?? false,
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

    // Lead sweep: every assignment still workable, with the status of the signal it was emitted from.
    listWorkable: async (): Promise<WorkableAssignment[]> => {
      const { data, error } = await db
        .from("lead_assignments")
        .select("id, tenant_id, state, lead_id, leads(hiring_signal_id, hiring_signals(status, role_title, companies(name)))")
        .in("state", WORKABLE_ASSIGNMENT_STATES);
      if (error) throw error;
      type Joined = { id: string; tenant_id: string; state: string; lead_id: string; leads: { hiring_signal_id: string; hiring_signals: { status: string; role_title: string; companies: { name: string } } } };
      return (data as unknown as Joined[]).map((a) => ({
        id: a.id,
        tenant_id: a.tenant_id,
        state: a.state,
        lead_id: a.lead_id,
        hiring_signal_id: a.leads.hiring_signal_id,
        signal_status: a.leads.hiring_signals.status,
        role_title: a.leads.hiring_signals.role_title,
        company: a.leads.hiring_signals.companies.name,
      }));
    },

    // Lead sweep: which of these assignments have at least one logged interaction event (a call a recruiter logged).
    withLoggedCalls: async (assignmentIds: string[]): Promise<Set<string>> => {
      if (!assignmentIds.length) return new Set();
      const { data, error } = await db.from("interaction_events").select("lead_assignment_id").in("lead_assignment_id", assignmentIds);
      if (error) throw error;
      return new Set(data.map((r) => r.lead_assignment_id as string));
    },

    // Lead sweep: a lead whose signal is no longer valid stops being workable for every tenant it was assigned to,
    // except the assignments in `keep` (those with a logged call). Only the assignment's state moves.
    // interaction_events (the recruiter's call history) and next_action_at are untouched, and the state guard means an
    // assignment that reached a terminal state in the meantime is left alone.
    expireWorkableForLead: async (leadId: string, keep: string[] = []): Promise<string[]> => {
      let query = db
        .from("lead_assignments")
        .update({ state: "expired", updated_at: new Date().toISOString() })
        .eq("lead_id", leadId)
        .in("state", WORKABLE_ASSIGNMENT_STATES);
      if (keep.length) query = query.not("id", "in", `(${keep.join(",")})`);
      const { data, error } = await query.select("id");
      if (error) throw error;
      return data.map((r) => r.id as string);
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
