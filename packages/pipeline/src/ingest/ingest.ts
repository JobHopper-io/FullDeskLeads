import { createLogger } from "@fdl/shared";
import { rawSignalRepository, type SourceCompanyRow } from "@fdl/db";
import { rawPostingSchema } from "@fdl/contracts";
import { getSource } from "@fdl/sources";
import { getDb } from "../db.js";

const log = createLogger("ingest");

/**
 * Fetches sourceCompany's current postings from its signal source and writes each one that
 * passes shape validation into raw_signals, untouched, for normalize to resolve later.
 *
 * raw_signals.raw_payload stores the whole validated RawPosting (source-agnostic fields —
 * title/location/department/postedDate/sourceJobId — plus the pristine original response
 * fragment nested under its own rawPayload key). That's deliberate: it lets normalize read a
 * posting's fields the same way regardless of which source produced it, while still keeping
 * the original fetch around for debugging, without needing to know Greenhouse's (or Lever's)
 * specific JSON shape ever again.
 *
 * One malformed posting is logged and skipped, never aborts the rest of this company's run —
 * and by extension, one bad company (see GreenhouseSource's 404 handling) never aborts the
 * rest of the batch. Ingest's whole job is to be resilient to one source's bad data.
 */
export async function runIngestForCompany(
  sourceCompany: SourceCompanyRow,
): Promise<{ inserted: number; skipped: number; rawSignalIds: string[] }> {
  const db = getDb();
  const rawSignals = rawSignalRepository(db);
  const source = getSource(sourceCompany.source);

  if (!sourceCompany.domain) {
    // Soft requirement, not enforced at the DB level (see migration 0007) so already-seeded
    // rows don't break — but every row from here on should carry one, since it's what lets
    // normalize resolve identity authoritatively instead of falling back to fragile name
    // matching once a second source for this company shows up.
    log.warn(
      { sourceCompanyId: sourceCompany.id, companyName: sourceCompany.company_name, source: sourceCompany.source },
      "source_companies row has no domain — normalize will fall back to fuzzy name matching for this company",
    );
  }

  const postings = await source.fetchPostings(sourceCompany.source_token);

  let inserted = 0;
  let skipped = 0;
  const rawSignalIds: string[] = [];

  for (const posting of postings) {
    const result = rawPostingSchema.safeParse(posting);
    if (!result.success) {
      log.warn(
        {
          sourceCompanyId: sourceCompany.id,
          source: sourceCompany.source,
          issues: result.error.issues,
          posting,
        },
        "raw posting failed validation — skipping",
      );
      skipped++;
      continue;
    }

    const row = await rawSignals.create({
      source: sourceCompany.source,
      sourceToken: sourceCompany.source_token,
      rawPayload: result.data,
      fetchedAt: new Date().toISOString(),
    });
    rawSignalIds.push(row.id);
    inserted++;
  }

  log.info(
    { sourceCompanyId: sourceCompany.id, companyName: sourceCompany.company_name, inserted, skipped },
    "ingest complete for company",
  );

  return { inserted, skipped, rawSignalIds };
}
