import type { FastifyInstance, FastifyRequest } from "fastify";
import { freshnessBand, postingAgeDays } from "@fdl/shared";
import { LIST_END, operatingEmployer, postingText } from "@fdl/sources";
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
  /** Parsed from the posting (hiring_signals, migration 0031). Each is null when the posting did not clearly say; never a guess. */
  openingCount: number | null;
  shift: string | null;
  /** Posted pay; null when there is no posted range. interval is null when the posting states a range but not hourly vs annual, currency null when it shows only a bare "$". */
  pay: { min: number; max: number; interval: "hour" | "year" | null; currency: string | null } | null;
  /** The company's own pay description, verbatim, shown alongside `pay` rather than reconciled with it. Null when the source has none. */
  payContext: string | null;
  /**
   * The posting's own description as stored at ingest, cut only at sentence ends and list items (item: true where a
   * list item starts), never otherwise edited. Null when no description was stored.
   */
  jobDescription: { text: string; item: boolean }[] | null;
  /**
   * The company the posting is really for (operatingEmployer): a Crest Industries posting's Lever department ("DIS-TRAN
   * Steel"), otherwise the company itself. Read-only, from the stored payload; picks the plant archetype on My Day.
   */
  employer: string | null;
  whyNow: string | null;
  // Layer 2 detail. Provenance is deliberately restrained: no vendor names, internal scores or stage detail.
  /** Lets the client mark every lead sharing this contact as flagged after one flag. */
  contactId: string;
  /** When this tenant flagged the contact as bad data; null = not flagged. */
  contactFlaggedAt: string | null;
  /**
   * The primary contact is function-tier: returned by the search for this role's own function (a Maintenance Manager on
   * a maintenance opening). That is a proxy for owning the hiring need, not confirmation of it, so it is named for what it
   * verifies. False for a site-lead or HR primary (a reasonable contact, not a function match) and for contacts with no
   * tier at all (written before tiering existed): "no tier data" counts as not matched, never as a yes. Nothing is
   * guessed from a title.
   */
  functionMatch: boolean;
  /** When the underlying job posting was first seen. */
  signalFirstSeen: string;
  /** The posting's own date (YYYY-MM-DD) as the job board states it; null when the board gave none. */
  postedDate: string | null;
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
  /** When the lead is next due (follow-up); null = no follow-up set. */
  nextActionAt: string | null;
  /** Most recent logged outcome; null = never worked. followUpNote is the note saved with the follow-up it set. */
  /** Every note logged on this lead, oldest first (History searches these). */
  notes: string[];
  lastEvent: { disposition: string; note: string | null; followUpNote: string | null; occurredAt: string } | null;
}

interface AssignmentRow {
  id: string;
  tenant_id: string;
  state: string;
  delivered_at: string | null;
  next_action_at: string | null;
  lead_id: string;
}

interface EventRow {
  lead_assignment_id: string;
  event_type: string;
  disposition: string | null;
  note: string | null;
  follow_up_note: string | null;
  occurred_at: string;
}

interface LeadRow {
  id: string;
  why_now: string | null;
  alternate_contact_ids: string[];
  primary_contact_id: string;
  opening_script: string | null;
  role_intelligence: unknown;
  objections: unknown;
  hiring_signal: { role_title: string; location: string | null; detected_at: string; posted_date: string | null; opening_count: number | null; shift: string | null; pay_min: number | null; pay_max: number | null; pay_interval: "hour" | "year" | null; pay_currency: string | null; pay_context: string | null; source: string; company: { name: string }; raw_signal: { raw_payload: { rawPayload?: unknown } } | null };
  primary_contact: { name: string; title: string; phone: string | null; email: string | null; confidence_score: number; phone_verified: boolean; verified_at: string | null; tier: "function" | "site" | "hr" | null };
}

/** A sentence ends at . ! ? and a space, but not after these abbreviations ("reimbursement (e.g. gym)", "badges, etc. for"). */
const SENTENCE_END = /(?<!\b(?:etc|inc|vs|e\.g|i\.e|u\.s)\.)(?<=[.!?])\s+/i;

/**
 * Sentence ends, the "•" postingText puts before each <li>, and the LIST_END it puts where a list closes (so a paragraph
 * after a list is its own line, not part of the last item). The text itself is left exactly as posted.
 */
export function splitPosting(text: string): QueueItem["jobDescription"] {
  const out: { text: string; item: boolean }[] = [];
  let marker = "";
  for (const part of text.split(new RegExp(`\\s*([•${LIST_END}])\\s*`))) {
    if (part === "•" || part === LIST_END) { marker = part; continue; }
    if (part) part.split(SENTENCE_END).forEach((sentence, j) => out.push({ text: sentence, item: j === 0 && marker === "•" }));
    marker = "";
  }
  return out.length ? out : null;
}

