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

/** Best first. A lead's primary comes from the best tier that has anyone. */
export const TIER_ORDER: ContactTier[] = ["function", "site", "hr"];

/**
 * What to search for in each tier: one search per tier, so a tier's own titles can't be crowded out of the top
 * results by the generic ones (a single combined search returned 0 function-tier people for Crest's 11 picks).
 * The function tier is the role family's own titles minus any that are really site-lead or HR titles (the
 * production family lists "Plant Manager", say); a role with no family of its own has no function tier, so it
 * costs no search. Case-insensitive, first spelling wins.
 */
export function buildTierTitles(functionTitles: string[]): Record<ContactTier, string[]> {
  const claimed = new Set([...SITE_LEAD_TITLES, ...HR_TITLES].map((t) => t.toLowerCase()));
  return {
    function: functionTitles.filter((t, i, all) => !claimed.has(t.toLowerCase()) && all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === i),
    site: SITE_LEAD_TITLES,
    hr: HR_TITLES,
  };
}

/**
 * Keyword guess at a title's tier. Only a fallback now, for contacts written before the tier was stored (it's
 * known exactly at search time, from which search found the person). It misjudges some titles, e.g. an "IT
 * Operations Manager" reads as site lead.
 */
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

/** A search result plus the tier of the search that found it. */
export type TieredResult = SearchContactResult & { tier: ContactTier };

export interface Selection {
  picked: TieredResult[];
  rejected: { result: TieredResult; reason: string }[];
}

/**
 * Up to `max` candidates from the per-tier searches (each tier's results in Seamless's relevance order; pass the
 * tiers best first, so a person found by several searches keeps their best tier): drop other companies' people
 * and repeats, then take the best-ranked from each tier so the set is different roles, then fill the remaining
 * slots tier by tier (function first), each in rank order.
 */
export function selectCandidates(
  results: TieredResult[],
  ours: CompanyIdentity,
  max = MAX_CONTACTS_PER_SIGNAL,
): Selection {
  const rejected: Selection["rejected"] = [];
  const eligible: TieredResult[] = [];
  const seen = new Set<string>();
  for (const r of results) {
    if (!r.searchResultId || seen.has(r.searchResultId)) continue;
    seen.add(r.searchResultId);
    const m = matchesCompany(r, ours);
    if (m.ok) eligible.push(r);
    else rejected.push({ result: r, reason: m.reason });
  }

  const picked: TieredResult[] = [];
  for (const tier of TIER_ORDER) {
    const first = eligible.find((r) => r.tier === tier);
    if (first && picked.length < max) picked.push(first);
  }
  for (const tier of TIER_ORDER) {
    for (const r of eligible) if (r.tier === tier && picked.length < max && !picked.includes(r)) picked.push(r);
  }
  return { picked, rejected };
}

/**
 * A lead's primary is the highest-confidence contact within the best tier that has anyone (function, then site
 * lead, then HR), not simply the highest confidence overall: confidence is how sure Seamless is of the phone, and
 * on its own it promoted an HR manager over a function manager. The rest, in descending confidence, are the
 * alternates. A contact's tier is the stored one, or the keyword guess for rows written before it was stored.
 * Input order breaks ties, so it should already be stable (the repository orders by confidence, created_at, id).
 * A single contact gives no alternates, exactly as before.
 */
export function assignPrimaryAndAlternates<T extends { id: string; confidence_score: number; title: string; tier?: ContactTier | null }>(
  contacts: T[],
  maxAlternates = MAX_CONTACTS_PER_SIGNAL - 1,
): { primary: T; alternates: T[] } | null {
  if (contacts.length === 0) return null;
  const tierRank = (c: T) => TIER_ORDER.indexOf(c.tier ?? tierOf(c.title));
  const best = Math.min(...contacts.map(tierRank));
  const indexed = contacts.map((c, i) => ({ c, i }));
  const byConfidence = (a: { c: T; i: number }, b: { c: T; i: number }) => b.c.confidence_score - a.c.confidence_score || a.i - b.i;
  const primary = indexed.filter((x) => tierRank(x.c) === best).sort(byConfidence)[0].c;
  const alternates = indexed.filter((x) => x.c !== primary).sort(byConfidence).map((x) => x.c).slice(0, maxAlternates);
  return { primary, alternates };
}
