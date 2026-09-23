// Run: npx tsx scripts/check-filter-patterns.ts — generic interest-list titles match, real roles don't.
import assert from "node:assert/strict";
import { matchInternalMobilityPattern as match } from "../packages/pipeline/src/filter/filter.js";

const generic = [
  "San Antonio Talent Community", "Talent Community", "Talent Network - Houston", "Talent Community (Austin, TX)",
  "Candidate Pool", "Dallas Candidate Pool", "General Application", "General Applications – Dallas",
];
const real = [
  "Talent Community Manager", "Talent Network Manager", "Candidate Pool Coordinator", "Director of Talent Community Engagement",
  "Recruiter / Talent Acquisition Partner", "General Foreman", "HR Generalist", "Talent Partner",
];
for (const t of generic) assert.ok(match(t), `should exclude: ${t}`);
for (const t of real) assert.equal(match(t), null, `should keep: ${t}`);
console.log("ok");
