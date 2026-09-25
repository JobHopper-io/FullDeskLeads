import assert from "node:assert/strict";
import {
  assignPrimaryAndAlternates, buildTierTitles, humanKey, isPlausibleHr, isPlausibleSiteLead, matchesCompany, selectCandidates, tierOf, type ContactTier, type TieredResult,
} from "../packages/pipeline/src/enrich/multiContact.js";
import { distanceMiles, distanceToOpening, lookupPlace, parseLocation, siteVsCorporate } from "../packages/pipeline/src/enrich/geo.js";
import type { SearchContactResult } from "../packages/enrichment/src/index.js";

// Run: tsx scripts/check-multi-contact.ts   (no network, no database, spends nothing)
// Marked REAL: values captured from real Seamless responses / the real run (2026-09-25). Marked SYNTHETIC: constructed to
// exercise a rule, because the raw per-tier search results were not kept and can't be replayed without spending credits.
const r = (id: string, name: string, title: string, domain: string, company: string, city: string, state: string, companyCity: string, companyState: string): SearchContactResult =>
  ({ searchResultId: id, name, title, domain, company, city, state, companyCity, companyState });
const tiered = (rs: SearchContactResult[], tier: ContactTier): TieredResult[] => rs.map((x) => ({ ...x, tier }));

// ── one search per tier: what each tier searches for ────────────────────────
const maint = buildTierTitles(["Maintenance Manager", "Maintenance Supervisor", "Facilities Manager"]);
assert.deepEqual(maint.function, ["Maintenance Manager", "Maintenance Supervisor", "Facilities Manager"]);
assert.deepEqual(maint.site, ["Plant Manager", "Operations Manager", "General Manager"]);
assert.deepEqual(maint.hr, ["HR Manager", "Human Resources Manager", "Talent Acquisition Manager"]);
// the production family lists "Plant Manager", which is a site-lead title: it's not searched twice
assert.deepEqual(buildTierTitles(["Production Manager", "Production Supervisor", "Plant Manager"]).function, ["Production Manager", "Production Supervisor"]);
assert.deepEqual(buildTierTitles(["plant manager", "Plant Manager", "Maintenance Manager"]).function, ["Maintenance Manager"]);
// a role with no family of its own (the generic fallback) has no function tier, so no function search is paid for
assert.deepEqual(buildTierTitles([]).function, []);

// ── entity filter: REAL Crest results, Crest's nine aliases (migration 0025) ─
const crest = [
  r("c1", "Mohammad Ghafar", "Maintenance Project Manager", "betaengineering.com", "Beta Engineering", "Amman", "Amman", "Pineville", "Louisiana"),
  r("c2", "Travis Rabalais", "Maintenance Manager", "millenniumgalvanizing.com", "Millennium Galvanizing", "Convent", "Louisiana", "Convent", "Louisiana"),
];
const CREST_ALIASES = ["DIS-TRAN Steel", "DIS-TRAN Packaged Substations", "Crest Natural Resources", "Crest Operations", "Crest Properties", "Beta Engineering", "Mid-State Supply", "Millennium Galvanizing", "Avant Organics"];
const crestId = { domain: "crestoperations.com", companyName: "Crest Industries", aliases: CREST_ALIASES };
assert.equal(selectCandidates(tiered(crest, "function"), { ...crestId, aliases: [] }).picked.length, 0);   // without aliases: falsely rejected
const cs = selectCandidates(tiered(crest, "function"), crestId);
assert.deepEqual(cs.picked.map((x) => x.name), ["Mohammad Ghafar", "Travis Rabalais"]);
assert(matchesCompany(crest[0], crestId).ok && (matchesCompany(crest[0], crestId) as { by: string }).by === "alias");
for (const company of ["Migues Deloach", "IEM", "AireSpring", "Andersen Windows"]) {
  assert(!matchesCompany(r("t", "T", "Plant Manager", "x.com", company, "a", "b", "c", "d"), crestId).ok, `${company} must not match Crest`);
}

