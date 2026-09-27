// Run: npx tsx --env-file=.env scripts/check-job-details.ts [--examples] — asserts the extraction rules on synthetic
// text, then runs the extractor READ-ONLY over every stored raw payload and reports coverage by company.
// Nothing is written and no migration is needed: the extractor is a pure function of the stored payload.
import assert from "node:assert/strict";
import { createServiceClient } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import { extractJobDetails as x, postingText } from "../packages/sources/src/jobDetails.js";

const lever = (over: object) => ({ descriptionPlain: "", ...over });
const gh = (content: string, metadata: unknown[] = []) => ({ content, metadata });
const D = (t: string) => `<p>${t}</p>`.replace(/</g, "&lt;").replace(/>/g, "&gt;"); // Greenhouse HTML-escapes its content

// pay: structured wins, interval and currency as stated
assert.deepEqual(x("lever", "Welder", lever({ salaryRange: { min: 21, max: 28, currency: "USD", interval: "per-hour-wage" } })), { openingCount: null, shift: null, payMin: 21, payMax: 28, payInterval: "hour", payCurrency: "USD", payContext: null });
assert.equal(x("lever", "T", lever({ salaryRange: { min: 50000, max: 130000, currency: "CAD", interval: "per-year-salary" } })).payCurrency, "CAD");
assert.equal(x("lever", "T", lever({ salaryRange: { min: 5000, max: 6000, currency: "USD", interval: "per-month-salary" } })).payMin, null, "unrecognised interval: not usable");
assert.equal(x("lever", "T", lever({ salaryRange: { min: 20, max: 25, interval: "per-hour-wage" }, descriptionPlain: "earn $100,000 - $120,000 annually" })).payMax, 25, "structured beats text");
// pay: Greenhouse currency_range, 0-0 placeholder and $3-6 are absent, interval only from text stating the same range
const rng = (min: string, max: string, unit = "USD") => [{ value_type: "currency_range", value: { min_value: min, max_value: max, unit } }];
assert.equal(x("greenhouse", "T", gh("", rng("0.0", "0.0"))).payMin, null);
assert.equal(x("greenhouse", "T", gh("", rng("3.0", "6.0"))).payMin, null);
assert.deepEqual(x("greenhouse", "T", gh(D("Compensation ranges from $38.94 - 46.63/hr CAD"), rng("38.94", "46.63", "CAD"))), { openingCount: null, shift: null, payMin: 38.94, payMax: 46.63, payInterval: "hour", payCurrency: "CAD", payContext: null });
assert.equal(x("greenhouse", "T", gh(D("$100,000-$120,000 Position Summary"), rng("100000", "120000"))).payInterval, null, "never inferred from magnitude");
// pay: text fallback, only labelled-or-period and no earnings talk
assert.deepEqual(x("greenhouse", "T", gh(D("Salary Range: $106,000 - 132,000 Position Summary"))), { openingCount: null, shift: null, payMin: 106000, payMax: 132000, payInterval: null, payCurrency: null, payContext: null });
assert.equal(x("greenhouse", "T", gh(D("[Comp Range: $40k – $46k] Why join"))).payMax, 46000);
assert.deepEqual(x("greenhouse", "T", gh(D("Pay is $28.00 - $32.50/hr USD for this role"))).payInterval, "hour");
assert.equal(x("greenhouse", "T", gh(D("Successful candidates earn $70,000 – $85,000 per year"))).payMin, null, "earnings talk");
assert.equal(x("greenhouse", "T", gh(D("$20 - $25+/hr plus weekly commission"))).payMin, null, "commission");
assert.equal(x("greenhouse", "T", gh(D("Our founders raised $5 - $10 million"))).payMin, null, "no label/period");
assert.equal(x("greenhouse", "T", gh(D("Salary Range: $20 - $25 per hour. Range B: $60,000 - $70,000 per year"))).payMin, null, "two different ranges: ambiguous");
assert.equal(x("greenhouse", "T", gh(D("[Surrey Compensation Range: CAD 34.62/hr - 56.25/hr] [Jacksonville Compensation Range: $85,000 - 125,000]"))).payMin, null, "a labelled range we couldn't parse: which one is the posted pay?");
assert.equal(x("greenhouse", "T", gh(D("$50,000 - $60,000 HR Generalist"))).payMin, null, "bare HR is not per hour");
// opening count: explicit only
for (const [t, n] of [["We have 3 openings on the team", 3], ["two vacancies", 2], ["2 open positions", 2], ["4 positions available", 4]] as const) assert.equal(x("greenhouse", "T", gh(D(t))).openingCount, n, t);
for (const t of ["$120,000 Position Summary", "multiple openings", "an opening for a welder", "Over 100,000 positions filled", "We are hiring 5 people", "2027 openings"]) assert.equal(x("greenhouse", "T", gh(D(t))).openingCount, null, t);
// shift: title first; body only if exactly one
for (const [title, s] of [["Welder - Night Shift", "night"], ["Operations Manager (Second Shift)", "second"], ["Facilities Technician 2nd shift", "second"], ["Maintenance Technician I - Nights", "night"], ["Tech (Weekend Shift)", "weekend"], ["Assoc - 3rd shift", "third"]] as const) assert.equal(x("lever", title, lever({})).shift, s, title);
assert.equal(x("lever", "Supervisor", lever({ descriptionPlain: "First shift hours are 6:00am - 2:30pm." })).shift, "first");
assert.equal(x("lever", "Lead", lever({ descriptionPlain: "We run first shift, second shift and third shift." })).shift, null, "body names several");
assert.equal(x("lever", "Tech", lever({ descriptionPlain: "Must be available for day, night and weekend shifts." })).shift, null, "a list of shifts is not one shift");
assert.equal(x("lever", "Welder - Night Shift", lever({ descriptionPlain: "Some day shift coverage." })).shift, "night", "title wins");
assert.equal(x("lever", "Sales Associate", lever({ descriptionPlain: "Work a rotating schedule of days." })).shift, null);
// pay_context: Lever's salaryDescriptionPlain, verbatim and independent of the structured range; Greenhouse has none
const ctx = "Base Pay: Starting at $19/hour \nTarget Total Earnings: $78,000/year \nTop Performers Earn: $100,000–$120,000+ (uncapped commission)\n";
assert.equal(x("lever", "T", lever({ salaryDescriptionPlain: ctx, salaryRange: { min: 19, max: 32, currency: "USD", interval: "per-hour-wage" } })).payContext, ctx, "verbatim: no trimming, no edits");
assert.equal(x("lever", "T", lever({ salaryDescriptionPlain: ctx })).payMin, null, "context is never parsed into numbers");
assert.equal(x("lever", "T", lever({ salaryDescriptionPlain: "  \n" })).payContext, null, "blank is absent");
assert.equal(x("lever", "T", lever({})).payContext, null);
assert.equal(x("greenhouse", "T", { content: "", metadata: [], salaryDescriptionPlain: "x" }).payContext, null, "Greenhouse has no such field");
assert.equal(x("lever", "T", lever({ salaryDescriptionPlain: "$20/hour base", salaryRange: { min: 20, max: 20, currency: "CAD", interval: "per-hour-wage" } })).payCurrency, "CAD", "currency stored as the source gives it");
console.log("synthetic assertions ok\n");

