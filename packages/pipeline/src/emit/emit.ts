import { createLogger } from "@fdl/shared";
import {
  contactRepository,
  exclusionRepository,
  hiringSignalPostingRepository,
  hiringSignalRepository,
  leadAssignmentRepository,
  leadRepository,
  scoreRecordRepository,
} from "@fdl/db";
import { CONTRACT_VERSION } from "@fdl/contracts";
import { combineLiveness, getSource, type PostingLiveness } from "@fdl/sources";
import { getDb } from "../db.js";
import { assignPrimaryAndAlternates } from "../enrich/multiContact.js";

const log = createLogger("emit");

/**
 * Re-hits the source board(s) (same endpoints ingest uses). The same real job can be on more than one board
 * (cross-source dedup keeps every copy, migration 0030), so it is live if ANY copy is and gone only when every
 * copy is confirmed gone — the retained copy dying must not expire a job still live on the other board. Anything that
 * stops us from checking — unreachable source, dead board token, no recorded copy — is "unknown", never "gone".
 */
async function checkPostingStillLive(hiringSignalId: string): Promise<PostingLiveness> {
  const copies = await hiringSignalPostingRepository(getDb()).listByHiringSignalId(hiringSignalId);
  if (copies.length === 0) {
    log.warn({ hiringSignalId }, "no recorded source posting to re-verify this signal under — treating as unknown, not gone");
    return "unknown";
  }
  const results: PostingLiveness[] = [];
  for (const copy of copies) {
    const result = await getSource(copy.source).checkPosting(copy.source_token, copy.source_posting_id);
    if (result === "live") return "live"; // no need to hit the other boards
    results.push(result);
  }
  return combineLiveness(results);
}

/** `retryable` marks a skip that is only "we couldn't check" — the caller should try this signal again, not drop it. */
export async function emitLead(
  hiringSignalId: string,
  tenantId: string,
): Promise<{ leadId: string; leadAssignmentId: string } | { skipped: true; reason: string; retryable?: boolean }> {
  const db = getDb();
  const contacts = contactRepository(db);
  const leads = leadRepository(db);
  const leadAssignments = leadAssignmentRepository(db);
  const scoreRecords = scoreRecordRepository(db);

  const scoreRecord = await scoreRecords.findByTenantAndHiringSignal(tenantId, hiringSignalId);
  if (!scoreRecord) throw new Error(`no score_record for hiring_signal ${hiringSignalId}, tenant ${tenantId}`);

  if (!scoreRecord.eligible) {
    log.info({ hiringSignalId, tenantId }, "score_record not eligible — skipping emission");
    return { skipped: true, reason: "not eligible" };
  }

  // Live re-verification, only when this emit would newly show the posting to a tenant (an existing assignment was
  // already shown and verified). Checked before anything is created, so a dead posting never becomes a lead.
  const existingLead = await leads.findByHiringSignalId(hiringSignalId);
  if (!existingLead || !(await leadAssignments.findByTenantAndLead(tenantId, existingLead.id))) {
    const liveness = await checkPostingStillLive(hiringSignalId);
    if (liveness === "gone") {
      await hiringSignalRepository(db).setStatus(hiringSignalId, "expired", `posting-gone: no longer on source board at ${new Date().toISOString()}`);
      log.info({ hiringSignalId, tenantId }, "posting is no longer live on its source board — expired, not emitting");
      return { skipped: true, reason: "expired: posting no longer live" };
    }
    if (liveness === "unknown") {
      log.warn({ hiringSignalId, tenantId }, "could not verify posting is live (source unreachable) — NOT expired, skipping this cycle");
      return { skipped: true, reason: "live check unavailable — not expired, retry", retryable: true };
    }
  }

  // Leads are global — the same hiring_signal reaching two eligible tenants must reuse this one
  // row, not create a duplicate. lead_assignments is the tenant-scoped join on top of it.
  let lead = await leads.findByHiringSignalId(hiringSignalId);
  if (!lead) {
    // The primary is the best tier's contact nearest the opening (else highest confidence); the others, best
    // first, are the alternates. One contact gives none, exactly as before multi-contact resolution.
    const openingLocation = (await hiringSignalRepository(db).findById(hiringSignalId))?.location ?? null;
    const assigned = assignPrimaryAndAlternates(await contacts.listByHiringSignalId(hiringSignalId), openingLocation);
    if (!assigned) throw new Error(`no contact for hiring_signal ${hiringSignalId} — scoring should have caught this`);

    lead = await leads.create({
      contractVersion: CONTRACT_VERSION,
      hiringSignalId,
      primaryContactId: assigned.primary.id,
      alternateContactIds: assigned.alternates.map((c) => c.id),
    });
    log.info({ hiringSignalId, leadId: lead.id, alternates: assigned.alternates.length }, "created lead");
  } else {
    log.info({ hiringSignalId, leadId: lead.id }, "reusing existing lead for this signal");
  }

  // Once a lead exists, point this tenant's score_record at it rather than leaving it orphaned
  // on hiring_signal_id — see migration 0016/scoreRecordRepository.setLeadId.
  if (scoreRecord.lead_id !== lead.id) {
    await scoreRecords.setLeadId(scoreRecord.id, lead.id);
  }

  let leadAssignment = await leadAssignments.findByTenantAndLead(tenantId, lead.id);
  if (!leadAssignment) {
    // The lead stays global; only this tenant's assignment is blocked. Expected behavior, not an error:
    // any active exclusion (do_not_contact, client, house_account, competitor, previously_rejected)
    // for this tenant + company means the tenant never gets a new assignment there.
    const hiringSignal = await hiringSignalRepository(db).findById(hiringSignalId);
    if (!hiringSignal) throw new Error(`hiring_signal ${hiringSignalId} not found`);
    const exclusion = await exclusionRepository(db).findActive(tenantId, hiringSignal.company_id);
    if (exclusion) {
      log.info(
        { hiringSignalId, tenantId, leadId: lead.id, companyId: hiringSignal.company_id, exclusionType: exclusion.exclusion_type },
        `lead_assignment blocked by tenant exclusion (${exclusion.exclusion_type}) — lead stays global, not assigned to this tenant`,
      );
      return { skipped: true, reason: `excluded: ${exclusion.exclusion_type}` };
    }

    leadAssignment = await leadAssignments.create({ tenantId, leadId: lead.id });
    log.info({ hiringSignalId, tenantId, leadId: lead.id, leadAssignmentId: leadAssignment.id }, "created lead_assignment");
  } else {
    log.info({ hiringSignalId, tenantId, leadId: lead.id }, "lead_assignment already exists for this tenant — reusing");
  }

  return { leadId: lead.id, leadAssignmentId: leadAssignment.id };
}
