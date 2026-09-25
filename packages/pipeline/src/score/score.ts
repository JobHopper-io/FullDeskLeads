import { createLogger } from "@fdl/shared";
import {
  companyRepository,
  configurationRepository,
  contactRepository,
  hiringSignalRepository,
  scoreRecordRepository,
} from "@fdl/db";
import type { HiringSignalFreshnessBand } from "@fdl/db";
import { getDb } from "../db.js";
import { assignPrimaryAndAlternates } from "../enrich/multiContact.js";
import { locationMatchesTarget } from "./geography.js";

const log = createLogger("score");

/** fresh highest, stale lowest — simple even ordinal mapping, not a tuned curve. */
const FRESHNESS_SCORES: Record<HiringSignalFreshnessBand, number> = {
  fresh: 1.0,
  recent: 0.67,
  ageing: 0.33,
  stale: 0.0,
};

/**
 * Placeholder fit-score rubric, not the spec's full per-tenant weighted system.
 *
 * Confirmed against real data: companies.industry and companies.size_band are null for every
 * real company today — nothing in ingest/normalize populates them yet. Treating a null as a
 * miss would make every real signal fail on two dimensions it never had a chance to pass, and
 * treating it as a match would be fabricating a signal that doesn't exist. So both are excluded
 * entirely from fit_score for now — neither positive nor negative weight. This is a known,
 * temporary gap (not a design choice expected to stay this way): once company enrichment
 * populates industry/size_band for real, this function needs to weigh them in, and the
 * eligibility rule below will need to reconsider what "hard miss" means across three real
 * dimensions instead of one.
 *
 * Geography is read from hiring_signals.location (the posting's own location, confirmed
 * populated on all real signals), not companies.hq_location (confirmed empty on every real
 * company) — hq_location has no real data to check against today either.
 *
 * Because industry/size_band can never fail (or pass) today, fit_score reduces to exactly the
 * geography check, and eligibility is driven by a genuine geography miss specifically — not a
 * general "hard miss on all three" that no longer describes what this function checks.
 */
function computeFitScore(
  location: string | null,
  targetGeographies: string[],
): { fitScore: number; geographyMatch: boolean } {
  const geographyMatch =
    location !== null && targetGeographies.some((target) => locationMatchesTarget(location, target));
  return { fitScore: geographyMatch ? 1 : 0, geographyMatch };
}

export async function scoreHiringSignal(
  hiringSignalId: string,
  tenantId: string,
): Promise<{ scoreRecordId: string | null; fitScore: number | null; eligible: boolean }> {
  const db = getDb();
  const hiringSignals = hiringSignalRepository(db);
  const companies = companyRepository(db);
  const contacts = contactRepository(db);
  const configurations = configurationRepository(db);
  const scoreRecords = scoreRecordRepository(db);

  const hiringSignal = await hiringSignals.findById(hiringSignalId);
  if (!hiringSignal) throw new Error(`hiring_signal ${hiringSignalId} not found`);

  const company = await companies.findById(hiringSignal.company_id);
  if (!company) throw new Error(`company ${hiringSignal.company_id} not found`);

  const configuration = await configurations.getActiveForTenant(tenantId);
  if (!configuration) throw new Error(`tenant ${tenantId} has no active configuration`);

  // The same primary the lead will get at emit: highest confidence within the best tier, not just highest overall.
  const contact = assignPrimaryAndAlternates(await contacts.listByHiringSignalId(hiringSignalId))?.primary ?? null;

  // A signal with no contact isn't a lead yet. A contact with no real phone is treated exactly
  // the same way — defensive, read-time check, not a redundant one: it exists specifically so
  // stale data from before enrichment's own empty-phone guard existed can't silently re-enter
  // scoring the same way it did once already (see the 2 legacy rows cleaned up before this task).
  if (!contact || !contact.phone) {
    log.info(
      { hiringSignalId, tenantId, hasContact: !!contact, hasPhone: !!contact?.phone },
      "no usable contact for this signal — not eligible, no score_record written",
    );
    return { scoreRecordId: null, fitScore: null, eligible: false };
  }

  const { fitScore, geographyMatch } = computeFitScore(hiringSignal.location, configuration.target_geographies);
  const freshnessScore = hiringSignal.freshness_band ? FRESHNESS_SCORES[hiringSignal.freshness_band] : null;
  const confidenceScore = contact.confidence_score;

  const scoreRecord = await scoreRecords.upsertForHiringSignal({
    tenantId,
    hiringSignalId,
    fitScore,
    freshnessScore,
    confidenceScore,
    eligible: geographyMatch,
  });

  log.info(
    { hiringSignalId, tenantId, fitScore, freshnessScore, confidenceScore, eligible: geographyMatch },
    "scored hiring_signal for tenant",
  );

  return { scoreRecordId: scoreRecord.id, fitScore, eligible: geographyMatch };
}
