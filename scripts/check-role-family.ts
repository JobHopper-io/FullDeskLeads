// Run: npx tsx scripts/check-role-family.ts. Audit of the role -> family mapping (deriveJobTitleHints) for substring
// collisions: a keyword matching an unrelated role ("design" catching a sales title, "sales" catching Salesforce).
// REAL titles are from hiring_signals (346 distinct at the time of the audit, 2026-09-25); SYNTHETIC ones are collisions
// checked for that had no real instance. Every family is pinned so a future edit that moves a title shows up here.
import assert from "node:assert/strict";
import { roleFamily as f, type RoleFamily } from "../packages/pipeline/src/enrich/roleFamily.js";
import { deriveJobTitleHints } from "../packages/pipeline/src/enrich/roleFamily.js";

const cases: [RoleFamily | null, string[]][] = [
  // ── the collisions found in the real data, now fixed ──────────────────────
  ["sales", ["Design Consultant - Albert Lea, MN", "Sales Engineer", "Accounts Manager", "National Account Executive", "Power Solution Architect  - Strategic Accounts (Nationwide)"]],
  ["finance", ["Construction Accountant"]],
  [null, ["Senior Salesforce Administrator - Austin, TX ONLY", "Manufacturing Intelligence (MI)  Solutions Architect", "Manufacturing Intelligence (MI) Solutions Specialist I"]],
  // ── real titles that were right and must stay right ───────────────────────
  ["finance", ["Staff Accountant", "Accounts Payable Manager", "Accounts Payable Shared Services Senior Manager", "Accounting Intern", "Finance Internship"]],
  ["sales", ["Sales Consultant - Huntsville, AL", "Business Development Manager", "Direct Marketing Associate - Boston, MA", "Residential Marketing Associate - Albert Lea, MN", "Retail and Event Marketing Promoter - Des Moines, IA", "Inside Sales Center Agent - Louisville, KY"]],
  ["engineering", ["Engineering Manager", "Design Engineer", "Electrical Designer – Switchgear Designer", "Substation Designer", "Test Engineer - Electrical Systems", "Quality Engineer", "Estimation Engineer", "Director of Test Engineering"]],
  ["engineering", ["Quality Engineer - Customer Account Manager"]],   // a hybrid that is also an engineer keeps the engineering family
  ["production", ["Manufacturing Associate - Cottage Grove, MN - 2nd Shift", "Production Support Technician", "Production Planner/Scheduler", "Production Controller", "Electrical Production Assembler", "Production Welder II  - Night Shift"]],
  ["production", ["Manufacturing Engineer", "Senior Manufacturing Engineer", "Manufacturing Training Specialist"]],   // DEBATABLE, pinned as before: engineering or L&D could claim them
  ["maintenance", ["Maintenance Manager", "Facilities Technician 2nd shift", "Combination Welder - Maintenance", "Pipefitter - Maintenance", "Scaffold Builder - Maintenance", "Crane Operator - Maintenance", "Maintenance and Reliability Manager"]],
  ["warehouse", ["Warehouse Supervisor", "Materials Manager (Warehouse & Logistics)", "Warehouse Worker - MSS"]],
  ["construction", ["Construction Manager", "Assistant Superintendent", "Superintendent - Healthcare Construction", "Preconstruction Estimator", "Project Manager - Civil Construction", "M.E.P. Coordinator - Building Commissioning"]],
  ["machining", ["CNC Machinist", "Boilermaker A", "Welder A", "Submerged Arc Welder - Night Shift", "Operations Manager - Fabrication (Night Shift)", "Metal Fabrication Floor Lead"]],
  ["procurement", ["Buyer", "Senior Buyer", "Purchasing Supervisor"]],
  // "HR Generalist" and the recruiter title used to fall to the null bucket below (no HR family existed); the
  // domain-expansion scoping pass (2026-10-01) found office-role HR titles scattering across null/sales/engineering
  // at the new tech/HR sources and added this family so they land coherently instead.
  ["hr", ["HR Generalist", "Recruiter / Talent Acquisition Partner"]],
  // ── real titles with no family: the generic fallback. Coverage gaps, NOT collisions; pinned so a change is visible ──
  [null, ["Field Service Technician", "Window Installer - Boston, MA", "Project Manager", "Project Executive", "Foreman", "Estimator", "Quality Control Manager", "Forklift Operator I", "Shipping Technician",
    "IT Systems Administrator", "Sr. ERP Developer", "Custodian", "Brand Ambassador - Buffalo, NY", "Director of Operations", "Operations Supervisor", "Supply Chain Manager"]],
  // ── SYNTHETIC collisions checked for (no real instance today) ─────────────
  [null, ["Learning Facilitator", "Engine Rebuild Technician", "Salesforce Developer", "Financial Analyst", "Wholesale Assistant"]],
  ["sales", ["Sales Manager", "Account Executive", "Enterprise Accounts Director", "Key Account Manager", "Inside Sales Representative"]],
  ["finance", ["Cost Accountant - Manufacturing", "Accounts Receivable Specialist", "Finance Manager"]],
  ["maintenance", ["Facility Manager", "Facilities Coordinator"]],
  ["fleet", ["CDL Driver", "Class A CDL-A Truck Driver", "Transportation Coordinator"]],
];
for (const [want, titles] of cases) for (const t of titles) assert.equal(f(t), want, `${t}: expected ${want}, got ${f(t)}`);

// the hints themselves are unchanged per family, and the no-family fallback is the generic three
assert.deepEqual(deriveJobTitleHints("Sales Engineer"), ["Director of Business Development", "Sales Manager", "VP Sales"]);
assert.deepEqual(deriveJobTitleHints("Construction Accountant"), ["Controller", "Finance Director", "CFO"]);
assert.deepEqual(deriveJobTitleHints("Senior Salesforce Administrator"), ["Operations Manager", "General Manager", "HR Manager"]);
assert.deepEqual(deriveJobTitleHints("Welder"), ["Plant Manager", "Production Manager", "Operations Manager"]);
assert.deepEqual(deriveJobTitleHints("HR Generalist"), ["VP People", "Head of Talent Acquisition", "Director of Talent Acquisition"]);

// ── department as the primary signal (domain-expansion scoping pass, 2026-10-01) ──────────────────────────────────
// Real false positives found pulling postings from 17 tech/HR Greenhouse boards: the title regex (tuned on
// industrial titles) collided with ordinary tech-company vocabulary. Department, when the board sets one, is now
// checked first and is authoritative — the title is never consulted once a department resolves.
assert.equal(f("Senior Software Engineer, Build Loop", "Engineering"), "engineering", "title alone used to match \"construction\" on \"build\"");
assert.equal(f("Staff Software Engineer, Data Warehouse", "Engineering"), "engineering", "title alone used to match \"warehouse\"");
assert.equal(f("Production Designer", "Design"), null, "title alone used to match \"production\"; Design department means no trade family, not a guess");
assert.equal(f("Director, People Partners - Product, Design & Engineering", "People"), "hr", "title alone used to match \"engineering\" on the word in the title; department wins");
// A department the map doesn't recognize (a company's own numbered/internal code) isn't authoritative: falls through
// to the title exactly as before departments existed.
assert.equal(f("Welder", "8611 Security Analytics"), "machining");
assert.equal(f("Welder", undefined), "machining");
// No department at all: unchanged, title-only behavior (the manufacturing book's boards mostly don't set one).
assert.equal(f("Production Designer"), "production");
console.log("role family checks passed");
