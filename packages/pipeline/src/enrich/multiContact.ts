import { companyNameSimilarity, COMPANY_NAME_SIMILARITY_THRESHOLD, type SearchContactResult } from "@fdl/enrichment";

// Multi-contact resolution (Machine V4 Stage 3). Pure functions only: no network, no database, so the choices
// that decide which real people get researched (and paid for) can be checked directly.

/** Capped at 4 to start, not the spec's 2-7, until real hit rate and cost are known. */
export const MAX_CONTACTS_PER_SIGNAL = 4;

// The other two tiers of the search. The third, "function", is the per-role-family list from
// deriveJobTitleHints: the people who run the work the opening is for. Searching all three tiers at once
// (one call) is what makes the results different *roles*, instead of ten people with the same title.
export const SITE_LEAD_TITLES = ["Plant Manager", "Operations Manager", "General Manager"];
export const HR_TITLES = ["HR Manager", "Human Resources Manager", "Talent Acquisition Manager"];

export type ContactTier = "function" | "site" | "hr";

/** Case-insensitive union, first spelling wins, order kept. */
export function buildTitleTargets(functionTitles: string[]): string[] {
  const seen = new Set<string>();
  return [...functionTitles, ...SITE_LEAD_TITLES, ...HR_TITLES].filter((t) => {
    const k = t.toLowerCase();
    return seen.has(k) ? false : (seen.add(k), true);
  });
}

/** Which tier a *result's* title belongs to. Deliberately keyword-based: it names a role, it doesn't rank a person. */
export function tierOf(title: string): ContactTier {
  if (/\b(hr|human resources|talent|recruit\w*|people (?:&|and)? ?culture)\b/i.test(title)) return "hr";
  if (/\b(plant manager|general manager|operations manager|site manager|director of operations|coo)\b/i.test(title)) return "site";
  return "function";
}

const normDomain = (d: string | null | undefined) => (d ?? "").trim().toLowerCase().replace(/^www\./, "");

export type EntityMatch = { ok: true; by: "domain" | "name" | "alias"; matched?: string } | { ok: false; reason: string };

/** Who we're looking for: the company's own domain and name, plus the brand names it operates under (companies.aliases). */
export interface CompanyIdentity {
  domain: string;
  companyName: string;
  aliases?: string[];
}

/**
 * Is this search result really a person at *our* company? Seamless returns people from other companies when the
 * domain filter has no exact hit (confirmed: iemfg.com returned two people on iem.com, and airespring.com contacts
 * are already stored for IEM). But a company can be a group: 21 of Crest's 24 stored contacts are on subsidiary
 * brands' domains (Beta Engineering, Millennium Galvanizing...), which are Crest's own people. So a result passes
 * on the exact domain, or on its company name being similar enough (the verifyCompanyEntity measure and threshold)
 * to the company's name or to any confirmed alias. Names only: no domain list per brand is needed.
 */
export function matchesCompany(r: SearchContactResult, ours: CompanyIdentity): EntityMatch {
  if (normDomain(r.domain) === normDomain(ours.domain)) return { ok: true, by: "domain" };
  if (!r.company) return { ok: false, reason: `no domain match (${r.domain ?? "none"}) and no company name to compare` };

  const known = [ours.companyName, ...(ours.aliases ?? [])];
  let best = { name: ours.companyName, similarity: 0 };
  for (const name of known) {
    const similarity = companyNameSimilarity(name, r.company);
    if (similarity > best.similarity) best = { name, similarity };
  }
  if (best.similarity >= COMPANY_NAME_SIMILARITY_THRESHOLD) {
    return { ok: true, by: best.name === ours.companyName ? "name" : "alias", matched: best.name };
  }
  return {
    ok: false,
    reason: `other company: ${r.company} (${r.domain ?? "no domain"}), best name similarity ${best.similarity.toFixed(2)} against ${known.length} known name(s)`,
  };
}

export interface Selection {
  picked: SearchContactResult[];
  rejected: { result: SearchContactResult; reason: string }[];
}

/**
 * Up to `max` candidates from one search's results (already in Seamless's relevance order): drop other companies'
 * people and repeats, then take the best-ranked from each tier (function, site lead, HR) so the set is different
 * roles, then fill any remaining slots by plain rank.
 */
export function selectCandidates(
  results: SearchContactResult[],
  ours: CompanyIdentity,
  max = MAX_CONTACTS_PER_SIGNAL,
): Selection {
  const rejected: Selection["rejected"] = [];
  const eligible: SearchContactResult[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!r.searchResultId || seen.has(r.searchResultId)) continue;
    seen.add(r.searchResultId);
    const m = matchesCompany(r, ours);
    if (m.ok) eligible.push(r);
    else rejected.push({ result: r, reason: m.reason });
  }

  const picked: SearchContactResult[] = [];
  for (const tier of ["function", "site", "hr"] as const) {
    const first = eligible.find((r) => !picked.includes(r) && tierOf(r.title) === tier);
    if (first && picked.length < max) picked.push(first);
  }
  for (const r of eligible) if (picked.length < max && !picked.includes(r)) picked.push(r);
  return { picked, rejected };
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * 'corporate' when the contact is in the company HQ's city and state, 'site' when both are known and differ,
 * null when any of the four is missing (unknown, never guessed).
 */
export function siteVsCorporate(
  contactCity: string | null,
  contactState: string | null,
  companyCity: string | null,
  companyState: string | null,
): "site" | "corporate" | null {
  if (!norm(contactCity) || !norm(contactState) || !norm(companyCity) || !norm(companyState)) return null;
  return norm(contactCity) === norm(companyCity) && norm(contactState) === norm(companyState) ? "corporate" : "site";
}

/**
 * The highest-confidence contact is the lead's primary; the rest, in descending confidence, are its alternates.
 * Input order breaks ties, so it should already be stable (the repository orders by confidence, created_at, id).
 * A single contact gives no alternates, exactly as before.
 */
export function assignPrimaryAndAlternates<T extends { id: string; confidence_score: number }>(
  contacts: T[],
  maxAlternates = MAX_CONTACTS_PER_SIGNAL - 1,
): { primary: T; alternates: T[] } | null {
  if (contacts.length === 0) return null;
  const ordered = contacts.map((c, i) => ({ c, i })).sort((a, b) => b.c.confidence_score - a.c.confidence_score || a.i - b.i).map((x) => x.c);
  return { primary: ordered[0], alternates: ordered.slice(1, 1 + maxAlternates) };
}
