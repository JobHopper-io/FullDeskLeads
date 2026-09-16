import { createLogger } from "@fdl/shared";
import {
  rawSignalRepository,
  sourceCompanyRepository,
  companyRepository,
  hiringSignalRepository,
  type HiringSignalFreshnessBand,
} from "@fdl/db";
import { rawPostingSchema } from "@fdl/contracts";
import { getDb } from "../db.js";

const log = createLogger("normalize");

/** Two postings for the same company within this many days count as the same posting. */
const DEDUP_WINDOW_DAYS = 14;

/**
 * Starting point for cross-source title dedup, not a tuned value. Chosen as a reasonable
 * middle ground for pg_trgm similarity on short job-title strings before seeing real
 * cross-source data — lower catches more true duplicates but risks collapsing genuinely
 * different roles ("Recruiter" vs "Senior Recruiter"), higher is safer but under-catches
 * ("Senior Recruiter" vs "Sr. Recruiter, Talent Acquisition"). Revisit once Lever is live and
 * there's real title-pair data to tune against.
 */
const DEDUP_SIMILARITY_THRESHOLD = 0.65;

const LEGAL_SUFFIXES = new Set(["inc", "llc", "corp", "corporation", "co", "company", "ltd", "limited"]);

/**
 * Normalizes a company name for *comparison only* — never stored, never shown. Lowercases,
 * trims, strips punctuation, and drops a single trailing legal suffix (Inc/LLC/Corp/...) so
 * "Acme Staffing Co." and "acme staffing" resolve to the same company.
 */
function normalizeCompanyName(name: string): string {
  const words = name
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, "")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1])) {
    words.pop();
  }
  return words.join(" ");
}

/**
 * Normalizes a location for *comparison only* — never stored, never shown. Trimmed,
 * lowercased, exact match required. Confirmed against real cross-source data (Crest
 * Industries, Andersen Corporation) that the same city is always written the same way by a
 * given source — "Lexington, KY" and "Montgomery, Alabama" both occur, but never two spellings
 * of the same city — so simple normalization is sufficient; no state-abbreviation canonicalizing.
 */
