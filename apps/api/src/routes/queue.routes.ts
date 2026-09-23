import type { FastifyInstance } from "fastify";
import { createServiceClient } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import { requireSeat } from "../plugins/auth.plugin.js";

export interface QueueItem {
  id: string;
  state: string;
  deliveredAt: string | null;
  company: string;
  roleTitle: string;
  location: string | null;
  contact: { name: string; title: string; phone: string | null };
  freshnessBand: string | null;
  confidenceScore: number | null;
  whyNow: string | null;
  /** no_answer events already logged; the 4th expires the lead. */
  noAnswerAttempts: number;
  /** Empty today: nothing populates leads.alternate_contact_ids yet. */
  alternateContacts: { name: string; title: string; phone: string | null }[];
}

interface AssignmentRow {
  id: string;
  tenant_id: string;
  state: string;
  delivered_at: string | null;
  lead_id: string;
}

interface LeadRow {
  id: string;
  why_now: string | null;
  alternate_contact_ids: string[];
  hiring_signal: { role_title: string; location: string | null; freshness_band: string | null; company: { name: string } };
  primary_contact: { name: string; title: string; phone: string | null };
}

// The global tables (leads, contacts, hiring_signals, companies) return no rows to an authenticated
// user in this database, so the joined data comes from the service client. It is only ever queried
// by lead ids taken from the caller's own tenant-filtered assignments — never by anything from the request.
let serviceDb: ReturnType<typeof createServiceClient> | undefined;
const service = () => (serviceDb ??= createServiceClient(loadEnv()));

export async function queueRoutes(app: FastifyInstance) {
  // Who am I — lets the web app hold the seat (tenant_id, role) without touching tables itself.
  app.get("/me", { preHandler: requireSeat }, async (request) => request.seat);

  app.get("/queue", { preHandler: requireSeat }, async (request): Promise<QueueItem[]> => {
    const { tenantId } = request.seat;

    const { data, error } = await request.db
      .from("lead_assignments")
      .select("id, tenant_id, state, delivered_at, lead_id")
      .eq("tenant_id", tenantId)
      // A follow-up in the future keeps the lead out of the queue until it's due.
      .or(`next_action_at.is.null,next_action_at.lte.${new Date().toISOString()}`);
    if (error) throw error;
    const assignments = data as AssignmentRow[];

    // Belt and braces on top of the .eq filter and RLS: a row from another tenant must never leave here.
    if (assignments.some((a) => a.tenant_id !== tenantId)) throw new Error("tenant isolation violated in /queue");

    const leadIds = assignments.map((a) => a.lead_id);
    if (!leadIds.length) return [];

    const { data: leadData, error: leadError } = await service()
      .from("leads")
      .select(
        `id, why_now, alternate_contact_ids,
         hiring_signal:hiring_signals ( role_title, location, freshness_band, company:companies ( name ) ),
         primary_contact:contacts!primary_contact_id ( name, title, phone )`,
      )
      .in("id", leadIds);
    if (leadError) throw leadError;
    const leadsById = new Map((leadData as unknown as LeadRow[]).map((l) => [l.id, l]));

    const alternateIds = [...new Set([...leadsById.values()].flatMap((l) => l.alternate_contact_ids))];
    const { data: altData, error: altError } = alternateIds.length
      ? await service().from("contacts").select("id, name, title, phone").in("id", alternateIds)
      : { data: [], error: null };
    if (altError) throw altError;
    const contactsById = new Map((altData as { id: string; name: string; title: string; phone: string | null }[]).map((c) => [c.id, c]));

    const { data: attemptRows, error: attemptError } = await request.db
      .from("interaction_events")
      .select("lead_assignment_id")
      .eq("tenant_id", tenantId)
      .eq("disposition", "no_answer")
      .in("lead_assignment_id", assignments.map((a) => a.id));
    if (attemptError) throw attemptError;
    const attempts = new Map<string, number>();
    for (const r of attemptRows as { lead_assignment_id: string }[]) attempts.set(r.lead_assignment_id, (attempts.get(r.lead_assignment_id) ?? 0) + 1);

    const { data: scores, error: scoreError } = await request.db
      .from("score_records")
      .select("lead_id, confidence_score")
      .eq("tenant_id", tenantId)
      .in("lead_id", leadIds);
    if (scoreError) throw scoreError;
    const confidenceByLead = new Map((scores as { lead_id: string; confidence_score: number | null }[]).map((s) => [s.lead_id, s.confidence_score]));

    return assignments
      .map((a): QueueItem => {
        const lead = leadsById.get(a.lead_id)!;
        return {
          id: a.id,
          state: a.state,
          deliveredAt: a.delivered_at,
          company: lead.hiring_signal.company.name,
          roleTitle: lead.hiring_signal.role_title,
          location: lead.hiring_signal.location,
          contact: lead.primary_contact,
          freshnessBand: lead.hiring_signal.freshness_band,
          confidenceScore: confidenceByLead.get(a.lead_id) ?? null,
          whyNow: lead.why_now,
          noAnswerAttempts: attempts.get(a.id) ?? 0,
          alternateContacts: lead.alternate_contact_ids.flatMap((id) => contactsById.get(id) ?? []),
        };
      })
      .sort((x, y) => (y.confidenceScore ?? -1) - (x.confidenceScore ?? -1) || (y.deliveredAt ?? "").localeCompare(x.deliveredAt ?? ""));
  });
}
