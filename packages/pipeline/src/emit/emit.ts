import { createLogger } from "@fdl/shared";
import { contactRepository, leadAssignmentRepository, leadRepository, scoreRecordRepository } from "@fdl/db";
import { CONTRACT_VERSION } from "@fdl/contracts";
import { getDb } from "../db.js";

const log = createLogger("emit");

export async function emitLead(
  hiringSignalId: string,
  tenantId: string,
): Promise<{ leadId: string; leadAssignmentId: string } | { skipped: true; reason: string }> {
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

  // Leads are global — the same hiring_signal reaching two eligible tenants must reuse this one
  // row, not create a duplicate. lead_assignments is the tenant-scoped join on top of it.
  let lead = await leads.findByHiringSignalId(hiringSignalId);
  if (!lead) {
    const contact = await contacts.findByHiringSignalId(hiringSignalId);
    if (!contact) throw new Error(`no contact for hiring_signal ${hiringSignalId} — scoring should have caught this`);

    lead = await leads.create({
      contractVersion: CONTRACT_VERSION,
      hiringSignalId,
      primaryContactId: contact.id,
    });
    log.info({ hiringSignalId, leadId: lead.id }, "created lead");
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
    leadAssignment = await leadAssignments.create({ tenantId, leadId: lead.id });
    log.info({ hiringSignalId, tenantId, leadId: lead.id, leadAssignmentId: leadAssignment.id }, "created lead_assignment");
  } else {
    log.info({ hiringSignalId, tenantId, leadId: lead.id }, "lead_assignment already exists for this tenant — reusing");
  }

  return { leadId: lead.id, leadAssignmentId: leadAssignment.id };
}
