// Run: npx tsx --env-file=.env scripts/report-evergreen.ts [--days=365] — READ-ONLY evergreen report; excludes nothing.
// Proposed rule (unvalidated, awaiting real outcomes): flag an active signal whose posted_date is older than --days.
// Repost pattern is reported as context only: >1 live requisition with the same company+title+location. Today's history
// (2 ingest days, no last-seen tracking) cannot show close-and-repost cycles, and same-location duplicates are usually
// concurrent headcount, so it is NOT used to flag.
import { createServiceClient } from "@fdl/db";
import { loadEnv } from "@fdl/shared";

const days = Number(process.argv.find((a) => a.startsWith("--days="))?.slice(7) ?? 365);
const db = createServiceClient(loadEnv());
const { data, error } = await db.from("hiring_signals").select("id, role_title, location, posted_date, company_id, companies(name)").eq("status", "active").not("posted_date", "is", null);
if (error) throw error;
const { data: leads } = await db.from("leads").select("hiring_signal_id");
const emitted = new Set((leads ?? []).map((l) => l.hiring_signal_id));
const ageOf = (d: string) => Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
const name = (h: (typeof data)[number]) => (h.companies as unknown as { name: string }).name;

const old = data.filter((h) => ageOf(h.posted_date!) > days);
console.log(`active signals: ${data.length} | older than ${days}d: ${old.length} | of which already emitted as leads: ${old.filter((h) => emitted.has(h.id)).length}`);
const per = new Map<string, [number, number]>();
for (const h of data) { const [o, t] = per.get(name(h)) ?? [0, 0]; per.set(name(h), [o + (ageOf(h.posted_date!) > days ? 1 : 0), t + 1]); }
for (const [c, [o, t]] of per) console.log(`  ${c}: ${o}/${t} (${Math.round((100 * o) / t)}%) older than ${days}d`);

const norm = (s: string | null) => (s ?? "").trim().toLowerCase();
const groups = new Map<string, typeof data>();
for (const h of data) { const k = `${h.company_id}|${norm(h.role_title)}|${norm(h.location)}`; groups.set(k, [...(groups.get(k) ?? []), h]); }
const repeats = [...groups.values()].filter((g) => g.length > 1);
console.log(`\nsame company+title+location, >1 live requisition (context only): ${repeats.length} groups`);
for (const g of repeats) console.log(`  ${name(g[0])} | ${g[0].role_title} | ${g[0].location} | posted ${g.map((x) => x.posted_date).sort().join(", ")}`);
