import { createServiceClient, tenantRepository } from "@fdl/db";
import { scoreHiringSignal, emitLead } from "@fdl/pipeline";
import { loadEnv, createLogger } from "@fdl/shared";

// Direct-call debugging path, same idea as scripts/run-enrichment.ts: bypasses BullMQ/Redis and
// calls scoreHiringSignal + emitLead for every hiring_signal that has a linked contact and
// doesn't yet have a score_record for a given tenant, against every real tenant.
// `--rescore-ineligible` also re-scores signals whose existing score_record is not eligible (after a
// scoring-rule fix). scoreRecordRepository upserts, so this updates them in place; no Seamless calls.
// A score is also re-computed when the signal's contacts changed after it was scored (a corrected re-enrichment adds
// contacts and supersedes others): its stored confidence comes from the primary contact, so it would otherwise be
// silently reused. `--dry-run` shows what would be scored (new or stale) and changes nothing.
const rescoreIneligible = process.argv.includes("--rescore-ineligible");
const dryRun = process.argv.includes("--dry-run");
const log = createLogger("run-scoring-and-emission");
const db = createServiceClient(loadEnv());

const tenants = await tenantRepository(db).listAll();
console.log(`Scoring against ${tenants.length} real tenant(s): ${tenants.map((t) => t.name).join(", ")}`);

const { data: withContact, error: contactErr } = await db
  .from("contacts")
  .select("hiring_signal_id, created_at, superseded_at")
  .not("hiring_signal_id", "is", null);
if (contactErr) throw contactErr;
const hiringSignalIdsWithContact = [...new Set(withContact.map((c) => c.hiring_signal_id as string))];
// When each signal's contacts last changed: a contact written, or one superseded.
const contactsChangedAt = new Map<string, string>();
for (const c of withContact) {
  for (const at of [c.created_at as string, c.superseded_at as string | null]) {
    if (at && at > (contactsChangedAt.get(c.hiring_signal_id as string) ?? "")) contactsChangedAt.set(c.hiring_signal_id as string, at);
  }
}
console.log(`hiring_signals with a linked contact: ${hiringSignalIdsWithContact.length}`);

const { count: leadsBefore } = await db.from("leads").select("*", { count: "exact", head: true });
const { count: assignmentsBefore } = await db.from("lead_assignments").select("*", { count: "exact", head: true });

// hiringSignalId -> tenant names it was eligible for, to report the multi-tenant case directly.
const eligibleTenantsBySignal = new Map<string, string[]>();

for (const tenant of tenants) {
  const { data: alreadyScored, error: scoredErr } = await db
    .from("score_records")
    .select("hiring_signal_id, computed_at, lead_id, eligible")
    .eq("tenant_id", tenant.id)
    .not("hiring_signal_id", "is", null)
    .in("eligible", rescoreIneligible ? [true] : [true, false]);
  if (scoredErr) throw scoredErr;
  // Eligible but never emitted (no lead_id) is not "done": emit skips a signal whose source couldn't be reached to
  // re-verify it (not expired), and that signal must be picked up again here rather than lost.
  const alreadyScoredIds = new Set(alreadyScored.filter((r) => !(r.eligible && !r.lead_id)).map((r) => r.hiring_signal_id as string));

  // Scored, but before the signal's contacts last changed: the stored confidence is the old primary's.
  const staleIds = new Set(
    alreadyScored.filter((r) => (contactsChangedAt.get(r.hiring_signal_id as string) ?? "") > (r.computed_at as string)).map((r) => r.hiring_signal_id as string),
  );
  const targets = hiringSignalIdsWithContact.filter((id) => !alreadyScoredIds.has(id) || staleIds.has(id));
  console.log(`\n${tenant.name}: ${targets.length} signal(s) to score (of ${hiringSignalIdsWithContact.length} with a contact), ${staleIds.size} of them stale`);
  if (dryRun) {
    console.log(`  new: ${targets.length - staleIds.size} | stale (contacts changed after they were scored): ${[...staleIds].map((id) => id.slice(0, 8)).join(", ") || "none"}`);
    continue;
  }

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

if (dryRun) {
  console.log("\n--dry-run: nothing was scored or emitted.");
  process.exit(0);
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