function normalizeLocationForComparison(location: string | null): string | null {
  if (location === null) return null;
  const normalized = location.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** fresh: 0-2 days, recent: 3-7, ageing: 8-14, stale: 15+ — from postedDate if present, else detectedAt. */
function computeFreshnessBand(referenceDate: Date, now: Date): HiringSignalFreshnessBand {
  const ageDays = Math.max(0, (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24));
  if (ageDays <= 2) return "fresh";
  if (ageDays <= 7) return "recent";
  if (ageDays <= 14) return "ageing";
  return "stale";
}

/**
 * Resolves a raw_signal into a hiring_signal: figures out which company it belongs to
 * (creating one if this is the first time we've seen it), checks whether it's a duplicate of
 * something we already have, and if not, writes the new hiring_signal with its freshness band.
 *
 * Company resolution: domain-first. If the source_companies row carries a domain, that's
 * authoritative — match (or create) companies by domain and never fall through to name
 * matching, since a domain match is exact and a name match is a heuristic. Only when domain is
 * null do we fall back to fuzzy name matching (normalize the target name, narrow candidates
 * with an ilike substring search, compare normalized names for an exact match) — and that
 * fallback logs a warning, since resolving identity without a domain signal is inherently
 * less reliable and should be visible, not silent.
 *
 * Dedup: the (company_id, source, source_posting_id) unique index in the DB already collapses
 * the *same* source re-posting the *same* job. This check is for the same real-world job
 * appearing under a *different* posting id — same company, detected recently, similar-enough
 * title, AND the same location. Uses pg_trgm similarity (via find_similar_hiring_signal, see
 * migration 0010) rather than exact title matching, since two sources rarely word the same role
 * identically — but title similarity alone isn't enough: the same title text posted in two
 * different real cities are two different real openings, not one (confirmed false positive:
 * "Residential Marketing Associate - Lenexa, KS" vs "...- Albert Lea, MN" scored 0.654 on title
 * alone and were wrongly collapsed). A candidate only counts as a duplicate when title
 * similarity crosses the threshold AND the normalized locations match. If either side has no
 * location, there's nothing to gate on — falls back to title-only and logs a warning, since
 * that's a strictly less reliable comparison and should be visible, not silent.
 */
export async function normalizeRawSignal(
  rawSignalId: string,
): Promise<{ hiringSignalId: string; wasNewCompany: boolean; wasDuplicate: boolean }> {
  const db = getDb();
  const rawSignals = rawSignalRepository(db);
  const sourceCompanies = sourceCompanyRepository(db);
  const companies = companyRepository(db);
  const hiringSignals = hiringSignalRepository(db);

  const rawSignal = await rawSignals.findById(rawSignalId);
  if (!rawSignal) throw new Error(`raw_signal ${rawSignalId} not found`);
  if (!rawSignal.source_token) {
    throw new Error(`raw_signal ${rawSignalId} has no source_token — can't resolve its company`);
  }

  const posting = rawPostingSchema.parse(rawSignal.raw_payload);

  const sourceCompany = await sourceCompanies.findByToken(rawSignal.source, rawSignal.source_token);
  if (!sourceCompany) {
    throw new Error(
      `no source_companies row for (${rawSignal.source}, ${rawSignal.source_token}) — can't resolve its company`,
    );
  }

  let companyId: string;
  let wasNewCompany = false;

  if (sourceCompany.domain) {
    const existing = await companies.findByDomain(sourceCompany.domain);
    if (existing) {
      companyId = existing.id;
    } else {
      const created = await companies.create({ name: sourceCompany.company_name, domain: sourceCompany.domain });
      companyId = created.id;
      wasNewCompany = true;
    }
  } else {
    log.warn(
      { sourceCompanyId: sourceCompany.id, companyName: sourceCompany.company_name },
      "resolving company identity without a domain signal — falling back to fuzzy name matching",
    );

    const normalizedTarget = normalizeCompanyName(sourceCompany.company_name);
    const candidates = await companies.searchByNameFragment(normalizedTarget);
    const match = candidates.find((candidate) => normalizeCompanyName(candidate.name) === normalizedTarget);

    if (match) {
      companyId = match.id;
    } else {
      const created = await companies.create({ name: sourceCompany.company_name });
      companyId = created.id;
      wasNewCompany = true;
    }
  }

  const detectedSince = new Date(Date.now() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const candidates = await hiringSignals.findSimilarHiringSignals(companyId, posting.title, detectedSince);
  const incomingLocation = normalizeLocationForComparison(posting.location);

  // Log every comparison, not just the ones that end up flagged as duplicates — this is how a
  // real distribution of cross-source similarity scores gets built to validate or retune
  // DEDUP_SIMILARITY_THRESHOLD later.
  let duplicate: (typeof candidates)[number] | undefined;
  for (const candidate of candidates) {
    const candidateLocation = normalizeLocationForComparison(candidate.location);
    const hasLocationSignal = incomingLocation !== null && candidateLocation !== null;
    const titleCrossed = candidate.similarityScore >= DEDUP_SIMILARITY_THRESHOLD;
    const locationMatches = hasLocationSignal ? incomingLocation === candidateLocation : true;
    const crossedThreshold = titleCrossed && locationMatches;

    if (!hasLocationSignal) {
      log.warn(
        {
          companyId,
          incomingTitle: posting.title,
          candidateTitle: candidate.roleTitle,
          candidateHiringSignalId: candidate.hiringSignalId,
          incomingLocation: posting.location,
          candidateLocation: candidate.location,
        },
        "duplicate comparison lacks a location signal on one side — falling back to title-only match",
      );
    }

    log.info(
      {
        companyId,
        incomingTitle: posting.title,
        candidateTitle: candidate.roleTitle,
        candidateHiringSignalId: candidate.hiringSignalId,
        similarityScore: candidate.similarityScore,
        threshold: DEDUP_SIMILARITY_THRESHOLD,
        incomingLocation: posting.location,
        candidateLocation: candidate.location,
        hasLocationSignal,
        locationMatches,
        crossedThreshold,
      },
      "cross-source title similarity comparison",
    );

    if (crossedThreshold && !duplicate) {
      duplicate = candidate;
    }
  }

  if (duplicate) {
    await rawSignals.markProcessed(rawSignalId);
    log.info(
      { rawSignalId, companyId, hiringSignalId: duplicate.hiringSignalId },
      "duplicate posting — reusing existing hiring_signal",
    );
    return { hiringSignalId: duplicate.hiringSignalId, wasNewCompany, wasDuplicate: true };
  }

  const hiringSignal = await hiringSignals.upsertBySourcePosting({
    companyId,
    rawSignalId,
    roleTitle: posting.title,
    location: posting.location,
    department: posting.department,
    source: rawSignal.source,
    sourcePostingId: posting.sourceJobId,
    postedDate: posting.postedDate,
  });

  const referenceDate = posting.postedDate ? new Date(posting.postedDate) : new Date(hiringSignal.detected_at);
  const freshnessBand = computeFreshnessBand(referenceDate, new Date());
  await hiringSignals.setFreshnessBand(hiringSignal.id, freshnessBand);

  await rawSignals.markProcessed(rawSignalId);

  log.info(
    { rawSignalId, companyId, hiringSignalId: hiringSignal.id, wasNewCompany, freshnessBand },
    "normalized raw signal into hiring_signal",
  );

  return { hiringSignalId: hiringSignal.id, wasNewCompany, wasDuplicate: false };
}