/** The tenant's lead assignments as QueueItems, best first. dueOnly = the call queue (no future follow-ups). */
async function loadItems(request: FastifyRequest, dueOnly: boolean): Promise<QueueItem[]> {
  const { tenantId } = request.seat;

  let query = request.db
    .from("lead_assignments")
    .select("id, tenant_id, state, delivered_at, next_action_at, lead_id")
    .eq("tenant_id", tenantId);
  // A follow-up in the future keeps the lead out of the queue until it's due.
  if (dueOnly) query = query.or(`next_action_at.is.null,next_action_at.lte.${new Date().toISOString()}`);
  const { data, error } = await query;
  if (error) throw error;
  const assignments = data as AssignmentRow[];

  // Belt and braces on top of the .eq filter and RLS: a row from another tenant must never leave here.
  if (assignments.some((a) => a.tenant_id !== tenantId)) throw new Error("tenant isolation violated in lead assignments");

  const leadIds = assignments.map((a) => a.lead_id);
  if (!leadIds.length) return [];

  const { data: leadData, error: leadError } = await service()
    .from("leads")
    .select(
      `id, why_now, alternate_contact_ids, primary_contact_id, opening_script, role_intelligence, objections,
       hiring_signal:hiring_signals ( role_title, location, detected_at, posted_date, opening_count, shift, pay_min, pay_max, pay_interval, pay_currency, pay_context, source, company:companies ( name ), raw_signal:raw_signals ( raw_payload ) ),
       primary_contact:contacts!primary_contact_id ( name, title, phone, email, confidence_score, phone_verified, verified_at, tier )`,
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

  // ponytail: reads every event for every assignment; paginate /leads if a tenant's history gets large.
  const { data: eventRows, error: eventError } = await request.db
    .from("interaction_events")
    .select("lead_assignment_id, event_type, disposition, note, follow_up_note, occurred_at")
    .eq("tenant_id", tenantId)
    .in("lead_assignment_id", assignments.map((a) => a.id))
    .order("occurred_at");
  if (eventError) throw eventError;
  const attempts = new Map<string, number>();
  const lastEvent = new Map<string, EventRow>();
  const notes = new Map<string, string[]>();
  for (const r of eventRows as EventRow[]) {
    if (r.note) notes.set(r.lead_assignment_id, [...(notes.get(r.lead_assignment_id) ?? []), r.note]);
    if (r.disposition === "no_answer") attempts.set(r.lead_assignment_id, (attempts.get(r.lead_assignment_id) ?? 0) + 1);
    lastEvent.set(r.lead_assignment_id, r);
  }

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
      const last = lastEvent.get(a.id);
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
        functionMatch: lead.primary_contact.tier === "function",
        signalFirstSeen: lead.hiring_signal.detected_at,
        postedDate: lead.hiring_signal.posted_date,
        contactConfidence: lead.primary_contact.confidence_score,
        phoneVerifiedAt: lead.primary_contact.phone_verified ? lead.primary_contact.verified_at : null,
        openingScript: lead.opening_script,
        roleIntelligence: lead.role_intelligence,
        objections: lead.objections,
        // Computed now from the posting's age, never stored: a stored band is only right on the day it was written.
        freshnessBand: freshnessBand(postingAgeDays(lead.hiring_signal.posted_date ?? lead.hiring_signal.detected_at)),
        openingCount: lead.hiring_signal.opening_count,
        shift: lead.hiring_signal.shift,
        // numeric columns come back from PostgREST as numbers, but Number() keeps a string-typed numeric from leaking through
        pay:
          lead.hiring_signal.pay_min !== null && lead.hiring_signal.pay_max !== null
            ? { min: Number(lead.hiring_signal.pay_min), max: Number(lead.hiring_signal.pay_max), interval: lead.hiring_signal.pay_interval, currency: lead.hiring_signal.pay_currency }
            : null,
        payContext: lead.hiring_signal.pay_context,
        // ponytail: parses every stored payload on each /leads call; store the split text at ingest if /leads gets slow.
        jobDescription: lead.hiring_signal.raw_signal?.raw_payload.rawPayload
          ? splitPosting(postingText(lead.hiring_signal.source, lead.hiring_signal.raw_signal.raw_payload.rawPayload, true))
          : null,
        employer: operatingEmployer(lead.hiring_signal.company.name, lead.hiring_signal.raw_signal?.raw_payload.rawPayload),
        whyNow: lead.why_now,
        noAnswerAttempts: attempts.get(a.id) ?? 0,
        alternateContacts: lead.alternate_contact_ids.flatMap((id) => contactsById.get(id) ?? []),
        nextActionAt: a.next_action_at,
        notes: notes.get(a.id) ?? [],
        // Events logged before dispositions existed (0022) only have an event_type, e.g. "contacted".
        lastEvent: last ? { disposition: last.disposition ?? last.event_type, note: last.note, followUpNote: last.follow_up_note, occurredAt: last.occurred_at } : null,
      };
    });
}

export async function queueRoutes(app: FastifyInstance) {
  // Who am I — lets the web app hold the seat (tenant_id, role) without touching tables itself.
  app.get("/me", { preHandler: requireSeat }, async (request) => request.seat);

  app.get("/queue", { preHandler: requireSeat }, async (request) => loadItems(request, true));

  // Every assignment in any state, incl. future follow-ups: the web app derives My Day, New Leads,
  // Follow-Ups and History from this one list.
  app.get("/leads", { preHandler: requireSeat }, async (request) => loadItems(request, false));

  // One assignment's outcome timeline, oldest first (History's right rail).
  app.get<{ Params: { leadAssignmentId: string } }>(
    "/lead-assignments/:leadAssignmentId/events",
    {
      preHandler: requireSeat,
      schema: { params: { type: "object", required: ["leadAssignmentId"], properties: { leadAssignmentId: { type: "string", format: "uuid" } } } },
    },
    async (request) => {
      const { data, error } = await request.db
        .from("interaction_events")
        .select("id, occurred_at, event_type, disposition, note, follow_up_at, follow_up_note, not_a_fit_reason")
        .eq("tenant_id", request.seat.tenantId)
        .eq("lead_assignment_id", request.params.leadAssignmentId)
        .order("occurred_at");
      if (error) throw error;
      return data;
    },
  );
}