// ── REAL: Gerald Laming, "Renewal by Andersen" (renewalbyandersen.com), dropped x3 in the run at similarity 0.45 ──
const laming = r("a1", "Gerald Laming", "Regional Sales Manager", "renewalbyandersen.com", "Renewal by Andersen", "Cottage Grove", "Minnesota", "Cottage Grove", "Minnesota");
const andersen = { domain: "andersencorp.com", companyName: "Andersen Corporation" };
const before = matchesCompany(laming, andersen);
assert(!before.ok && before.reason.includes("0.45"), "without the alias: rejected at 0.45, as in the real run");
const after = matchesCompany(laming, { ...andersen, aliases: ["Renewal by Andersen"] });   // migration 0026
assert(after.ok && after.by === "alias" && after.matched === "Renewal by Andersen");
assert(!matchesCompany(r("t", "T", "x", "x.com", "Migues Deloach", "a", "b", "c", "d"), { ...andersen, aliases: ["Renewal by Andersen"] }).ok); // the alias opens nothing else

// ── tiered selection (SYNTHETIC per-tier results) ───────────────────────────
const acme = (id: string, name: string, title: string) => r(id, name, title, "acme.com", "Acme", "Tulsa", "Oklahoma", "Tulsa", "Oklahoma");
const ours = { domain: "acme.com", companyName: "Acme" };
const fn = tiered([acme("f1", "F1", "Maintenance Manager"), acme("f2", "F2", "Maintenance Supervisor"), acme("f3", "F3", "Facilities Manager")], "function");
const site = tiered([acme("s1", "S1", "Plant Manager"), acme("s2", "S2", "General Manager")], "site");
const hr = tiered([acme("h1", "H1", "HR Manager"), acme("h2", "H2", "Talent Manager")], "hr");
// one per tier first (F1, S1, H1), then the 4th slot goes to the best tier with anyone left (function): F2
assert.deepEqual(selectCandidates([...fn, ...site, ...hr], ours).picked.map((x) => x.name), ["F1", "S1", "H1", "F2"]);
// no function tier at all (a role with no family): site, HR, then site again
assert.deepEqual(selectCandidates([...site, ...hr], ours).picked.map((x) => x.name), ["S1", "H1", "S2", "H2"]);
// the function search found nobody: still 4 from the other tiers, never empty-handed
assert.equal(selectCandidates([...tiered([], "function"), ...site, ...hr], ours).picked.length, 4);
// the same person found by two searches keeps the earlier (better) tier and counts once
const dup = selectCandidates([...fn, ...tiered([acme("f1", "F1", "Maintenance Manager")], "site"), ...hr], ours);
assert.equal(dup.picked.filter((x) => x.name === "F1").length, 1);
assert.equal(dup.picked.find((x) => x.name === "F1")!.tier, "function");
assert.equal(selectCandidates([...fn, ...site, ...hr], ours, 2).picked.length, 2);
// other companies' people are dropped from every tier
const stray = tiered([r("z1", "Z", "Plant Manager", "other.com", "Other Co", "a", "b", "c", "d")], "site");
assert.equal(selectCandidates([...stray, ...site], ours).rejected.length, 1);

// ── site tier: a plausible plant/site lead, not any department's own "operations" ────────────────────────────
// REAL titles from the 8-signal run that were wrongly promoted, and real ones that were fine:
for (const t of ["Information Technology Operations Manager", "Legal Operations Manager", "IT Manager - Infrastructure & Operations Platform Engineering", "Senior Manager Infrastructure Operations"]) {
  assert(!isPlausibleSiteLead(t), `${t} is not a site lead`);
}
for (const t of ["Plant Manager", "Senior Vice President and General Manager", "Vice President & General Manager, Andersen Division", "Vice President and General Manager - Western Operations"]) {
  assert(isPlausibleSiteLead(t), `${t} is a site lead`);
}
// SYNTHETIC: other real-world shapes. Departments' own operations roles are out...
for (const t of ["Finance Operations Manager", "HR Operations Manager", "Sales Operations Manager", "Marketing Operations Manager", "Business Operations Manager", "Customer Operations Manager",
  "Supply Chain Operations Manager", "Operations Manager, IT", "Software Operations Manager", "Security Operations Manager", "Accounting Operations Manager", "Quality Operations Manager", "Director of IT Operations", "VP of Legal Operations", "Talent Operations Manager"]) {
  assert(!isPlausibleSiteLead(t), `${t} must not be a site lead`);
}
// ...and operating roles are in, whatever their prefix
for (const t of ["Operations Manager", "Regional Operations Manager", "Manufacturing Operations Manager", "Production Operations Manager", "Site Operations Manager", "Director of Operations", "Operations Director",
  "Head of Operations", "VP of Operations", "Vice President, Operations", "Chief Operating Officer", "COO", "Site Manager", "Plant Director", "General Manager"]) {
  assert(isPlausibleSiteLead(t), `${t} should be a site lead`);
}
// in selection: the IT and Legal ops managers the site search returned are dropped and NOT replaced by anyone unfit
const crestSite = tiered([acme("s1", "Matthew Phillips", "Information Technology Operations Manager"), acme("s2", "Emily Baum", "Legal Operations Manager"), acme("s3", "Real Plant Mgr", "Plant Manager")], "site");
const sel = selectCandidates([...crestSite, ...hr], ours);
assert.deepEqual(sel.picked.map((x) => x.name), ["Real Plant Mgr", "H1", "H2"]);
assert.deepEqual(sel.rejected.map((x) => x.result.name), ["Matthew Phillips", "Emily Baum"]);
assert(sel.rejected[0].reason.startsWith("not a plausible site lead"));
// with no real site lead at all, the tier is simply empty and the slots go to the next tier, never to the IT/Legal people
assert.deepEqual(selectCandidates([...tiered(crestSite.slice(0, 2), "site"), ...hr], ours).picked.map((x) => x.name), ["H1", "H2"]);
// the same title from the FUNCTION search is unaffected (that filter is for the site tier only)
assert.equal(selectCandidates(tiered([acme("q1", "Q", "Legal Operations Manager")], "function"), ours).picked.length, 1);

