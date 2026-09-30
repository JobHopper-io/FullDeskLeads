// Run:
//   tsx --env-file=.env scripts/generate-intelligence.ts --out=<staging.json> [--ids=<hiring_signal_id,...>]
//     Generates for every emitted lead (or exactly those signals) and writes NOTHING to the database: every result, with
//     the exact inputs the model saw and its QA verdict, goes to --out for a hand check.
//   tsx --env-file=.env scripts/generate-intelligence.ts --write=<staging.json> [--hold=<hiring_signal_id,...>]
//     (--hold: QA passes the hand check rejected; they get the fixed content only, like a QA failure.)
//     Writes a hand-checked staging file to the leads, with no model call:
//       - every lead whose operating employer has an archetype gets the fixed content (never generated, so no QA gate):
//         role_intelligence = { discoveryQuestions } and objections = the spec set for that archetype;
//       - only a lead whose generated why_now and opening_script BOTH pass deterministic QA gets them, and, when
//         INTELLIGENCE_REVIEWER is set (review.ts), also that reviewer's pass, recorded in the staging file; its
//         generation_model_version records the model and the review ("review:gemma", or "review:qa_only" when off);
//       - anything else keeps its current value (the app's placeholder), untouched.
// A lead is in scope by its posting's operating employer (operatingEmployer; a Crest posting's Lever department), never
// by the parent company's name. A lead whose employer has no archetype (archetypeForEmployer) gets nothing.
import { readFileSync, writeFileSync } from "node:fs";
import { createServiceClient, leadRepository, type HiringSignalRow } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import { MODEL } from "../packages/pipeline/src/intelligence/courier.js";
import { generateIntelligence, type GenerationResult, type SourceKey } from "../packages/pipeline/src/intelligence/generate.js";
import { intelligenceReviewer, reviewGeneration, type ReviewResult } from "../packages/pipeline/src/intelligence/review.js";
import { COMPANY_SOURCES } from "../packages/pipeline/src/intelligence/sources.js";
import { operatingEmployer, postingText } from "../packages/sources/src/jobDetails.js";

const reviewer = intelligenceReviewer();
/** Recorded with every generated field written: which gates it passed. qa_only = deterministic QA, no reviewer. */
const MARKER = `courier:${MODEL}; review:${reviewer ?? "qa_only"}`;
const qaPassed = (r: Result) => r.ok && r.verification!.pass && r.generation!.why_now.text !== null && r.generation!.opening_script.text !== null;
/** Both gates: the deterministic QA and, when a reviewer is set, that same reviewer's pass. */
const cleared = (r: Result) => qaPassed(r) && (!reviewer || (r.review?.reviewer === reviewer && r.review.pass));
const logReview = (r: Result) => {
  const v = r.review;
  if (!v) return;
  console.log(`  review:${v.reviewer} ${v.pass ? "PASS" : "FAIL"}  ${r.roleTitle}${v.ok ? "" : ` | ${v.error}`}`);
  if (v.ok) for (const p of v.problems) console.log(`      ${p.field} ${p.rule}${p.quote ? ` "${p.quote}"${p.quoteFound ? "" : " (not in the text)"}` : ""}: ${p.reason}`);
};

type Result = GenerationResult & { leadId: string; company: string; employer: string | null; signalStatus: string; review: ReviewResult | null };
interface Staging { generatedAt: string; handCheck: string[]; results: Result[]; noArchetype: { leadId: string; company: string; employer: string | null; roleTitle: string }[] }

/** Courier's credit limit for the period (HTTP 429): every later call fails the same way, so the run stops there. */
const creditLimited = (error: string | null | undefined) => !!error?.startsWith("courier: HTTP 429");
const stopForCredit = (done: number, total: number, what: string) => {
  console.log(`\nSTOPPED at Courier's credit limit (HTTP 429): ${total - done} ${what} not attempted; the output holds only the ${done} above.`);
  process.exitCode = 1;
};