// ── real data ──────────────────────────────────────────────────────────────────────────────────────────────
const db = createServiceClient(loadEnv());
type Row = { id: string; role_title: string; source: string; companies: { name: string }; raw_signals: { raw_payload: { rawPayload: unknown } } | null };
const rows: Row[] = [];
for (let from = 0; ; from += 100) {
  const { data, error } = await db.from("hiring_signals").select("id, role_title, source, companies(name), raw_signals(raw_payload)").range(from, from + 99);
  if (error) throw error;
  rows.push(...(data as unknown as Row[]));
  if (data.length < 100) break;
}
const results = rows.map((r) => ({ r, text: postingText(r.source, r.raw_signals!.raw_payload.rawPayload), d: x(r.source, r.role_title, r.raw_signals!.raw_payload.rawPayload) }));
const byCompany = new Map<string, typeof results>();
for (const e of results) byCompany.set(e.r.companies.name, [...(byCompany.get(e.r.companies.name) ?? []), e]);
// Text-only pay: a payMin with no structured range in the raw payload (Lever salaryRange / Greenhouse non-placeholder currency_range).
const hasStructured = (e: (typeof results)[number]) => {
  const raw = e.r.raw_signals!.raw_payload.rawPayload as { salaryRange?: unknown; metadata?: { value_type?: string; value?: { min_value?: string; max_value?: string } }[] };
  return e.r.source === "lever" ? !!raw.salaryRange : !!raw.metadata?.some((m) => m.value_type === "currency_range" && Number(m.value?.max_value) >= 7);
};
const pct = (n: number, t: number) => `${n}/${t} (${Math.round((100 * n) / t)}%)`;
const line = (label: string, es: typeof results) =>
  console.log(label.padEnd(36), "opening_count", pct(es.filter((e) => e.d.openingCount !== null).length, es.length).padEnd(13), "shift", pct(es.filter((e) => e.d.shift).length, es.length).padEnd(12), "pay", pct(es.filter((e) => e.d.payMin !== null).length, es.length).padEnd(13), "(text-only", pct(es.filter((e) => e.d.payMin !== null && !hasStructured(e)).length, es.length).padEnd(11), ") pay_interval", pct(es.filter((e) => e.d.payInterval).length, es.length).padEnd(12), "pay_currency", pct(es.filter((e) => e.d.payCurrency).length, es.length));
