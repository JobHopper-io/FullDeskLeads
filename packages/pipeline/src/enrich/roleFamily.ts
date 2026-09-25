// Which role family an opening belongs to, by keyword on its title. Pure, so every rule can be checked directly
// against real titles (scripts/check-role-family.ts).
//
// The original version used `title.includes("design")` and friends. A bare substring matches unrelated roles, and
// the first branch that matches wins, so real titles went to the wrong family:
//   "Design Consultant" (a window sales role)         matched "design"   -> engineering managers
//   "Sales Engineer"                                  matched "engineer" -> engineering managers
//   "Senior Salesforce Administrator"                 matched "sales"    -> sales managers
//   "Accounts Manager", "National Account Executive"  matched "account"  -> Controller / CFO
//   "Construction Accountant"                         matched "construction" first -> construction managers
//   "Manufacturing Intelligence (MI) Solutions ..."   matched "manufactur" -> production managers
// Two fixes: every keyword must start a word (so "facilitator" is not "facilit", "salesforce" is not "sales"), and
// the roles that are a different function despite an industry word in the title are decided first.

export type RoleFamily =
  | "sales" | "finance" | "production" | "maintenance" | "warehouse" | "fleet" | "construction" | "machining" | "engineering" | "procurement";

const has = (re: RegExp, title: string) => re.test(title);

/** null = no family of its own: the generic fallback (site-lead and HR tiers only). */
export function roleFamily(roleTitle: string): RoleFamily | null {
  const t = roleTitle.toLowerCase();

  // 1. Sales roles that carry an engineering, design or accounting word. Decided before anything else.
  //    `\bsales\b` does not match "salesforce" (a CRM tool, so an IT role with no family here).
  if (has(/\bsales\b|\bdesign consultant\b/, t)) return "sales";
  //    Account manager / executive / strategic accounts are sales. A hybrid that is also an engineer keeps the
  //    engineering family, as before ("Quality Engineer - Customer Account Manager").
  if (has(/\b(national|strategic|key|major|enterprise) accounts?\b|\baccounts? (manager|executive|representative|rep|director)\b/, t) && !has(/\bengineer/, t)) return "sales";

  // 2. Finance roles that carry an industry word ("Construction Accountant" is finance, not construction).
  if (has(/\baccount(?:ant|ants|ing)\b|\baccounts (?:payable|receivable)\b|\bfinance\b/, t)) return "finance";

  // 3. The trade and industry families, in the original order (first match wins).
  //    "Manufacturing Intelligence" is a software product, not a plant.
  if (has(/\b(?:production|manufactur\w*)\b/, t) && !has(/\bmanufacturing intelligence\b/, t)) return "production";
  //    "facility"/"facilities", not "facilitator".
  if (has(/\bmaintenance\b|\bfacilit(?:y|ies)\b/, t)) return "maintenance";
  if (has(/\bwarehouse\b|\blogistics\b|\bdistribution\b/, t)) return "warehouse";
  if (has(/\bdrivers?\b|\bcdl\b|\btransport\w*|\bfleet\b/, t)) return "fleet";
  //    "pre" prefix kept ("Preconstruction Manager"); "rebuild" is not "build".
  if (has(/\b(?:pre)?construction\b|\bbuild(?:ing|ings|er|ers)?\b|\bsuperintendent\b/, t)) return "construction";
  if (has(/\b(?:machinist|cnc|fabricat\w*|weld\w*|boilermaker)\b/, t)) return "machining";
  if (has(/\bengineer\w*|\bdesign(?:er|ers)?\b/, t)) return "engineering";
  if (has(/\b(?:procurement|buyer|purchasing)\b/, t)) return "procurement";
  if (has(/\b(?:business development|marketing)\b/, t)) return "sales";
  return null;
}

/** The people to search for, per family (the function tier's titles). Unchanged from the original mapping. */
export const FAMILY_TITLES: Record<RoleFamily, string[]> = {
  production: ["Production Manager", "Production Supervisor", "Plant Manager"],
  maintenance: ["Maintenance Manager", "Maintenance Supervisor", "Facilities Manager"],
  warehouse: ["Warehouse Manager", "Logistics Manager", "Operations Manager"],
  fleet: ["Fleet Manager", "Transportation Manager", "Operations Manager"],
  construction: ["Construction Manager", "Project Manager", "Site Superintendent"],
  machining: ["Plant Manager", "Production Manager", "Operations Manager"],
  engineering: ["Engineering Manager", "Director of Engineering", "VP Engineering"],
  procurement: ["Procurement Manager", "Purchasing Director", "Supply Chain Manager"],
  sales: ["Director of Business Development", "Sales Manager", "VP Sales"],
  finance: ["Controller", "Finance Director", "CFO"],
};

// What a role with no family of its own gets. These are the site-lead and HR titles, not a function's own, so
// such a role has no function tier to search (see buildTierTitles).
export const GENERIC_FALLBACK_TITLES = ["Operations Manager", "General Manager", "HR Manager"];
export const isGenericFallback = (hints: string[]) =>
  hints.length === GENERIC_FALLBACK_TITLES.length && hints.every((t, i) => t === GENERIC_FALLBACK_TITLES[i]);

/**
 * Placeholder heuristic for who to search for at a company: a keyword match on the hiring
 * signal's own role_title, pointed at a plausible supervisor/manager title in that function.
 * The real contact-selection algorithm is a separate later task — this just gives searchContacts
 * something reasonable to search on.
 *
 * Confirmed by direct testing against real data: the original 4-branch version sent 20 of 25
 * real role_titles from one company to the same generic fallback, which made Seamless return
 * the identical contact for genuinely unrelated roles (Construction Manager, CNC Machinist,
 * Buyer, Boilermaker A all resolved to the same HR Manager). Branches below were added to cover
 * exactly the role families observed collapsing.
 *
 * Deliberately not special-cased here: intern/transfer-portal/job-shadowing postings ("2027
 * Internships", "Transfer Portal", "Job Shadowing Portal") aren't roles with a hiring manager to
 * search for in the normal sense — they fall through to the generic fallback rather than getting
 * their own hint branch, since giving them a hint would imply this heuristic can meaningfully
 * point at someone for them. Whether they should be filtered out before ever reaching enrichment
 * is a separate, unresolved question.
 */
export function deriveJobTitleHints(roleTitle: string): string[] {
  const family = roleFamily(roleTitle);
  return family ? [...FAMILY_TITLES[family]] : [...GENERIC_FALLBACK_TITLES];
}
