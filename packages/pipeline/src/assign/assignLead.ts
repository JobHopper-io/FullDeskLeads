import type { SupabaseClient } from "@supabase/supabase-js";
import {
  companyRepository,
  leadAssignmentRepository,
  rawSignalRepository,
  recruiterPreferencesRepository,
  seatRepository,
  type HiringSignalRow,
  type LeadAssignmentRow,
  type LeadRow,
} from "@fdl/db";
import { leadAttributes } from "../match/leadMatch.js";
import { decideAssignment } from "./assignmentPolicy.js";

/**
 * Creates this tenant's assignment for a lead, applying the recruiters' saved Specialty Filters (decideAssignment).
 * The caller has already checked there is no assignment yet and that no exclusion applies. `skipped` means the
 * lead was deliberately left unassigned (outside every saved filter and the day is full): it stays in the general
 * pool, visible in Opportunities.
 */
export async function assignLeadToTenant(
  db: SupabaseClient,
  input: { tenantId: string; lead: LeadRow; hiringSignal: HiringSignalRow; target?: number },
): Promise<{ assignment: LeadAssignmentRow } | { skipped: true; reason: string }> {
  const { tenantId, lead, hiringSignal } = input;
  const assignments = leadAssignmentRepository(db);

  const seats = await seatRepository(db).listByTenant(tenantId);
  const preferences = await recruiterPreferencesRepository(db).listForSeats(seats.map((s) => s.id));

  // Nothing configured: skip the lookups below and keep the original tenant-wide, untagged assignment.
  if (!preferences.length) return { assignment: await assignments.create({ tenantId, leadId: lead.id }) };

  const company = await companyRepository(db).findById(hiringSignal.company_id);
  const raw = hiringSignal.raw_signal_id ? await rawSignalRepository(db).findById(hiringSignal.raw_signal_id) : null;
  const attributes = leadAttributes({
    roleTitle: hiringSignal.role_title,
    department: hiringSignal.department,
    companyName: company?.name ?? "",
    rawPayload: raw?.raw_payload ?? null,
    postedDate: hiringSignal.posted_date,
    detectedAt: hiringSignal.detected_at,
    openingScript: lead.opening_script,
    roleIntelligence: lead.role_intelligence,
    objections: lead.objections,
  });

  const decision = decideAssignment({
    seatIds: seats.map((s) => s.id),
    preferences,
    existing: await assignments.listForTenant(tenantId),
    attributes,
    target: input.target,
  });
  if (!decision.assign) return { skipped: true, reason: decision.reason };
  return { assignment: await assignments.create({ tenantId, leadId: lead.id, seatId: decision.seatId, outsideFilters: decision.outsideFilters }) };
}
