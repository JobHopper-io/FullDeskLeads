import { createLogger } from "@fdl/shared";
import { companyRepository, hiringSignalRepository } from "@fdl/db";
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

export async function filterHiringSignal(hiringSignalId: string): Promise<{
  excluded: boolean;
  reason: string | null;
}> {
  const db = getDb();
  const hiringSignals = hiringSignalRepository(db);

  const hiringSignal = await hiringSignals.findById(hiringSignalId);
  if (!hiringSignal) throw new Error(`hiring_signal ${hiringSignalId} not found`);

  const reason = matchInternalMobilityPattern(hiringSignal.role_title);
  if (reason) {
    await hiringSignals.setStatus(hiringSignalId, "excluded", reason);
    log.info(
      { hiringSignalId, roleTitle: hiringSignal.role_title, reason },
      "excluded hiring_signal — internal-mobility pattern, not a real external opening",
    );
    return { excluded: true, reason };
  }

  const company = await companyRepository(db).findById(hiringSignal.company_id);
  const staffingWord = company ? matchStaffingFirmName(company.name) : null;
  if (staffingWord) {
    const staffingReason = `staffing-firm: company name "${company?.name}" matches "${staffingWord}"`;
    await hiringSignals.setStatus(hiringSignalId, "excluded", staffingReason);
    log.info({ hiringSignalId, companyName: company?.name, reason: staffingReason }, "excluded hiring_signal — hiring company is a staffing/recruiting firm");
    return { excluded: true, reason: staffingReason };
  }

  return { excluded: false, reason: null };
}
