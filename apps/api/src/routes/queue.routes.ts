import type { FastifyInstance } from "fastify";
import { requireSeat } from "../plugins/auth.plugin.js";
import { service } from "../serviceDb.js";

export interface QueueItem {
  id: string;
  state: string;
  deliveredAt: string | null;
  company: string;
  roleTitle: string;
  location: string | null;
  contact: { name: string; title: string; phone: string | null; email: string | null };
  freshnessBand: string | null;
  whyNow: string | null;
  // Layer 2 detail. Provenance is deliberately restrained: no vendor names, internal scores or stage detail.
  /** Lets the client mark every lead sharing this contact as flagged after one flag. */
  contactId: string;
  /** When this tenant flagged the contact as bad data; null = not flagged. */
  contactFlaggedAt: string | null;
  /** When the underlying job posting was first seen. */
  signalFirstSeen: string;
  /** 0–1 confidence in the primary contact, and when its phone was verified (null = not verified). */
  contactConfidence: number;
  phoneVerifiedAt: string | null;
  openingScript: string | null;
  /** Shapes undefined until intelligence generation exists (leads.role_intelligence / objections are jsonb). */
  roleIntelligence: unknown;
  objections: unknown;
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
  primary_contact_id: string;
  opening_script: string | null;
  role_intelligence: unknown;
  objections: unknown;
  hiring_signal: { role_title: string; location: string | null; freshness_band: string | null; detected_at: string; company: { name: string } };
  primary_contact: { name: string; title: string; phone: string | null; email: string | null; confidence_score: number; phone_verified: boolean; verified_at: string | null };
}

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
        `id, why_now, alternate_contact_ids, primary_contact_id, opening_script, role_intelligence, objections,
         hiring_signal:hiring_signals ( role_title, location, freshness_band, detected_at, company:companies ( name ) ),
         primary_contact:contacts!primary_contact_id ( name, title, phone, email, confidence_score, phone_verified, verified_at )`,
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

    const { data: flagRows, error: flagError } = await request.db
      .from("contact_flags")
      .select("contact_id, created_at")
      .eq("tenant_id", tenantId)
      .in("contact_id", [...leadsById.values()].map((l) => l.primary_contact_id));
    if (flagError) throw flagError;
    const flaggedAt = new Map((flagRows as { contact_id: string; created_at: string }[]).map((f) => [f.contact_id, f.created_at]));

    const { data: scores, error: scoreError } = await request.db
      .from("score_records")
      .select("lead_id, confidence_score")
      .eq("tenant_id", tenantId)
      .in("lead_id", leadIds);
    if (scoreError) throw scoreError;
    const confidenceByLead = new Map((scores as { lead_id: string; confidence_score: number | null }[]).map((s) => [s.lead_id, s.confidence_score]));

    // Ordered by the tenant's score_record confidence (best first, then newest), which is not sent to the client.
    const scoreOf = (a: AssignmentRow) => confidenceByLead.get(a.lead_id) ?? -1;
    return [...assignments]
      .sort((x, y) => scoreOf(y) - scoreOf(x) || (y.delivered_at ?? "").localeCompare(x.delivered_at ?? ""))
      .map((a): QueueItem => {
        const lead = leadsById.get(a.lead_id)!;
        return {
          id: a.id,
          state: a.state,
          deliveredAt: a.delivered_at,
          company: lead.hiring_signal.company.name,
          roleTitle: lead.hiring_signal.role_title,
          location: lead.hiring_signal.location,
          contact: { name: lead.primary_contact.name, title: lead.primary_contact.title, phone: lead.primary_contact.phone, email: lead.primary_contact.email },
          contactId: lead.primary_contact_id,
          contactFlaggedAt: flaggedAt.get(lead.primary_contact_id) ?? null,
          signalFirstSeen: lead.hiring_signal.detected_at,
          contactConfidence: lead.primary_contact.confidence_score,
          phoneVerifiedAt: lead.primary_contact.phone_verified ? lead.primary_contact.verified_at : null,
          openingScript: lead.opening_script,
          roleIntelligence: lead.role_intelligence,
          objections: lead.objections,
          freshnessBand: lead.hiring_signal.freshness_band,
          whyNow: lead.why_now,
          noAnswerAttempts: attempts.get(a.id) ?? 0,
          alternateContacts: lead.alternate_contact_ids.flatMap((id) => contactsById.get(id) ?? []),
        };
      });
  });
}
