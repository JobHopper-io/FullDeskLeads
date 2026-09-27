// Run: npx tsx --env-file=.env scripts/check-staffing-filter.ts — asserts the staffing-firm name rule on synthetic
// names, then applies it read-only to every real hiring_signal (nothing is written) and reports what it would exclude.
import assert from "node:assert/strict";
import { createServiceClient } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import { matchStaffingFirmName as match } from "../packages/pipeline/src/filter/filter.js";

for (const n of ["Acme Staffing", "Robert Half Personnel Services", "Apex Recruiting Group", "Smith Executive Search Firm", "Bright Talent Solutions LLC", "TALENT SOLUTION Partners", "Kforce Recruitment"])
  assert.ok(match(n), `should exclude: ${n}`);
for (const n of ["Crest Industries", "Andersen Corporation", "SpawGlass", "Energy Steel & Supply Co.", "Industrial Electric Manufacturing", "Personnelle Bakery", "Researching Inc", "Staffordshire Foods", "Recruitmentality"])
  assert.equal(match(n), null, `should keep: ${n}`);

const db = createServiceClient(loadEnv());
const { data, error } = await db.from("hiring_signals").select("id, status, role_title, companies(name)");
if (error) throw error;
const hits = data.filter((h) => match((h.companies as unknown as { name: string }).name));
console.log(`synthetic assertions ok | real hiring_signals checked: ${data.length} | newly excluded by staffing rule: ${hits.length}`);
for (const h of hits) { const name = (h.companies as unknown as { name: string }).name; console.log(`  ${name} | ${h.role_title} | staffing-firm: matches "${match(name)}" (currently ${h.status})`); }
const byCompany = new Map<string, number>();
for (const h of data) { const n = (h.companies as unknown as { name: string }).name; byCompany.set(n, (byCompany.get(n) ?? 0) + 1); }
console.log("companies checked:", [...byCompany].map(([n, c]) => `${n} (${c})`).join(", "));
