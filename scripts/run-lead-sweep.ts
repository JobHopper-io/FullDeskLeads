// Run: npx tsx --env-file=.env scripts/run-lead-sweep.ts [--plan] — the same sweep the daily schedule runs, on demand.
// Re-checks every lead a recruiter can still work (filter rules + live re-verification); a lead whose signal is no longer
// valid has its assignment(s) moved to expired and its signal status set. interaction_events are never touched.
// --plan reports what would change and writes nothing.
import { sweepEmittedLeads } from "../packages/pipeline/src/index.js";

const dryRun = process.argv.includes("--plan");
const { assignmentsChecked, signalsChecked, findings } = await sweepEmittedLeads({ dryRun });
const tally: Record<string, number> = {};
for (const f of findings) tally[f.outcome] = (tally[f.outcome] ?? 0) + 1;
console.log(`${dryRun ? "[PLAN, nothing written] " : ""}workable assignments: ${assignmentsChecked} | signals checked: ${signalsChecked} | outcomes: ${JSON.stringify(tally)}`);
for (const f of findings.filter((f) => f.outcome !== "live")) {
  console.log(`  ${f.outcome.toUpperCase().padEnd(24)} ${f.company} | ${f.roleTitle.trim()} | signal ${f.hiringSignalId.slice(0, 8)} | ${f.detail ?? ""} | assignments ${dryRun ? "to expire" : "expired"}: ${f.expiredAssignmentIds.length}`);
}
