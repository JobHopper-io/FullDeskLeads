import { createLogger, postingAgeDays } from "@fdl/shared";
import { companyRepository, hiringSignalRepository, rawSignalRepository } from "@fdl/db";
import { firstPublishedDate } from "@fdl/sources";
import { getDb } from "../db.js";

const log = createLogger("filter");

/**
 * Internal-mobility/pipeline postings mixed into the same Greenhouse/Lever feeds as real
 * external openings — confirmed from real data: "Transfer Portal", "Job Shadowing Portal", and
 * internship postings ("2027 Internships", "Accounting Internship", "Developer Intern"). Not
 * roles a recruiter would ever pitch a candidate against, so excluded before enrichment ever
 * runs rather than searched for a hiring-manager contact.
 *
 * Word-boundary matched, not naive substring — "intern" as a bare substring would also catch
 * "international". \bintern\b still correctly catches a real title like "International Sales
 * Intern" (the standalone word "Intern" at the end), it just won't false-positive on
 * "International" or "Internal" alone, where "intern" isn't a distinct word.
 *
 * Same category of non-lead content: generic interest-list postings that aren't a specific
 * requisition ("San Antonio Talent Community", "General Application", "Candidate Pool"). Word-boundary matched on the
 * whole phrase so real roles that merely contain a word don't match — "General Foreman",
 * "HR Generalist" and "Talent Acquisition Partner" are all real titles and stay in.
 *
 * These are also anchored to the whole title: the phrase, with at most a short location prefix
 * ("San Antonio Talent Community") or a separator-led suffix ("Talent Network - Houston",
 * "Candidate Pool (Austin, TX)"). A longer, otherwise-real title that merely contains the phrase
 * ("Talent Community Manager", "Talent Network Manager") is not a match.
 */
const genericInterestList = (phrase: string) =>
  new RegExp(String.raw`^(?:[\p{L}\p{N}.'&]+ ){0,3}${phrase}(?:\s*(?:[-–—,|:]\s*\S.*|\(.*\)))?$`, "iu");

const INTERNAL_MOBILITY_PATTERNS: { reason: string; pattern: RegExp }[] = [
  { reason: "transfer-portal", pattern: /transfer portal/i },
  { reason: "job-shadowing", pattern: /job shadowing/i },
  { reason: "internship", pattern: /internship/i },
  { reason: "intern", pattern: /\bintern\b/i },
  { reason: "talent-community", pattern: genericInterestList("talent (?:community|network)") },
  { reason: "candidate-pool", pattern: genericInterestList("candidate pool") },
  { reason: "general-application", pattern: genericInterestList("general applications?") },
];

/** Read-only classifier: which pattern (if any) matches, with no DB write. */
export function matchInternalMobilityPattern(roleTitle: string): string | null {
  for (const { reason, pattern } of INTERNAL_MOBILITY_PATTERNS) {
    if (pattern.test(roleTitle)) return reason;
  }
  return null;
}

/**
 * A different bug class from the role-title patterns above: here the *hiring company itself* is a staffing/recruiting/
 * search firm, so its posting is another agency's listing, not a lead for this product. Matched on the company name
 * only, word-boundary (never substring), so a real employer is not caught by a word it merely contains.
 *
 * KNOWN, ACCEPTED LIMITATION — do not "fix" this quietly: name-only detection will NOT catch an agency that operates
 * under a name that doesn't signal "staffing" or "recruiting" (e.g. a brand-style name like "Apex Group" or "Kelly").
 * Its postings will pass this filter as if from a real employer. That is a deliberate scoping decision, made on real
 * evidence (Sept 2026, 421 signals / 5 companies): description-based matching was tested and is too noisy to use,
 * and no company-level description is stored. If this is revisited, do it with a stored company description or a
 * curated agency list, and validate against real data first — not by adding keywords to the body match below.
 *
 * Deliberately NOT matched against the posting body: real employers' bodies are full of these words ("recruiting"
 * appears in 136 of 136 Industrial Electric Manufacturing postings' EEO boilerplate, "we are staffing our Birmingham
 * locations" at Andersen). No company-level description is stored, so the name is the only reliable evidence.
 */
