import { createLogger } from "@fdl/shared";
import { hiringSignalRepository } from "@fdl/db";
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
 */
const INTERNAL_MOBILITY_PATTERNS: { reason: string; pattern: RegExp }[] = [
  { reason: "transfer-portal", pattern: /transfer portal/i },
  { reason: "job-shadowing", pattern: /job shadowing/i },
  { reason: "internship", pattern: /internship/i },
  { reason: "intern", pattern: /\bintern\b/i },
];

/** Read-only classifier: which pattern (if any) matches, with no DB write. */
export function matchInternalMobilityPattern(roleTitle: string): string | null {
  for (const { reason, pattern } of INTERNAL_MOBILITY_PATTERNS) {
    if (pattern.test(roleTitle)) return reason;
  }
  return null;
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

  return { excluded: false, reason: null };
}
