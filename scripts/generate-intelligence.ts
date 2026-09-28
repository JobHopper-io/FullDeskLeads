// Run: tsx --env-file=.env scripts/generate-intelligence.ts --out=<staging.json> [--limit=N] [--ids=<id,id,...>]
// --ids reruns exactly those hiring_signals (a clean before/after on the same leads) instead of picking a sample.
// Staging-only intelligence generation for the two confidently evidenced archetypes. Reads leads and signals; writes
// NOTHING to the database. Every result, with the exact inputs the model saw and its QA verdict, goes to --out.
//   - Industrial Electric Manufacturing (SWITCHGEAR_ASSEMBLY): emitted leads a recruiter can still work, plant-floor
//     and field roles only.
//   - DIS-TRAN Steel (STEEL_POLE_STRUCTURE_FAB): it has no emitted leads, so active Crest postings whose operating
//     employer is DIS-TRAN Steel (its Lever department; operatingEmployer), not postings that merely mention it.
import { writeFileSync } from "node:fs";
import { createServiceClient, type HiringSignalRow } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import { generateIntelligence, type GenerationResult, type SourceKey } from "../packages/pipeline/src/intelligence/generate.js";
import { operatingEmployer } from "../packages/sources/src/jobDetails.js";
import { reviewGeneration, type ReviewResult } from "../packages/pipeline/src/intelligence/review.js";
import { postingText } from "../packages/sources/src/jobDetails.js";

const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6);
if (!out) throw new Error("usage: generate-intelligence.ts --out=<staging.json> [--limit=N]");
const limit = Number(process.argv.find((a) => a.startsWith("--limit="))?.slice(8) ?? 4);
const db = createServiceClient(loadEnv());

// Roles whose daily work the archetype's equipment actually describes.
const PLANT_FLOOR = /field service|test supervisor|quality control|production (controller|planner)|materials supervisor|site supervisor|manufacturing engineer|maintenance|technician|welder|machinist|fitter|operator/i;

const { data: iemLeads, error: e1 } = await db
  .from("lead_assignments")
  .select("state, leads!inner(hiring_signals!inner(*, companies!inner(name)))")
  .in("state", ["new", "viewed", "contacted"]);
if (e1) throw e1;
const iem = new Map<string, HiringSignalRow>();
for (const a of iemLeads as unknown as { leads: { hiring_signals: HiringSignalRow & { companies: { name: string } } } }[]) {
  const s = a.leads.hiring_signals;
  if (s.companies.name === "Industrial Electric Manufacturing" && s.status === "active" && PLANT_FLOOR.test(s.role_title)) iem.set(s.id, s);
}

const { data: crest, error: e2 } = await db
  .from("hiring_signals")
  .select("*, companies!inner(name), raw_signals(raw_payload)")
  .eq("companies.name", "Crest Industries")
  .eq("status", "active");
if (e2) throw e2;
const dts = (crest as unknown as (HiringSignalRow & { raw_signals: { raw_payload: unknown } | null })[]).filter((s) => {
  const raw = (s.raw_signals?.raw_payload as { rawPayload?: unknown } | undefined)?.rawPayload;
  return operatingEmployer("Crest Industries", raw) === "DIS-TRAN Steel" && PLANT_FLOOR.test(s.role_title);
});

// Spread the sample across roles rather than taking five near-identical Field Service Technician postings.
const pick = (rows: HiringSignalRow[], n: number) => {
  const seen = new Set<string>();
  return rows.sort((a, b) => a.role_title.localeCompare(b.role_title)).filter((r) => {
    const family = r.role_title.toLowerCase().replace(/\b(i{1,3}|level \w+|lead|senior|sr\.?|- .*|\(.*\))\b/g, "").trim().split(/\s+/).slice(0, 2).join(" ");
    return !seen.has(family) && seen.add(family);
  }).slice(0, n);
};
const ids = process.argv.find((a) => a.startsWith("--ids="))?.slice(6).split(",").filter(Boolean);
const inScope = new Map<string, [HiringSignalRow, SourceKey]>([
  ...[...iem.values()].map((s): [string, [HiringSignalRow, SourceKey]] => [s.id, [s, "INDUSTRIAL_ELECTRIC"]]),
  ...dts.map((s): [string, [HiringSignalRow, SourceKey]] => [s.id, [s, "DIS_TRAN_STEEL"]]),
]);
const targets: [HiringSignalRow, SourceKey][] = ids
  ? ids.map((id) => inScope.get(id) ?? (() => { throw new Error(`--ids: ${id} is not an in-scope signal (workable IEM plant-floor lead or active DIS-TRAN Steel posting)`); })())
  : [
      ...pick([...iem.values()], limit).map((s): [HiringSignalRow, SourceKey] => [s, "INDUSTRIAL_ELECTRIC"]),
      ...pick(dts, Math.max(2, Math.ceil(limit * 0.75))).map((s): [HiringSignalRow, SourceKey] => [s, "DIS_TRAN_STEEL"]),
    ];

// The posting's own description, extracted from the stored raw payload the same way job-details extraction reads it.
const { data: raws, error: e3 } = await db.from("hiring_signals").select("id, source, companies(name), raw_signals(raw_payload)").in("id", targets.map(([s]) => s.id));
if (e3) throw e3;
// Each posting's operating employer, checked against the archetype before any generation (a mismatch fails the lead).
const employers = new Map((raws as unknown as { id: string; companies: { name: string }; raw_signals: { raw_payload: { rawPayload: unknown } } | null }[])
  .map((r) => [r.id, operatingEmployer(r.companies.name, r.raw_signals?.raw_payload.rawPayload)]));
