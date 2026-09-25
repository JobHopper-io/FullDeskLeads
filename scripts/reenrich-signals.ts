import { contactRepository, createServiceClient, leadRepository, type ContactRow } from "@fdl/db";
import { assignPrimaryAndAlternates, buildTierTitles, deriveJobTitleHints, enrichHiringSignal, getSeamlessCreditSnapshot, tierOf } from "@fdl/pipeline";
import { createLogger, loadEnv } from "@fdl/shared";

// Re-enrich signals whose role was mapped to the wrong family (the role-mapping audit), then fix what points at the
// old contacts. For each signal: enrich again under the corrected mapping, mark the old rows that aren't part of the
// corrected set as superseded (they STAY in the table), and, if the signal already has a lead, move the lead's
// primary_contact_id and alternate_contact_ids to the corrected contacts. Spends real Seamless credits.
//
//   tsx --env-file=.env scripts/reenrich-signals.ts --ids=<id>,<id> --plan   spends nothing: shows what would run
//   tsx --env-file=.env scripts/reenrich-signals.ts --ids=<id>,<id>          runs it
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

type Snapshot = { signalId: string; role: string; company: string; location: string | null; leadId: string | null; oldContacts: ContactRow[]; oldPrimary: ContactRow | null; oldPrimaryFrom: "lead" | "rule" };
const snapshots: Snapshot[] = [];
for (const id of ids) {
  const s = signals!.find((x) => x.id === id)!;
  const oldContacts = await contacts.listByHiringSignalId(id);
  if (oldContacts.length === 0) throw new Error(`refusing ${id}: no contacts yet, this is for re-enrichment only`);
  const { data: lead } = await db.from("leads").select("id, primary_contact_id").eq("hiring_signal_id", id).maybeSingle();
  const fromLead = lead ? oldContacts.find((c) => c.id === lead.primary_contact_id) ?? null : null;
  const company = (s.companies as unknown as { name: string }).name;
  snapshots.push({
    signalId: id, role: s.role_title, company, location: s.location, leadId: lead?.id ?? null, oldContacts,
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
  console.log(`${snap.company.split(" ")[0].padEnd(10)} ${snap.role.slice(0, 50).padEnd(50)} searches: ${paying.join("+").padEnd(18)} lead: ${snap.leadId ? "YES" : "no "}  old contacts: ${snap.oldContacts.length}`);
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
  if (snap.leadId) await leads.setContacts(snap.leadId, keep[0], keep.slice(1, 4));
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
