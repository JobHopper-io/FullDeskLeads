import { createServiceClient, tenantRepository } from "@fdl/db";
import { scoreHiringSignal, emitLead } from "@fdl/pipeline";
import { loadEnv, createLogger } from "@fdl/shared";

// Direct-call debugging path, same idea as scripts/run-enrichment.ts: bypasses BullMQ/Redis and
// calls scoreHiringSignal + emitLead for every hiring_signal that has a linked contact and
// doesn't yet have a score_record for a given tenant, against every real tenant.
const log = createLogger("run-scoring-and-emission");
const db = createServiceClient(loadEnv());

const tenants = await tenantRepository(db).listAll();
console.log(`Scoring against ${tenants.length} real tenant(s): ${tenants.map((t) => t.name).join(", ")}`);

const { data: withContact, error: contactErr } = await db
  .from("contacts")
  .select("hiring_signal_id")
  .not("hiring_signal_id", "is", null);
if (contactErr) throw contactErr;
const hiringSignalIdsWithContact = [...new Set(withContact.map((c) => c.hiring_signal_id as string))];
console.log(`hiring_signals with a linked contact: ${hiringSignalIdsWithContact.length}`);

const { count: leadsBefore } = await db.from("leads").select("*", { count: "exact", head: true });
const { count: assignmentsBefore } = await db.from("lead_assignments").select("*", { count: "exact", head: true });

// hiringSignalId -> tenant names it was eligible for, to report the multi-tenant case directly.
const eligibleTenantsBySignal = new Map<string, string[]>();

for (const tenant of tenants) {
  const { data: alreadyScored, error: scoredErr } = await db
    .from("score_records")
    .select("hiring_signal_id")
    .eq("tenant_id", tenant.id)
    .not("hiring_signal_id", "is", null);
  if (scoredErr) throw scoredErr;
  const alreadyScoredIds = new Set(alreadyScored.map((r) => r.hiring_signal_id as string));

  const targets = hiringSignalIdsWithContact.filter((id) => !alreadyScoredIds.has(id));
  console.log(`\n${tenant.name}: ${targets.length} signal(s) to score (of ${hiringSignalIdsWithContact.length} with a contact)`);

  let eligible = 0;
  let notEligible = 0;

  for (const hiringSignalId of targets) {
    const scoreResult = await scoreHiringSignal(hiringSignalId, tenant.id);
    if (scoreResult.eligible) {
      eligible++;
      const existing = eligibleTenantsBySignal.get(hiringSignalId) ?? [];
      existing.push(tenant.name);
      eligibleTenantsBySignal.set(hiringSignalId, existing);

      const emitResult = await emitLead(hiringSignalId, tenant.id);
      if ("skipped" in emitResult) {
        log.warn({ hiringSignalId, tenantId: tenant.id, reason: emitResult.reason }, "eligible but emission skipped");
      }
    } else {
      notEligible++;
    }
  }

  console.log(`  scored: ${targets.length}, eligible: ${eligible}, not eligible: ${notEligible}`);
}

const { count: leadsAfter } = await db.from("leads").select("*", { count: "exact", head: true });
const { count: assignmentsAfter } = await db.from("lead_assignments").select("*", { count: "exact", head: true });

const multiTenantSignals = [...eligibleTenantsBySignal.entries()].filter(([, tenantNames]) => tenantNames.length > 1);

console.log(`
Scoring + emission summary
---------------------------
Leads created:            ${(leadsAfter ?? 0) - (leadsBefore ?? 0)}  (${leadsBefore} -> ${leadsAfter})
Lead assignments created:  ${(assignmentsAfter ?? 0) - (assignmentsBefore ?? 0)}  (${assignmentsBefore} -> ${assignmentsAfter})

Signals eligible for more than one tenant: ${multiTenantSignals.length}
`);

for (const [hiringSignalId, tenantNames] of multiTenantSignals) {
  const { data: lead } = await db.from("leads").select("id").eq("hiring_signal_id", hiringSignalId).maybeSingle();
  const { data: assignments } = lead
    ? await db.from("lead_assignments").select("id, tenant_id").eq("lead_id", lead.id)
    : { data: null };
  console.log(
    `  ${hiringSignalId}: eligible for [${tenantNames.join(", ")}] -> ${lead ? "1 lead" : "NO LEAD"} (${lead?.id}), ${
      assignments?.length ?? 0
    } lead_assignment(s)`,
  );
}