const db = createServiceClient(loadEnv());
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const writeFrom = arg("write");
if (writeFrom) {
  const staging = JSON.parse(readFileSync(writeFrom, "utf8")) as Staging;
  const hold = new Set(arg("hold")?.split(",").filter(Boolean));
  const unknown = [...hold].filter((id) => !staging.results.some((r) => r.hiringSignalId === id));
  if (unknown.length) throw new Error(`--hold: not in the staging file: ${unknown.join(", ")}`);
  const leads = leadRepository(db);
  let generated = 0;
  for (const r of staging.results) {
    const passed = cleared(r) && !hold.has(r.hiringSignalId);
    await leads.setIntelligence(r.leadId, {
      role_intelligence: { discoveryQuestions: r.discoveryQuestions.questions },
      objections: r.objections.pairs,
      ...(passed && { why_now: r.generation!.why_now.text, opening_script: r.generation!.opening_script.text, generation_model_version: MARKER }),
    });
    if (passed) generated++;
  }
  console.log(`written: fixed content on ${staging.results.length} lead(s); generated why_now + opening_script (${MARKER}) on ${generated}; QA passes the reviewer failed: ${staging.results.filter((r) => qaPassed(r) && !cleared(r)).length}; held by hand check: ${hold.size}; untouched: ${staging.noArchetype.length} with no archetype`);
  process.exit(0);
}

const out = arg("out");
if (!out) throw new Error("usage: generate-intelligence.ts --out=<staging.json> [--ids=...] | --write=<staging.json>");

const ids = arg("ids")?.split(",").filter(Boolean);

type Row = { id: string; hiring_signals: HiringSignalRow & { companies: { name: string }; raw_signals: { raw_payload: { rawPayload: unknown } } | null } };
const { data, error } = await db.from("leads").select("id, hiring_signals!inner(*, companies!inner(name), raw_signals(raw_payload))");
if (error) throw error;
const rows = (data as unknown as Row[]).filter((r) => !ids || ids.includes(r.hiring_signals.id));
if (ids && rows.length !== ids.length) throw new Error(`--ids: ${ids.length - rows.length} of them are not an emitted lead's signal`);

const keyFor = (employer: string | null) => (Object.keys(COMPANY_SOURCES) as SourceKey[]).find((k) => COMPANY_SOURCES[k].employer === employer) ?? null;
const inScope: [Row, SourceKey, string | null][] = [];
const noArchetype: Staging["noArchetype"] = [];
for (const r of rows) {
  const s = r.hiring_signals;
  const employer = operatingEmployer(s.companies.name, s.raw_signals?.raw_payload.rawPayload);
  const key = keyFor(employer);
  if (key) inScope.push([r, key, employer]);
  else noArchetype.push({ leadId: r.id, company: s.companies.name, employer, roleTitle: s.role_title.trim() });
}
console.log(`leads: ${rows.length} | with an archetype: ${inScope.length} | no archetype: ${noArchetype.length}\n`);

// Known ways Gemma has slipped past the deterministic QA. Every run's output is checked by hand against these.
const HAND_CHECK = [
  "A purpose or output the posting doesn't give the role (run 4, CNC Machinist: \"to produce steel structures\"; the posting says it operates CNC machinery and measures finished steel structures).",
  "A fact restated about the wrong subject (run 4, Production Planner: \"involves supporting operations while a new manufacturing plant comes online\"; the posting says the position is temporarily based in NE San Antonio while the plant comes online).",
  "The same wrong subject again (run 5, Materials Supervisor: \"this role involves supporting a new manufacturing plant as it comes online\"; the posting says the position is temporarily based in NE San Antonio while the plant comes online).",
  "Growth or trend claims (run 5, Materials Supervisor: \"as you scale up\"). QA now rejects them unless the inputs use the same word, but a word like \"growth\" also appears in \"track record of growth\", so read the sentence.",
  "The Materials Supervisor location: the position is temporarily at the NE San Antonio site (run 3 said the plant moves).",
  "Characterizations the posting doesn't make: \"critical\", \"key\", \"urgent\" (runs 2 and 3).",
  "Plant-text equipment attributed to a role whose posting never mentions it (run 4, Equipment Operator: overhead cranes).",
  "Plant text blended into a posting fact (runs 5 and 6, CNC Machinist and Fitter I: \"overhead cranes or hoists\", where the posting says \"hoists or cranes\").",
  "Plant text put on the role as if the posting said it (run 6, Production Controller: \"monitoring work-in-progress across the different plant buildings\"; the posting names no plant buildings).",
  "A posting fact bent in restating it (run 7, Production Controller: \"mitigate risks to finished goods\"; the posting says risks to the on-time completion of finished goods).",
  "A duty tied to the plant buildings (run 7, Production Controller \"coordinating across the different plant buildings\", Planner \"managing workflows across several plant buildings\"; the plant text ties the buildings to building systems, and neither posting names buildings).",
  "A duty tied to a timeline or location the posting ties only to something else (run 6, Production Planner: \"coordinating schedules across fabrication, assembly, and shipping operations while the new manufacturing plant is coming online\"). QA can't catch these; list them separately.",
  "An opening or why_now whose only reason for calling is the job title (run 9, CNC Machinist opening: \"…saw you have been searching for a CNC Machinist for a while now. Are you still looking to add someone to the team?\").",
  "A why_now or opening that is still a template, or gives the job title as the reason for calling.",
];