// ── HR tier: an HR / talent contact, not another department using an HR word ─────────────────────────────
// REAL titles: "talent" matched a marketing manager (Gerald Laming) and it landed in the HR tier.
assert(!isPlausibleHr("Marketing Manager - National Talent Marketing"));
assert.equal(tierOf("Marketing Manager - National Talent Marketing"), "other");
for (const t of ["Human Resources Manager", "Talent Manager", "Talent Acquisition Manager - Operations"]) assert(isPlausibleHr(t), `${t} is HR`);
// SYNTHETIC
for (const t of ["HR Manager", "Director of Talent", "Recruiting Manager", "Corporate Recruiter", "VP, People & Culture", "HR Operations Manager", "Talent Acquisition Partner"]) assert(isPlausibleHr(t), `${t} is HR`);
for (const t of ["Talent Marketing Manager", "Recruitment Marketing Director", "Sales Recruiter Training Lead", "Brand and Talent Communications Manager", "IT Talent Program Manager", "Engineering Recruiter Enablement Lead"]) assert(!isPlausibleHr(t), `${t} is not HR`);
assert(!isPlausibleHr("Accounting/HR Manager"));          // a real mixed role, left out on purpose (conservative); documented in multiContact.ts
assert.equal(tierOf("HR Operations Manager"), "hr");       // HR wins over the site-lead reading of "Operations Manager"
// in selection: the marketing "talent" person is dropped from the HR tier and not replaced by anyone unfit
const hrMix = tiered([acme("h9", "Gerald Laming", "Marketing Manager - National Talent Marketing"), acme("h8", "Real HR", "Human Resources Manager")], "hr");
const hrSel = selectCandidates(hrMix, ours);
assert.deepEqual(hrSel.picked.map((x) => x.name), ["Real HR"]);
assert(hrSel.rejected[0].reason.startsWith("not a plausible HR contact"));

// ── one human, two Seamless records (REAL: Madeline M Steepleton on two signals in the 2026-09-25 re-run) ──
assert.equal(humanKey("Madeline M Steepleton", "318.446.6031"), humanKey(" madeline  m steepleton", "(318) 446-6031"));
assert.notEqual(humanKey("Madeline M Steepleton", "318.446.6031"), humanKey("Sarah Ceballos", "318.446.6031"));   // same phone, different person
assert.notEqual(humanKey("Sarah Ceballos", "318.446.6031"), humanKey("Sarah Ceballos", "318.446.6099"));         // same name, different person

