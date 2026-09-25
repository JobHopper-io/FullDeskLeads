import { distanceToOpening, METRO_RADIUS_MILES } from "./geo.js";
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
 * Words that put a title in some department's own function rather than in running a plant or site. Any of them
 * anywhere in a title rules it out as a site lead: "Information Technology Operations Manager" runs IT, not the
 * plant. Deliberately broad (conservative): a real site lead wrongly left out just falls through to a lower tier,
 * whereas a Legal or Finance manager wrongly promoted would be a bad primary. "production" and "manufacturing" are
 * not listed: they are the operating side.
 */
const NON_SITE_DEPARTMENT =
  /\b(it|i\.t|information (?:technology|systems|services)|software|network|cyber\w*|infosec|security|legal|law|counsel|compliance|risk|audit|finance|financial|accounting|payroll|treasury|tax|marketing|sales|revenue|customer|client|call center|contact center|help ?desk|support|talent|recruit\w*|hr|human resources|people|benefits|procurement|purchasing|supply chain|logistics|transportation|real estate|business|digital|data|analytics|technology|engineering|quality|safety|ehs|environmental|training|learning|communications|brand|product|design)\b/i;

/**
 * Is this title plausibly someone who runs a plant or site? Plant / site / general managers and directors,
 * operations managers and directors, VPs of operations, COOs, and nothing that names another department. A title
 * this returns false for is not a site lead, however much "Operations Manager" it contains.
 */
export function isPlausibleSiteLead(title: string): boolean {
  if (NON_SITE_DEPARTMENT.test(title)) return false;
  return /\b(plant|site) (?:manager|director|superintendent)\b|\bgeneral manager\b|\boperations (?:manager|director)\b|\b(?:manager|director|head) of operations\b|\b(?:vp|vice president)\b.*\boperations\b|\bchief operating officer\b|\bcoo\b/i.test(title);
}

/**
 * The same human, however Seamless has them recorded: name plus phone digits. Seamless can hold two records for one
 * person (different contactId and email, same name, title and phone: Madeline M Steepleton, at both her Crest and
 * Beta Engineering addresses), which the (hiring_signal_id, source_contact_id) key can't tell apart.
 */
export function humanKey(name: string, phone: string): string {
  return `${name.trim().toLowerCase().replace(/\s+/g, " ")}|${phone.replace(/\D/g, "")}`;
}

/** Not a tier the searches produce: for a contact whose tier isn't known and can't be guessed safely. Ranks last. */
export type GuessedTier = ContactTier | "other";

/**
 * Keyword guess at a title's tier. Only a fallback, for contacts written before the tier was stored (it's known
 * exactly at search time, from which search found the person). Conservative: a title that is neither HR nor a
 * plausible site lead is "other", which ranks below every real tier, never assumed to be a function manager.
 */
export function tierOf(title: string): GuessedTier {
  if (/\b(hr|human resources|talent|recruit\w*|people (?:&|and)? ?culture)\b/i.test(title)) return "hr";
  return isPlausibleSiteLead(title) ? "site" : "other";
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
    if (!m.ok) rejected.push({ result: r, reason: m.reason });
    // A search for "Operations Manager" also returns IT, Legal and Finance operations managers. Those are not
    // site leads, so they aren't offered as one (they fall away, and a lower tier fills the slot).
    else if (r.tier === "site" && !isPlausibleSiteLead(r.title)) rejected.push({ result: r, reason: `not a plausible site lead: ${r.title}` });
    else eligible.push(r);
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
 * on its own it promoted an HR manager over a function manager. Within that tier, a contact near the opening
 * (within METRO_RADIUS_MILES of the posting's own location, the same radius as site_vs_corporate) beats one who
 * isn't, whatever their confidence: a director in Texas is the wrong call for a Minnesota opening. Only when
 * nobody in the tier is known to be near (no usable location on either side, or all too far) does it fall back to
 * plain highest confidence. Tiers are never crossed for location. The rest, in descending confidence, are the
 * alternates. A contact's tier is the stored one, or the keyword guess for rows written before it was stored.
 * Input order breaks ties, so it should already be stable (the repository orders by confidence, created_at, id).
 * A single contact gives no alternates, exactly as before.
 */
export function assignPrimaryAndAlternates<
  T extends { id: string; confidence_score: number; title: string; tier?: ContactTier | null; contact_city?: string | null; contact_state?: string | null },
>(
  contacts: T[],
  openingLocation?: string | null,
  maxAlternates = MAX_CONTACTS_PER_SIGNAL - 1,
): { primary: T; alternates: T[]; nearOpening: boolean } | null {
  if (contacts.length === 0) return null;
  const RANK: GuessedTier[] = [...TIER_ORDER, "other"];
  const tierRank = (c: T) => RANK.indexOf(c.tier ?? tierOf(c.title));
  const best = Math.min(...contacts.map(tierRank));
  const indexed = contacts.map((c, i) => ({ c, i }));
  const byConfidence = (a: { c: T; i: number }, b: { c: T; i: number }) => b.c.confidence_score - a.c.confidence_score || a.i - b.i;
  const inTier = indexed.filter((x) => tierRank(x.c) === best).sort(byConfidence);
  const near = inTier.filter((x) => {
    const miles = distanceToOpening(x.c.contact_city, x.c.contact_state, openingLocation);
    return miles !== null && miles <= METRO_RADIUS_MILES;
  });
  const primary = (near.length > 0 ? near : inTier)[0].c;
  const alternates = indexed.filter((x) => x.c !== primary).sort(byConfidence).map((x) => x.c).slice(0, maxAlternates);
  return { primary, alternates, nearOpening: near.length > 0 };
}
