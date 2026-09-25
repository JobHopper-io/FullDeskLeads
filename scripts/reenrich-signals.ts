import { contactRepository, createServiceClient, leadRepository, scoreRecordRepository, type ContactRow, type ScoreRecordRow } from "@fdl/db";
import { assignPrimaryAndAlternates, buildTierTitles, deriveJobTitleHints, enrichHiringSignal, getSeamlessCreditSnapshot, scoreHiringSignal, tierOf } from "@fdl/pipeline";
import { createLogger, loadEnv } from "@fdl/shared";

// Re-enrich signals whose role was mapped to the wrong family (the role-mapping audit), then fix what points at the
// old contacts. For each signal: enrich again under the corrected mapping, mark the old rows that aren't part of the
// corrected set as superseded (they STAY in the table), and, if the signal already has a lead, move the lead's
// primary_contact_id and alternate_contact_ids to the corrected contacts. Spends real Seamless credits.
//
//   tsx --env-file=.env scripts/reenrich-signals.ts --ids=<id>,<id> --plan   spends nothing: shows what would run
//   tsx --env-file=.env scripts/reenrich-signals.ts --ids=<id>,<id>          runs it
//
// After a lead's pointers move, its tenant's score is recomputed (free: no Seamless calls) so the stored confidence, and
// with it the order the recruiter's queue shows, reflects the new primary and not the old one.
//
// Deliberately narrow: only the eight roles the audit found mis-mapped, and only signals that already have contacts.
const AUDITED_TITLES = new Set([
  "Accounts Manager", "Construction Accountant", "Design Consultant - Albert Lea, MN", "Manufacturing Intelligence (MI)  Solutions Architect",
  "National Account Executive", "Power Solution Architect  - Strategic Accounts (Nationwide)", "Sales Engineer", "Senior Salesforce Administrator - Austin, TX ONLY",
]);
const MAX_SIGNALS = 8;
const CONCURRENCY = 2; // same as the other enrichment runs: below Seamless's org-wide rate ceiling

const log = createLogger("reenrich");
const db = createServiceClient(loadEnv());
const contacts = contactRepository(db);
const leads = leadRepository(db);
const scoreRecords = scoreRecordRepository(db);

const idsArg = process.argv.find((a) => a.startsWith("--ids="));
const plan = process.argv.includes("--plan");
if (!idsArg) {
  console.error("usage: reenrich-signals.ts --ids=<hiring_signal_id>,<id>... [--plan]");
  process.exit(1);
}
const ids = [...new Set(idsArg.slice("--ids=".length).split(",").filter(Boolean))];
if (ids.length === 0 || ids.length > MAX_SIGNALS) throw new Error(`expected 1-${MAX_SIGNALS} hiring_signal ids, got ${ids.length}`);

const { data: signals, error } = await db.from("hiring_signals").select("id, role_title, location, companies(name, domain)").in("id", ids);
if (error) throw error;
for (const id of ids) {
  const s = signals?.find((x) => x.id === id);
  if (!s) throw new Error(`hiring_signal ${id} not found`);
  if (!AUDITED_TITLES.has(s.role_title)) throw new Error(`refusing ${id}: "${s.role_title}" is not one of the eight audited roles`);
}

// Where a lead sits in a tenant's queue, by the same ordering the API uses (apps/api /queue): stored confidence
// descending (no score record sorts last), then most recently delivered. Due assignments only.
async function queueRanks(tenantId: string): Promise<{ rank: Map<string, number>; total: number }> {
  const { data: asg, error: aErr } = await db.from("lead_assignments").select("lead_id, delivered_at, next_action_at").eq("tenant_id", tenantId);
  if (aErr) throw aErr;
  const now = Date.now();
  const due = asg!.filter((a) => !a.next_action_at || Date.parse(a.next_action_at) <= now);
  const { data: sr } = await db.from("score_records").select("lead_id, confidence_score").eq("tenant_id", tenantId).in("lead_id", due.map((a) => a.lead_id));
  const conf = new Map((sr ?? []).map((x) => [x.lead_id as string, (x.confidence_score as number | null) ?? -1]));
  const ordered = [...due].sort((x, y) => (conf.get(y.lead_id) ?? -1) - (conf.get(x.lead_id) ?? -1) || (y.delivered_at ?? "").localeCompare(x.delivered_at ?? ""));
  return { rank: new Map(ordered.map((a, i) => [a.lead_id as string, i + 1])), total: ordered.length };
}