// ── primary = highest confidence within the best available tier ─────────────
const c = (id: string, conf: number, title: string, tier: ContactTier | null) => ({ id, confidence_score: conf, title, tier });
// function beats a higher-confidence site or HR person
let a = assignPrimaryAndAlternates([c("hr", 0.99, "HR Manager", "hr"), c("site", 0.98, "Plant Manager", "site"), c("fn", 0.9, "Maintenance Manager", "function")])!;
assert.equal(a.primary.id, "fn");
assert.deepEqual(a.alternates.map((x) => x.id), ["hr", "site"]);           // alternates: descending confidence, as before
// no function tier: the best is site lead, even under a higher-confidence HR person (the real Crest case: Sarah Ceballos 0.99 was HR)
a = assignPrimaryAndAlternates([c("sarah", 0.99, "Human Resources Manager", "hr"), c("matt", 0.98, "Operations Manager", "site"), c("mad", 0.92, "Talent Manager", "hr"), c("emily", 0.92, "Operations Manager", "site")])!;
assert.equal(a.primary.id, "matt");
// within the best tier the highest confidence wins, ties keep input order
assert.equal(assignPrimaryAndAlternates([c("x", 0.9, "Maintenance Manager", "function"), c("y", 0.95, "Facilities Manager", "function"), c("z", 0.95, "Maintenance Supervisor", "function")])!.primary.id, "y");
// only HR available: HR
assert.equal(assignPrimaryAndAlternates([c("h", 0.7, "HR Manager", "hr")])!.primary.id, "h");
// the stored tier beats the title guess, and a missing tier falls back to the guess
assert.equal(assignPrimaryAndAlternates([c("a", 0.9, "Operations Manager", "function"), c("b", 0.99, "Plant Manager", "site")])!.primary.id, "a");
// a missing tier falls back to the conservative guess: a plausible site lead is 'site', HR is 'hr', anything else is 'other' and ranks last
assert.equal(assignPrimaryAndAlternates([c("a", 0.99, "Maintenance Manager", null), c("b", 0.9, "Plant Manager", null)])!.primary.id, "b");
assert.equal(assignPrimaryAndAlternates([c("a", 0.7, "Plant Manager", null), c("b", 0.99, "Human Resources Manager", null)])!.primary.id, "a");
assert.equal(assignPrimaryAndAlternates([c("a", 0.99, "Information Technology Operations Manager", null), c("b", 0.5, "HR Manager", null)])!.primary.id, "b"); // an IT ops manager is 'other', below HR
assert.equal(assignPrimaryAndAlternates([c("a", 0.9, "Maintenance Manager", null), c("b", 0.99, "Legal Operations Manager", null)])!.primary.id, "b"); // all 'other': plain highest confidence, as before tiers
assert.equal(tierOf("HR Manager"), "hr");
assert.equal(tierOf("Plant Manager"), "site");
assert.equal(tierOf("Legal Operations Manager"), "other");
// alternates capped at 3; a single contact gives none, as today; none gives null
assert.equal(assignPrimaryAndAlternates([1, 2, 3, 4, 5, 6].map((i) => c(`p${i}`, 0.9 - i / 100, "Maintenance Manager", "function")))!.alternates.length, 3);
assert.deepEqual(assignPrimaryAndAlternates([c("only", 0.9, "Maintenance Manager", "function")])!.alternates, []);
assert.equal(assignPrimaryAndAlternates([]), null);

// ── site vs corporate: real distance ────────────────────────────────────────
const mi = (c1: string, s1: string, c2: string, s2: string) => distanceMiles(lookupPlace(c1, s1)!, lookupPlace(c2, s2)!);
const near = (x: number, want: number, tol: number) => assert(Math.abs(x - want) <= tol, `${x} not within ${tol} of ${want}`);
near(mi("Alexandria", "Louisiana", "Pineville", "Louisiana"), 5.0, 0.5);        // the confirmed real case: one metro
near(mi("Stillwater", "Minnesota", "Bayport", "Minnesota"), 3.9, 0.5);
near(mi("Cottage Grove", "Minnesota", "Bayport", "Minnesota"), 15.4, 0.5);
near(mi("Minneapolis", "Minnesota", "Bayport", "Minnesota"), 24.2, 0.5);        // just inside 25: threshold-sensitive
near(mi("Austin", "Texas", "Selma", "Texas"), 59.6, 1);
near(mi("Houston", "Texas", "Pineville", "Louisiana"), 207.4, 2);               // across a state line
assert.equal(lookupPlace("Alexandria", "LA")?.lat, lookupPlace("alexandria", "Louisiana")?.lat);   // state name or abbreviation, any case
assert.deepEqual(lookupPlace("St. Paul", "Minnesota"), lookupPlace("Saint Paul", "MN"));           // St. == Saint
assert.equal(lookupPlace("Alexandria", "Minnesota")!.lat.toFixed(1), "45.9");                       // same name, other state: not confused
assert.equal(lookupPlace("Langley", "British Columbia"), null);                                     // non-US: unlocatable
assert.equal(siteVsCorporate("Alexandria", "Louisiana", "Pineville", "Louisiana"), "corporate");    // was 'site' under exact comparison
assert.equal(siteVsCorporate("Pineville", "Louisiana", "Pineville", "Louisiana"), "corporate");
assert.equal(siteVsCorporate("Stillwater", "Minnesota", "Bayport", "Minnesota"), "corporate");
assert.equal(siteVsCorporate("Austin", "Texas", "Selma", "Texas"), "site");                          // same state, 60 miles: still 'site' (a same-state rule would say corporate)
assert.equal(siteVsCorporate("Houston", "Texas", "Pineville", "Louisiana"), "site");
assert.equal(siteVsCorporate("Minneapolis", "Minnesota", "Bayport", "Minnesota"), "corporate");
assert.equal(siteVsCorporate("Minneapolis", "Minnesota", "Bayport", "Minnesota", 20), "site");       // the radius is a parameter
assert.equal(siteVsCorporate("Langley", "British Columbia", "Fremont", "California"), "site");        // unlocatable: exact-comparison fallback
assert.equal(siteVsCorporate("Amman", "Amman", "Pineville", "Louisiana"), "site");
assert.equal(siteVsCorporate(" fremont ", "CALIFORNIA", "Fremont", "California"), "corporate");
assert.equal(siteVsCorporate(null, "Texas", "Selma", "Texas"), null);                                // missing = unknown, never guessed
assert.equal(siteVsCorporate("Austin", "Texas", "Selma", null), null);