for (const [name, es] of byCompany) line(name, es);
line("ALL", results);

// pay_context: verbatim against the raw field for every signal, and per-company population.
const rawCtx = (e: (typeof results)[number]) => (e.r.raw_signals!.raw_payload.rawPayload as { salaryDescriptionPlain?: string }).salaryDescriptionPlain;
let verbatimMismatches = 0;
for (const e of results) {
  const raw = e.r.source === "lever" ? rawCtx(e) : undefined;
  const expected = typeof raw === "string" && raw.trim() !== "" ? raw : null;
  if (e.d.payContext !== expected) verbatimMismatches++;
}
console.log("\npay_context populated:", [...byCompany].map(([n, es]) => `${n.split(" ")[0]} ${es.filter((e) => e.d.payContext !== null).length}`).join(" | "), `| total ${results.filter((e) => e.d.payContext !== null).length}`, `| verbatim mismatches vs raw salaryDescriptionPlain across all ${results.length}: ${verbatimMismatches}`);
assert.equal(verbatimMismatches, 0);
if (process.argv.includes("--context")) {
  console.log("\n── the Andersen postings read by hand: structured pay next to pay_context (JSON.stringify shows the exact characters)");
  for (const t of ["Residential Marketing Associate  - Anchorage, Alaska", "Retail and Event Marketing Promoter - Des Moines, IA", "Sales Consultant - Greater Capital Region", "Part-Time Events Ambassador - Anchorage, AK"]) {
    const e = results.find((e) => e.r.role_title === t)!;
    console.log(`\n${t}\n  structured: ${e.d.payMin}-${e.d.payMax} ${e.d.payInterval ?? "?"} ${e.d.payCurrency ?? "?"}\n  raw salaryDescriptionPlain: ${JSON.stringify(rawCtx(e) ?? null)}\n  pay_context:                ${JSON.stringify(e.d.payContext)}\n  identical: ${e.d.payContext === (rawCtx(e) ?? null)}`);
  }
}

if (process.argv.includes("--examples")) {
  const around = (t: string, rx: RegExp, w = 90) => { const m = t.match(rx); return m ? `…${t.slice(Math.max(0, m.index! - w / 2), m.index! + w)}…` : "(no match)"; };
  const pick = (f: (e: (typeof results)[number]) => boolean, n: number) => results.filter(f).filter((e, i, a) => a.findIndex((o) => o.r.companies.name === e.r.companies.name && o.d.payMin === e.d.payMin) === i).slice(0, n);
  console.log("\n── pay examples (source → parsed)");
  for (const e of [...pick((e) => e.d.payMin !== null && e.r.source === "lever", 3), ...pick((e) => e.d.payMin !== null && e.r.source === "greenhouse", 4)]) {
    const raw = e.r.raw_signals!.raw_payload.rawPayload as { salaryRange?: unknown; metadata?: { value_type?: string; value?: unknown }[] };
    const structured = e.r.source === "lever" ? JSON.stringify(raw.salaryRange ?? null) : JSON.stringify(raw.metadata?.find((m) => m.value_type === "currency_range")?.value ?? null);
    console.log(`\n${e.r.companies.name} | ${e.r.role_title}\n  structured: ${structured}\n  text: ${around(e.text, /\$\s?\d/)}\n  parsed: ${JSON.stringify(e.d)}`);
  }
  console.log("\n── text-only pay (no usable structured field)");
  for (const e of results.filter((e) => e.d.payMin !== null && !hasStructured(e)))
    console.log(`\n${e.r.companies.name} | ${e.r.role_title}\n  text: ${around(e.text, /\$\s?\d/)}\n  parsed: ${JSON.stringify(e.d)}`);
  console.log("\n── shift examples");
  for (const e of results.filter((e) => e.d.shift).filter((e, i, a) => a.findIndex((o) => o.d.shift === e.d.shift && o.r.companies.name === e.r.companies.name && (o.r.role_title.match(/shift|night/i) ? 1 : 0) === (e.r.role_title.match(/shift|night/i) ? 1 : 0)) === i).slice(0, 5))
    console.log(`\n${e.r.companies.name} | title: ${e.r.role_title}\n  body: ${around(e.text, /shifts?\b/i)}\n  parsed shift: ${e.d.shift}`);
  console.log("\n── rejected on purpose (a $ range in the text that was NOT taken as pay)");
  for (const e of results.filter((e) => e.d.payMin === null && /\$\s?\d[\d,]*\s*[kK]?\s*(?:-|–|—|to)\s*\$?\s?\d/.test(e.text)).slice(0, 3))
    console.log(`\n${e.r.companies.name} | ${e.r.role_title}\n  text: ${around(e.text, /\$\s?\d[\d,]*\s*[kK]?\s*(?:-|–|—|to)/, 110)}\n  parsed: pay null`);
}