// Sequential on purpose: Courier is shared with Job-Hopper and has no known rate limit.
// The review pass runs only on a QA pass, and only when INTELLIGENCE_REVIEWER is set; it's a separate call either way.
const results: Result[] = [];
for (const [row, key, employer] of inScope) {
  const s = row.hiring_signals;
  const description = s.raw_signals ? postingText(s.source, s.raw_signals.raw_payload.rawPayload, true) : null;
  const g = await generateIntelligence(s, key, description, employer);
  const r: Result = { ...g, leadId: row.id, company: s.companies.name, employer, signalStatus: s.status, review: null };
  if (reviewer && qaPassed(r)) r.review = await reviewGeneration(reviewer, r.inputs, r.generation!);
  results.push(r);
  const failed = r.verification ? Object.entries(r.verification.fields).filter(([, f]) => f.status === "fail").map(([n]) => n) : [];
  const nulls = r.verification ? Object.entries(r.verification.fields).filter(([, f]) => f.status === "null").map(([n]) => n) : [];
  console.log(`${r.ok ? (r.verification!.pass && !nulls.length ? "PASS" : nulls.length && !failed.length ? "NULL" : "QA FAIL") : "GEN FAIL"}  ${employer} | ${r.roleTitle} | signal ${s.status} | ${(r.latencyMs / 1000).toFixed(1)}s${r.error ? ` | ${r.error}` : ""}${failed.length ? ` | failing: ${failed.join(", ")}` : ""}${nulls.length ? ` | null: ${nulls.join(", ")}` : ""}`);
  logReview(r);
  if (creditLimited(r.error) || creditLimited(r.review?.ok === false ? r.review.error : null)) { stopForCredit(results.length, inScope.length, "lead(s)"); break; }
}

const byEmployer: Record<string, { leads: number; genFail: number; qaPass: number; qaFail: number }> = {};
const byField: Record<string, Record<string, number>> = {};
for (const r of results) {
  const e = (byEmployer[r.employer ?? "?"] ??= { leads: 0, genFail: 0, qaPass: 0, qaFail: 0 });
  e.leads++;
  if (!r.ok) e.genFail++;
  else if (qaPassed(r)) e.qaPass++;
  else e.qaFail++;
  if (r.ok) for (const [n, f] of Object.entries(r.verification!.fields)) (byField[n] ??= {})[f.status] = (byField[n][f.status] ?? 0) + 1;
}
console.log(`\nby employer: ${JSON.stringify(byEmployer, null, 1)}`);
console.log(`by field (generated leads): ${JSON.stringify(byField)}`);
if (reviewer) console.log(`review:${reviewer}: ${results.filter(cleared).length} of ${results.filter(qaPassed).length} QA passes clear both gates`);
console.log(`no archetype (fixed content and generation both skipped): ${JSON.stringify(Object.entries(noArchetype.reduce<Record<string, number>>((t, n) => ((t[`${n.company} / ${n.employer}`] = (t[`${n.company} / ${n.employer}`] ?? 0) + 1), t), {})))}`);
writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), handCheck: HAND_CHECK, results, noArchetype } satisfies Staging, null, 2));
console.log(`\nstaging output (no database writes): ${out}\nhand-check list:\n${HAND_CHECK.map((h) => `  - ${h}`).join("\n")}`);