const descriptions = new Map((raws as unknown as { id: string; source: string; raw_signals: { raw_payload: { rawPayload: unknown } } | null }[])
  .map((r) => [r.id, r.raw_signals ? postingText(r.source, r.raw_signals.raw_payload.rawPayload, true) : null]));
console.log(`in scope: ${iem.size} workable Industrial Electric plant-floor leads, ${dts.length} active DIS-TRAN Steel plant-floor postings`);
console.log(`generating for ${targets.length}: ${targets.map(([s]) => s.role_title.trim()).join(" | ")}\n`);

// Known ways Gemma has slipped past the deterministic QA. Every run's output is checked by hand against these.
const HAND_CHECK = [
  "A purpose or output the posting doesn't give the role (run 4, CNC Machinist: \"to produce steel structures\"; the posting says it operates CNC machinery and measures finished steel structures).",
  "A fact restated about the wrong subject (run 4, Production Planner: \"involves supporting operations while a new manufacturing plant comes online\"; the posting says the position is temporarily based in NE San Antonio while the plant comes online).",
  "The same wrong subject again (run 5, Materials Supervisor: \"this role involves supporting a new manufacturing plant as it comes online\"; the posting says the position is temporarily based in NE San Antonio while the plant comes online).",
  "Growth or trend claims (run 5, Materials Supervisor: \"as you scale up\"). QA now rejects them unless the inputs use the same word, but a word like \"growth\" also appears in \"track record of growth\", so read the sentence.",
  "Discovery questions that stack plant-text nouns and can't be said aloud (run 5, Materials Supervisor: \"the movement of copper bus bar processing and electrical test equipment through the plant\").",
  "The Materials Supervisor location: the position is temporarily at the NE San Antonio site (run 3 said the plant moves).",
  "Characterizations the posting doesn't make: \"critical\", \"key\", \"urgent\" (runs 2 and 3).",
  "Plant-text equipment attributed to a role whose posting never mentions it (run 4, Equipment Operator: overhead cranes).",
  "Plant text blended into a posting fact (runs 5 and 6, CNC Machinist and Fitter I: \"overhead cranes or hoists\", where the posting says \"hoists or cranes\").",
  "Plant text put on the role as if the posting said it (run 6, Production Controller: \"monitoring work-in-progress across the different plant buildings\"; the posting names no plant buildings).",
  "A posting fact bent in restating it (run 7, Production Controller: \"mitigate risks to finished goods\"; the posting says risks to the on-time completion of finished goods).",
  "A duty tied to the plant buildings (run 7, Production Controller \"coordinating across the different plant buildings\", Planner \"managing workflows across several plant buildings\"; the plant text ties the buildings to building systems, and neither posting names buildings).",
  "A duty tied to a timeline or location the posting ties only to something else (run 6, Production Planner: \"coordinating schedules across fabrication, assembly, and shipping operations while the new manufacturing plant is coming online\"). QA can't catch these; list them separately.",
  "Questions that echo a stated posting fact instead of asking what it leaves open (run 8: Production Controller \"Does the position require 100% in-office presence in Fremont?\", Planner \"Will this role be based temporarily in NE San Antonio while the new manufacturing plant comes online?\").",
  "An opening or why_now whose only reason for calling is the job title (run 9, CNC Machinist opening: \"…saw you have been searching for a CNC Machinist for a while now. Are you still looking to add someone to the team?\").",
  "A why_now or opening that is still a template, or gives the job title as the reason for calling.",
];

// Sequential on purpose: Courier is shared with Job-Hopper and has no known rate limit.
// The review pass (report-only) runs when a stronger model's key is set; otherwise the result says it didn't run.
const results: (GenerationResult & { review: ReviewResult })[] = [];
for (const [signal, key] of targets) {
  const g = await generateIntelligence(signal, key, descriptions.get(signal.id) ?? null, employers.get(signal.id) ?? null);
  const r = { ...g, review: g.generation ? await reviewGeneration(g.inputs, g.generation) : ({ ok: false, error: "nothing generated" } as const) };
  results.push(r);
  const failed = r.verification ? Object.entries(r.verification.fields).filter(([, f]) => f.status === "fail").map(([n]) => n) : [];
  const nulls = r.verification ? Object.entries(r.verification.fields).filter(([, f]) => f.status === "null").map(([n]) => n) : [];
  console.log(`${r.ok ? (r.verification!.pass ? "PASS" : "QA FAIL") : "GEN FAIL"}  ${key} | ${r.roleTitle} | ${(r.latencyMs / 1000).toFixed(1)}s, ${r.attempts} attempt(s)${r.error ? ` | ${r.error}` : ""}${failed.length ? ` | failing: ${failed.join(", ")}` : ""}${nulls.length ? ` | null: ${nulls.join(", ")}` : ""}${r.invalidOutputs?.length ? ` | invalid JSON x${r.invalidOutputs.length}` : ""} | review: ${r.review.ok ? `${r.review.flags.length} flag(s)` : r.review.error}`);
}

const generated = results.filter((r) => r.ok);
const passed = generated.filter((r) => r.verification!.pass);
const fieldFails: Record<string, number> = {};
for (const r of generated) for (const [n, f] of Object.entries(r.verification!.fields)) if (f.status === "fail") fieldFails[n] = (fieldFails[n] ?? 0) + 1;
console.log(`\nleads: ${results.length} | generated: ${generated.length} | generation failures: ${results.length - generated.length} | QA pass: ${passed.length}/${generated.length} | QA fail: ${generated.length - passed.length}/${generated.length}`);
console.log(`failing fields across generated leads: ${JSON.stringify(fieldFails)}`);
console.log(`\nhand-check list:\n${HAND_CHECK.map((h) => `  - ${h}`).join("\n")}`);
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), handCheck: HAND_CHECK, results }, null, 2));
console.log(`staging output (no database writes): ${out}`);
