import assert from "node:assert/strict";
import {
  assignPrimaryAndAlternates, buildTitleTargets, matchesCompany, selectCandidates, siteVsCorporate, tierOf,
} from "../packages/pipeline/src/enrich/multiContact.js";
import type { SearchContactResult } from "../packages/enrichment/src/index.js";

// Run: tsx scripts/check-multi-contact.ts   (no network, no database, spends nothing)
// Fixtures are real Seamless search responses captured 2026-09-25 (names/titles/domains/cities as returned).
const r = (id: string, name: string, title: string, domain: string, company: string, city: string, state: string, companyCity: string, companyState: string): SearchContactResult =>
  ({ searchResultId: id, name, title, domain, company, city, state, companyCity, companyState });

// ── titles ──────────────────────────────────────────────────────────────────
assert.deepEqual(buildTitleTargets(["Operations Manager", "General Manager", "HR Manager"]),
  ["Operations Manager", "General Manager", "HR Manager", "Plant Manager", "Human Resources Manager", "Talent Acquisition Manager"]); // case-insensitive dedupe, order kept
assert.equal(buildTitleTargets(["Maintenance Manager"]).length, 7);
assert.equal(tierOf("Plant Manager"), "site");
assert.equal(tierOf("Operations Manager"), "site");
assert.equal(tierOf("HR Manager"), "hr");
assert.equal(tierOf("Talent Acquisition Partner"), "hr");
assert.equal(tierOf("Maintenance Manager"), "function");
assert.equal(tierOf("Project Manager"), "function");
assert.equal(tierOf("Facilities Manager"), "function");

// ── crestoperations.com: real results were two OTHER companies ──────────────
const crest = [
  r("c1", "Mohammad Ghafar", "Maintenance Project Manager", "betaengineering.com", "Beta Engineering", "Amman", "Amman", "Pineville", "Louisiana"),
  r("c2", "Travis Rabalais", "Maintenance Manager", "millenniumgalvanizing.com", "Millennium Galvanizing", "Convent", "Louisiana", "Convent", "Louisiana"),
];
const crestSel = selectCandidates(crest, { domain: "crestoperations.com", companyName: "Crest Industries" });
assert.equal(crestSel.picked.length, 0);
assert.equal(crestSel.rejected.length, 2);
assert(crestSel.rejected[0].reason.includes("Beta Engineering"));

// ── iemfg.com: real results, in the order returned, incl. 2 on iem.com (a different company). The company NAME
// on those two ("IEM") is assumed: only their domain and titles were captured. ──
const iem = (id: string, n: string, t: string, city: string, st: string, dom = "iemfg.com", co = "Industrial Electric Mfg.") =>
  r(id, n, t, dom, co, city, st, dom === "iemfg.com" ? "Fremont" : "Morrisville", dom === "iemfg.com" ? "California" : "North Carolina");
const iemResults = [
  iem("i1", "Mike Sundstrom", "Plant Manager", "Fremont", "California"),
  iem("i2", "Tony Perreira", "Plant Manager", "Fremont", "California"),
  iem("i3", "Patrick Lau", "Plant Manager", "Langley", "British Columbia"),
  iem("i4", "Jose Betancourt", "Production Manager", "Miami", "Florida"),
  iem("i5", "Brian Poole", "Production lead-mechanical", "Jacksonville", "Florida"),
  iem("i6", "Keith Okoniewski", "Production Supervisor", "Coleman", "Michigan", "iem.com", "IEM"),
  iem("i7", "Eun Hee", "Scheduling and Production Control Supervisor", "Vancouver", "British Columbia"),
  iem("i8", "Doug Dickson", "Production Manager", "Pensacola", "Florida", "iem.com", "IEM"),
];
const iemSel = selectCandidates(iemResults, { domain: "iemfg.com", companyName: "Industrial Electric Manufacturing" });
assert.deepEqual(iemSel.rejected.map((x) => x.result.name), ["Keith Okoniewski", "Doug Dickson"]);       // the iem.com people are out
// one per tier first (function: Jose; site: Mike; hr: none available), then by rank: Tony, Patrick. Max 4.
assert.deepEqual(iemSel.picked.map((x) => x.name), ["Jose Betancourt", "Mike Sundstrom", "Tony Perreira", "Patrick Lau"]);
assert(matchesCompany(iemResults[0], { domain: "www.IEMFG.com", companyName: "x" }).ok);                  // domain compare ignores case and www.

