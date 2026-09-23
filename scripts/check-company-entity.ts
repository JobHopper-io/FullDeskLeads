import assert from "node:assert/strict";
import { verifyCompanyEntity as v } from "../packages/enrichment/src/seamless/verifyCompanyEntity.js";

// Run: tsx scripts/check-company-entity.ts — the five real pairs from the coverage check.
const cases: [string, string, boolean][] = [
  ["Crest Industries", "Crest Industries", true],
  ["SpawGlass", "SpawGlass", true],
  ["Energy Steel & Supply Co.", "Energy Steel", true],
  ["Industrial Electric Manufacturing", "Industrial Electric Mfg.", true], // was 0.556, falsely rejected
  ["Andersen Corporation", "Emco Enterprises", false], // the confirmed wrong-company case must still fail
];
for (const [ours, theirs, expected] of cases) {
  const { matches, similarity } = v(ours, theirs);
  console.log(`${matches ? "PASS" : "REJECT"} ${similarity.toFixed(3)}  "${ours}" ~ "${theirs}"`);
  assert.equal(matches, expected, `${ours} vs ${theirs}`);
}
assert(v("Smith Bros.", "Smith Brothers").matches);
assert(v("Acme Corp.", "Acme Corporation").matches);
console.log("company entity checks passed");