// ── the opening's own location ──────────────────────────────────────────────
// REAL shapes from hiring_signals.location (127 distinct strings across 421 signals):
assert.deepEqual(parseLocation("Port Lavaca, Texas"), [{ city: "Port Lavaca", state: "Texas" }]);
assert.deepEqual(parseLocation("Buffalo, NY"), [{ city: "Buffalo", state: "NY" }]);
assert.deepEqual(parseLocation("Jacksonville, Florida, United States"), [{ city: "Jacksonville", state: "Florida" }]);
assert.deepEqual(parseLocation("Cottage Grove, Minnesota"), [{ city: "Cottage Grove", state: "Minnesota" }]);
assert.deepEqual(parseLocation("Dallas, Texas, United States; Plano, Texas, United States"), [{ city: "Dallas", state: "Texas" }, { city: "Plano", state: "Texas" }]);
assert.deepEqual(parseLocation("Illinois, USA; Michigan, USA; Plano, Texas, United States; United States"), [{ city: "Plano", state: "Texas" }]); // state-only parts don't count
assert.deepEqual(parseLocation("Jacksonville, Florida, United States; Surrey, British Columbia, Canada"), [{ city: "Jacksonville", state: "Florida" }]); // Canada: not a US state
assert.deepEqual(parseLocation("Charleston, WV 25301"), [{ city: "Charleston", state: "WV" }]);                                                       // zip stripped
for (const none of ["United States", "US - Remote", "Texas", "Texas; US - Remote", "Victoria", "Arizona; Oregon", "Northwest LA & Northeast TX", "", null, undefined]) {
  assert.deepEqual(parseLocation(none as string), [], `no usable place in ${JSON.stringify(none)}`);
}
near(distanceToOpening("Cottage Grove", "Minnesota", "Cottage Grove, Minnesota")!, 0, 0);     // the real Andersen case: a supervisor AT the opening
assert(distanceToOpening("San Antonio", "Texas", "Cottage Grove, Minnesota")! > 1000);          // the director in Texas, far from the Minnesota opening
near(distanceToOpening("Geismar", "Louisiana", "Geismar, Louisiana")!, 0, 0);                   // unlocatable place, but a name match: still 0
near(distanceToOpening("Buffalo", "New York", "Buffalo, NY")!, 0, 0);                            // "NY" and "New York" are the same state
near(distanceToOpening("Plano", "Texas", "Dallas, Texas, United States; Plano, Texas, United States")!, 0, 0);
near(distanceToOpening("Fort Worth", "Texas", "Dallas, Texas, United States; Plano, Texas, United States")!, 30, 5);  // nearest of several
assert.equal(distanceToOpening("Austin", "Texas", "United States"), null);                       // opening has no usable place
assert.equal(distanceToOpening("Austin", "Texas", null), null);
assert.equal(distanceToOpening(null, "Texas", "Dallas, Texas"), null);                           // contact has no city
assert.equal(distanceToOpening("Langley", "British Columbia", "Dallas, Texas"), null);           // unlocatable, no name match