type Snapshot = { tenants: string[]; scoreBefore: Map<string, ScoreRecordRow | null>; rankBefore: Map<string, number>; signalId: string; role: string; company: string; location: string | null; leadId: string | null; oldContacts: ContactRow[]; oldPrimary: ContactRow | null; oldPrimaryFrom: "lead" | "rule" };
const snapshots: Snapshot[] = [];
for (const id of ids) {
  const s = signals!.find((x) => x.id === id)!;
  const oldContacts = await contacts.listByHiringSignalId(id);
  if (oldContacts.length === 0) throw new Error(`refusing ${id}: no contacts yet, this is for re-enrichment only`);
  const { data: lead } = await db.from("leads").select("id, primary_contact_id").eq("hiring_signal_id", id).maybeSingle();
  const fromLead = lead ? oldContacts.find((c) => c.id === lead.primary_contact_id) ?? null : null;
  const company = (s.companies as unknown as { name: string }).name;
  const tenants = lead ? [...new Set(((await db.from("lead_assignments").select("tenant_id").eq("lead_id", lead.id)).data ?? []).map((a) => a.tenant_id as string))] : [];
  const scoreBefore = new Map<string, ScoreRecordRow | null>();
  const rankBefore = new Map<string, number>();
  for (const t of tenants) {
    scoreBefore.set(t, await scoreRecords.findByTenantAndHiringSignal(t, id));
    rankBefore.set(t, (await queueRanks(t)).rank.get(lead!.id) ?? 0);
  }
  snapshots.push({
    tenants, scoreBefore, rankBefore, signalId: id, role: s.role_title, company, location: s.location, leadId: lead?.id ?? null, oldContacts,
    oldPrimary: fromLead ?? assignPrimaryAndAlternates(oldContacts, s.location)?.primary ?? null, oldPrimaryFrom: fromLead ? "lead" : "rule",
  });
}

// What this will search for, and the most it can cost (identical searches are shared within the run, 1 credit each).
const searchKeys = new Set<string>();
let worstResearch = 0;
for (const snap of snapshots) {
  const domain = (signals!.find((x) => x.id === snap.signalId)!.companies as unknown as { domain: string }).domain;
  const hints = deriveJobTitleHints(snap.role);
  const generic = hints.join("|") === "Operations Manager|General Manager|HR Manager";
  const tiers = buildTierTitles(generic ? [] : hints);
  const paying = (["function", "site", "hr"] as const).filter((t) => tiers[t].length > 0);
  for (const t of paying) searchKeys.add(`${domain}|${tiers[t].join(",")}`);
  worstResearch += 4;
  console.log(`${snap.company.split(" ")[0].padEnd(10)} ${snap.role.slice(0, 50).padEnd(50)} searches: ${paying.join("+").padEnd(18)} lead: ${snap.leadId ? "YES, rescore tenant " + snap.tenants.map((t) => t.slice(0, 4)).join(",") : "no "}  old contacts: ${snap.oldContacts.length}`);
}
console.log(`\n${snapshots.length} signals, ${snapshots.filter((s) => s.leadId).length} with a lead. Distinct searches (1 credit each): ${searchKeys.size}. Research: up to ${worstResearch} (duplicates recover free). Worst case ${searchKeys.size + worstResearch} credits.`);
if (plan) {
  console.log("--plan: nothing was spent or changed.");
  process.exit(0);
}

const fmt = (c: ContactRow | null) => (c ? `${c.name} - ${c.title}` : "(none)");
const results = new Map<string, { contactIds: string[]; superseded: string[]; status: string }>();

async function runOne(snap: Snapshot): Promise<void> {
  const r = await enrichHiringSignal(snap.signalId);
  const status = r.terminalStatus ?? "unknown";
  if (!r.contactIds || r.contactIds.length === 0) {
    // Nothing usable came back: leave everything exactly as it was.
    results.set(snap.signalId, { contactIds: [], superseded: [], status });
    log.warn({ signalId: snap.signalId, status }, "no corrected contacts: nothing changed for this signal");
    return;
  }
  const keep = r.contactIds;
  const superseded = await contacts.supersedeAllExcept(snap.signalId, keep);
  if (snap.leadId) {
    await leads.setContacts(snap.leadId, keep[0], keep.slice(1, 4));
    // Recompute this lead's score for the tenant(s) it is assigned to. Free; updates the existing row in place.
    for (const tenantId of snap.tenants) await scoreHiringSignal(snap.signalId, tenantId);
  }
  results.set(snap.signalId, { contactIds: keep, superseded, status });
}
let next = 0;
await Promise.all(
  Array.from({ length: Math.min(CONCURRENCY, snapshots.length) }, async () => {
    while (next < snapshots.length) await runOne(snapshots[next++]);
  }),
);