// ── spawglass.com: real results were ten Project Managers — all one tier, so plain rank, capped at 4 ──
const sg = ["Michael Rapstine", "Seth Madison", "Parker Blaschke", "Matt Mazurek", "Daniel Ballin", "Justin Cox"]
  .map((n, i) => r(`s${i}`, n, i % 2 ? "Project Manager" : "Senior Project Manager", "spawglass.com", "SpawGlass", "Austin", "Texas", "Selma", "Texas"));
const sgSel = selectCandidates(sg, { domain: "spawglass.com", companyName: "SpawGlass" });
assert.deepEqual(sgSel.picked.map((x) => x.name), ["Michael Rapstine", "Seth Madison", "Parker Blaschke", "Matt Mazurek"]);
assert.equal(selectCandidates(sg, { domain: "spawglass.com", companyName: "SpawGlass" }, 2).picked.length, 2);

// ── SYNTHETIC (no real result had an HR title): the HR tier is reached ahead of lower-ranked repeats ──
const mix = [
  r("m1", "A", "Maintenance Manager", "acme.com", "Acme", "Tulsa", "Oklahoma", "Tulsa", "Oklahoma"),
  r("m2", "B", "Maintenance Supervisor", "acme.com", "Acme", "Tulsa", "Oklahoma", "Tulsa", "Oklahoma"),
  r("m3", "C", "Facilities Manager", "acme.com", "Acme", "Tulsa", "Oklahoma", "Tulsa", "Oklahoma"),
  r("m4", "D", "Plant Manager", "acme.com", "Acme", "Tulsa", "Oklahoma", "Tulsa", "Oklahoma"),
  r("m5", "E", "HR Manager", "acme.com", "Acme", "Tulsa", "Oklahoma", "Tulsa", "Oklahoma"),
];
assert.deepEqual(selectCandidates(mix, { domain: "acme.com", companyName: "Acme" }).picked.map((x) => x.name), ["A", "D", "E", "B"]);
assert.equal(selectCandidates([...mix, mix[0]], { domain: "acme.com", companyName: "Acme" }).picked.length, 4); // a repeated searchResultId never counts twice

// ── site vs corporate ───────────────────────────────────────────────────────
assert.equal(siteVsCorporate("Boerne", "Texas", "Selma", "Texas"), "site");          // SpawGlass contact vs Selma HQ (real)
assert.equal(siteVsCorporate("Fremont", "California", "Fremont", "California"), "corporate"); // IEM at HQ (real)
assert.equal(siteVsCorporate(" fremont ", "CALIFORNIA", "Fremont", "California"), "corporate"); // case/space-insensitive
assert.equal(siteVsCorporate("Springfield", "Illinois", "Springfield", "Missouri"), "site"); // same city name, different state
assert.equal(siteVsCorporate(null, "Texas", "Selma", "Texas"), null);                // missing = unknown, not guessed
assert.equal(siteVsCorporate("Austin", "Texas", "Selma", null), null);

// ── primary / alternates ────────────────────────────────────────────────────
const c = (id: string, conf: number) => ({ id, confidence_score: conf });
const a = assignPrimaryAndAlternates([c("x", 0.86), c("y", 0.99), c("z", 0.9), c("w", 0.9), c("v", 0.5)])!;
assert.equal(a.primary.id, "y");                                                       // highest confidence
assert.deepEqual(a.alternates.map((x) => x.id), ["z", "w", "x"]);                      // descending, ties keep input order, capped at 3
assert.deepEqual(assignPrimaryAndAlternates([c("only", 0.9)])!.alternates, []);        // single contact: no alternates, as today
assert.equal(assignPrimaryAndAlternates([]), null);

console.log("multi-contact checks passed");