// ── primary: best tier, then near the opening, then highest confidence ──────
const L = (id: string, conf: number, title: string, tier: ContactTier, city: string, state: string) => ({ ...c(id, conf, title, tier), contact_city: city, contact_state: state });
// REAL: Andersen "Manufacturing Associate", Cottage Grove MN. The Texas director (0.90) used to win on confidence; the supervisor AT the opening (0.89) now does.
let g = assignPrimaryAndAlternates([
  L("lamar", 0.99, "Senior Vice President and General Manager", "site", "Minneapolis", "Minnesota"),
  L("jack", 0.9, "Director of Production - Central Texas", "function", "San Antonio", "Texas"),
  L("alex", 0.89, "Production Supervisor", "function", "Cottage Grove", "Minnesota"),
], "Cottage Grove, Minnesota")!;
assert.equal(g.primary.id, "alex"); assert(g.nearOpening);
// ...and without a usable opening location it's the old tier-first rule, so Jack
assert.equal(assignPrimaryAndAlternates([L("jack", 0.9, "x", "function", "San Antonio", "Texas"), L("alex", 0.89, "x", "function", "Cottage Grove", "Minnesota")], "United States")!.primary.id, "jack");
assert.equal(assignPrimaryAndAlternates([L("jack", 0.9, "x", "function", "San Antonio", "Texas"), L("alex", 0.89, "x", "function", "Cottage Grove", "Minnesota")])!.primary.id, "jack");
// REAL, must NOT regress: IEM, opening in Jacksonville FL, both function contacts in San Francisco: none near, so highest confidence: Greg Yurich
g = assignPrimaryAndAlternates([
  L("greg", 0.99, "Senior Facilities Manager", "function", "San Francisco", "California"),
  L("jeremy", 0.91, "Maintenance Manager", "function", "San Francisco", "California"),
  L("mike", 0.96, "Plant Manager", "site", "Fremont", "California"),
], "Jacksonville, Florida, United States")!;
assert.equal(g.primary.id, "greg"); assert(!g.nearOpening);
// REAL, must NOT regress: Crest maintenance welder, Port Lavaca TX: the only function-tier contact is Travis Rabalais (Convent LA, far): still primary over HR Sarah 0.99
g = assignPrimaryAndAlternates([
  L("sarah", 0.99, "Human Resources Manager", "hr", "Alexandria", "Louisiana"),
  L("travis", 0.86, "Maintenance Manager", "function", "Convent", "Louisiana"),
], "Port Lavaca, Texas")!;
assert.equal(g.primary.id, "travis"); assert(!g.nearOpening);
// location never crosses tiers: an HR person at the opening does not beat a far function manager
assert.equal(assignPrimaryAndAlternates([L("hr", 0.99, "HR Manager", "hr", "Cottage Grove", "Minnesota"), L("fn", 0.8, "Maintenance Manager", "function", "Tulsa", "Oklahoma")], "Cottage Grove, Minnesota")!.primary.id, "fn");
// several near: highest confidence among the near ones; a far higher-confidence one loses
assert.equal(assignPrimaryAndAlternates([L("far", 0.99, "x", "function", "Houston", "Texas"), L("n1", 0.9, "x", "function", "Dallas", "Texas"), L("n2", 0.95, "x", "function", "Plano", "Texas")], "Dallas, Texas")!.primary.id, "n2");
// near means within the metro radius (25 miles): Austin is ~60 from Selma, San Antonio ~15
assert.equal(assignPrimaryAndAlternates([L("austin", 0.99, "x", "function", "Austin", "Texas"), L("sa", 0.9, "x", "function", "San Antonio", "Texas")], "Selma, Texas")!.primary.id, "sa");
// a contact with no location data never blocks a located one, and never wins by location
assert.equal(assignPrimaryAndAlternates([{ ...c("blank", 0.99, "x", "function") }, L("near", 0.5, "x", "function", "Dallas", "Texas")], "Dallas, Texas")!.primary.id, "near");
assert.equal(assignPrimaryAndAlternates([{ ...c("blank", 0.99, "x", "function") }, L("far", 0.5, "x", "function", "Boston", "Massachusetts")], "Dallas, Texas")!.primary.id, "blank");
// alternates keep descending confidence, unchanged
assert.deepEqual(g.alternates.map((x) => x.id), ["sarah"]);

console.log("multi-contact checks passed");