// ── verification, read back from the database (not from what the code above believes it did) ──
console.log("\n=== BEFORE / AFTER, read back from the database ===");
const allSuperseded = [...results.values()].flatMap((r) => r.superseded);
let problems = 0;
for (const snap of snapshots) {
  const res = results.get(snap.signalId)!;
  const active = await contacts.listByHiringSignalId(snap.signalId);
  const want = assignPrimaryAndAlternates(active, snap.location);
  const { data: lead } = snap.leadId ? await db.from("leads").select("primary_contact_id, alternate_contact_ids").eq("id", snap.leadId).single() : { data: null };
  const newPrimary = lead ? active.find((c) => c.id === lead.primary_contact_id) ?? null : want?.primary ?? null;
  const tierNow = (c: ContactRow | null) => (c ? `${c.tier ?? `unknown (guess: ${tierOf(c.title)})`}` : "-");
  console.log(`\n${snap.company.split(" ")[0]} | ${snap.role} | ${snap.location}   [${snap.signalId.slice(0, 8)}]  status ${res.status}`);
  console.log(`   OLD primary (${snap.oldPrimaryFrom === "lead" ? "the lead's" : "by the rule"}): ${fmt(snap.oldPrimary)}   tier ${tierNow(snap.oldPrimary)}`);
  console.log(`   NEW primary: ${fmt(newPrimary)}   tier ${tierNow(newPrimary)}   conf ${newPrimary?.confidence_score ?? "-"}`);
  console.log(`   corrected set (${active.length}): ${active.map((c) => `${c.name} [${c.tier}]`).join("; ")}`);
  console.log(`   old rows kept but superseded: ${res.superseded.length} (${snap.oldContacts.filter((c) => res.superseded.includes(c.id)).map((c) => c.name).join("; ") || "-"})`);
  if (snap.leadId) {
    for (const t of snap.tenants) {
      const b = snap.scoreBefore.get(t) ?? null;
      const a = await scoreRecords.findByTenantAndHiringSignal(t, snap.signalId);
      const q = await queueRanks(t);
      const { data: srAll } = await db.from("score_records").select("id").eq("tenant_id", t).eq("lead_id", snap.leadId);
      console.log(`   SCORE tenant ${t.slice(0, 4)}: confidence ${b?.confidence_score ?? "none"} -> ${a?.confidence_score ?? "none"} | fit ${b?.fit_score} -> ${a?.fit_score} | freshness ${b?.freshness_score} -> ${a?.freshness_score} | eligible ${b?.eligible} -> ${a?.eligible} | queue position ${snap.rankBefore.get(t)} -> ${q.rank.get(snap.leadId) ?? "?"} of ${q.total} | score records for this lead: ${srAll?.length} (lead_id kept: ${a?.lead_id === snap.leadId ? "yes" : "NO"}) | recomputed ${a?.computed_at?.slice(11, 19)}Z`);
      if (srAll?.length !== 1 || a?.lead_id !== snap.leadId) problems++;
    }
    const changed = lead!.primary_contact_id !== snap.oldPrimary?.id;
    const matches = lead!.primary_contact_id === want?.primary.id;
    const stale = [lead!.primary_contact_id, ...lead!.alternate_contact_ids].filter((id: string) => res.superseded.includes(id));
    console.log(`   LEAD ${snap.leadId.slice(0, 8)}: primary_contact_id changed: ${changed ? "YES" : "NO"} | equals the corrected primary: ${matches ? "YES" : "NO"} | alternates now ${lead!.alternate_contact_ids.length} | still points at a superseded row: ${stale.length}`);
    if (res.contactIds.length > 0 && (!changed && res.superseded.includes(snap.oldPrimary?.id ?? "") || !matches || stale.length > 0)) problems++;
  }
}
const { data: refsP } = await db.from("leads").select("id").in("primary_contact_id", allSuperseded.length ? allSuperseded : ["00000000-0000-0000-0000-000000000000"]);
const { data: refsA } = await db.from("leads").select("id").overlaps("alternate_contact_ids", allSuperseded.length ? allSuperseded : ["00000000-0000-0000-0000-000000000000"]);
const stillRows = allSuperseded.length ? (await db.from("contacts").select("id").in("id", allSuperseded)).data!.length : 0;
console.log(`\nsuperseded rows: ${allSuperseded.length} | still in the contacts table: ${stillRows} | ANY lead (all leads, not just these) using one as primary: ${refsP?.length ?? 0}, as alternate: ${refsA?.length ?? 0}`);
if ((refsP?.length ?? 0) + (refsA?.length ?? 0) > 0 || stillRows !== allSuperseded.length) problems++;

const { first, last } = getSeamlessCreditSnapshot();
console.log(`\nSeamless credits: ${first ?? "?"} -> ${last ?? "?"}  (${first !== null && last !== null ? first - last : "?"} consumed after the first reading; add 1 for the first call)`);
console.log(problems ? `\n${problems} PROBLEM(S) — see above` : "\nverification clean");
process.exit(problems ? 1 : 0);