const STAFFING_NAME_PATTERN = /\b(?:staffing|recruiting|recruitment|recruiters?|personnel|search firm|talent solutions?)\b/i;

/** Read-only classifier: the matched word if this company name reads as a staffing/recruiting firm, else null. */
export function matchStaffingFirmName(companyName: string): string | null {
  return companyName.match(STAFFING_NAME_PATTERN)?.[0].toLowerCase() ?? null;
}

/** A posting first published more than this many days ago is stale: not a lead, and an emitted lead on it expires. */
export const MAX_POSTING_AGE_DAYS = 14;

/**
 * The posting-age rule is built but OFF: no posting is excluded for age unless POSTING_AGE_FILTER_ENABLED is exactly
 * "true". While it's off, live re-verification at emission (and in the sweep) is the only gate on whether a posting is
 * still open. Why off: at 14 days it would exclude 348 of 376 active signals (companies leave real postings up for
 * months), so it waits for a decision on the limit.
 */
export const postingAgeFilterEnabled = (): boolean => process.env.POSTING_AGE_FILTER_ENABLED === "true";

/**
 * Read-only: the stale-posting reason, or null. Age is from the source's first-published date, else from when the
 * signal was first detected. With neither, the signal is kept (null) and the caller logs it.
 */
export function stalePostingReason(firstPublished: string | null, detectedAt: string | null, now: Date = new Date()): string | null {
  const reference = firstPublished ?? detectedAt;
  if (!reference) return null;
  const age = postingAgeDays(reference, now);
  return age > MAX_POSTING_AGE_DAYS ? `stale-posting: ${age} days old, limit ${MAX_POSTING_AGE_DAYS}` : null;
}

/**
 * Read-only: the reason a signal should be excluded under the filter rules right now (role-title patterns, the
 * staffing-firm company name, then posting age when POSTING_AGE_FILTER_ENABLED is on), or null. The single decision point shared by the filter stage and the
 * lead sweep.
 */
export async function filterReasonFor(hiringSignalId: string): Promise<string | null> {
  const db = getDb();
  const hiringSignal = await hiringSignalRepository(db).findById(hiringSignalId);
  if (!hiringSignal) throw new Error(`hiring_signal ${hiringSignalId} not found`);

  const titleReason = matchInternalMobilityPattern(hiringSignal.role_title);
  if (titleReason) return titleReason;

  const company = await companyRepository(db).findById(hiringSignal.company_id);
  const staffingWord = company ? matchStaffingFirmName(company.name) : null;
  if (staffingWord) return `staffing-firm: company name "${company?.name}" matches "${staffingWord}"`;

  if (!postingAgeFilterEnabled()) return null; // age rule off: nothing below runs

  // The first-published date comes from the source's own payload, not the stored posted_date: for Greenhouse that
  // column falls back to updated_at when first_published is missing, and an edit must not make a posting look new.
  const raw = hiringSignal.raw_signal_id ? await rawSignalRepository(db).findById(hiringSignal.raw_signal_id) : null;
  const rawPosting = raw?.raw_payload as { rawPayload?: unknown } | undefined;
  const firstPublished = rawPosting?.rawPayload ? firstPublishedDate(hiringSignal.source, rawPosting.rawPayload) : null;
  if (!firstPublished && !hiringSignal.detected_at) {
    log.warn({ hiringSignalId }, "no first-published date and no detected_at: posting age unknown, signal kept");
    return null;
  }
  return stalePostingReason(firstPublished, hiringSignal.detected_at);
}

export async function filterHiringSignal(hiringSignalId: string): Promise<{
  excluded: boolean;
  reason: string | null;
}> {
  const reason = await filterReasonFor(hiringSignalId);
  if (!reason) return { excluded: false, reason: null };

  await hiringSignalRepository(getDb()).setStatus(hiringSignalId, "excluded", reason);
  log.info({ hiringSignalId, reason }, "excluded hiring_signal: not a lead for this product (see reason)");
  return { excluded: true, reason };
}
