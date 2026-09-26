import { contactRepository, createServiceClient, scoreRecordRepository } from "@fdl/db";
import { assignPrimaryAndAlternates, scoreHiringSignal } from "@fdl/pipeline";
import { loadEnv } from "@fdl/shared";

// Recompute the score of signals whose contacts changed after they were scored (a corrected re-enrichment). Free: no
// Seamless calls. Only UPDATES score records that already exist, in place, for the tenants that have one: it never
// creates a record (a signal nobody has scored yet is left for the normal scoring run) and never calls emit.
//   tsx --env-file=.env scripts/rescore-signals.ts --ids=<hiring_signal_id>,<id> [--plan]
const idsArg = process.argv.find((a) => a.startsWith("--ids="));
if (!idsArg) {
  console.error("usage: rescore-signals.ts --ids=<hiring_signal_id>,<id>... [--plan]");
  process.exit(1);
}
const ids = [...new Set(idsArg.slice("--ids=".length).split(",").filter(Boolean))];
const plan = process.argv.includes("--plan");
const db = createServiceClient(loadEnv());
const contacts = contactRepository(db);
const scores = scoreRecordRepository(db);
const { data: tenants } = await db.from("tenants").select("id, name");
const tenantName = new Map((tenants ?? []).map((t) => [t.id as string, t.name as string]));

let problems = 0;
for (const id of ids) {
  const { data: signal } = await db.from("hiring_signals").select("role_title, location, companies(name)").eq("id", id).single();
  if (!signal) throw new Error(`hiring_signal ${id} not found`);
  const active = await contacts.listByHiringSignalId(id);
  const primary = assignPrimaryAndAlternates(active, signal.location)?.primary ?? null;
  const { data: rows } = await db.from("score_records").select("id, tenant_id, lead_id, confidence_score, eligible, computed_at").eq("hiring_signal_id", id);
  console.log(`\n${(signal.companies as unknown as { name: string }).name.split(" ")[0]} | ${signal.role_title} [${id.slice(0, 8)}] | current primary: ${primary ? `${primary.name} (${primary.confidence_score}, ${primary.tier})` : "none"} | existing score records: ${rows?.length ?? 0}`);
  for (const r of rows ?? []) {
    console.log(`   ${tenantName.get(r.tenant_id)}: confidence ${r.confidence_score} | eligible ${r.eligible} | lead_id ${r.lead_id ? r.lead_id.slice(0, 8) : "null"} | computed ${String(r.computed_at).slice(0, 19)}Z`);
    if (plan) continue;
    await scoreHiringSignal(id, r.tenant_id);
    const after = await scores.findByTenantAndHiringSignal(r.tenant_id, id);
    const { data: count } = await db.from("score_records").select("id").eq("tenant_id", r.tenant_id).eq("hiring_signal_id", id);
    const ok = !!after && after.id === r.id && count?.length === 1 && after.lead_id === r.lead_id && after.eligible === r.eligible && (primary ? after.confidence_score === primary.confidence_score : true);
    console.log(`      -> confidence ${after?.confidence_score} | eligible ${after?.eligible} | same record: ${after?.id === r.id} | records for (tenant, signal): ${count?.length} | lead link unchanged: ${after?.lead_id === r.lead_id} | matches current primary: ${primary ? after?.confidence_score === primary.confidence_score : "n/a"}  ${ok ? "OK" : "PROBLEM"}`);
    if (!ok) problems++;
  }
}
console.log(plan ? "\n--plan: nothing changed." : problems ? `\n${problems} PROBLEM(S)` : "\nall score records updated in place and consistent");
process.exit(problems ? 1 : 0);
