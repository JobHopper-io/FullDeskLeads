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
  // ── real titles with no family: the generic fallback. Coverage gaps, NOT collisions; pinned so a change is visible ──
  [null, ["Field Service Technician", "Window Installer - Boston, MA", "Project Manager", "Project Executive", "Foreman", "Estimator", "Quality Control Manager", "Forklift Operator I", "Shipping Technician",
    "IT Systems Administrator", "Sr. ERP Developer", "HR Generalist", "Recruiter / Talent Acquisition Partner", "Custodian", "Brand Ambassador - Buffalo, NY", "Director of Operations", "Operations Supervisor", "Supply Chain Manager"]],
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
console.log("role family checks passed");
