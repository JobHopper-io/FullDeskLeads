import { createServiceClient, sourceCompanyRepository } from "@fdl/db";
import { runIngestForCompany, normalizeRawSignal } from "@fdl/pipeline";
import { getSource } from "@fdl/sources";
import { loadEnv, createLogger } from "@fdl/shared";

// Fast local debugging path: calls the pipeline functions directly, bypassing BullMQ/Redis
// entirely, so you can see real ingest+normalize results in the terminal, for any registered
// source — e.g. `tsx scripts/run-ingest.ts greenhouse` or `tsx scripts/run-ingest.ts lever`.
const sourceName = process.argv[2];
if (!sourceName) {
  console.error("Usage: tsx scripts/run-ingest.ts <source> [source_token...]  (e.g. greenhouse, lever)");
  process.exit(1);
}
getSource(sourceName); // fails fast with a clear error if this source isn't registered

const log = createLogger(`run-ingest:${sourceName}`);
const db = createServiceClient(loadEnv());

// Optional extra args restrict the run to those source_tokens, e.g. `run-ingest.ts greenhouse tokA tokB`.
const onlyTokens = process.argv.slice(3);
const sourceCompanies = (await sourceCompanyRepository(db).listActiveBySource(sourceName)).filter(
  (c) => onlyTokens.length === 0 || onlyTokens.includes(c.source_token),
);

let companiesProcessed = 0;
let postingsInserted = 0;
let duplicatesSkipped = 0;
let newCompaniesCreated = 0;

for (const sourceCompany of sourceCompanies) {
  try {
    const { inserted, skipped, rawSignalIds } = await runIngestForCompany(sourceCompany);
    companiesProcessed++;
    postingsInserted += inserted;
    log.info(
      { company: sourceCompany.company_name, inserted, skipped },
      "ingested company",
    );

    for (const rawSignalId of rawSignalIds) {
      const result = await normalizeRawSignal(rawSignalId);
      if (result.wasDuplicate) duplicatesSkipped++;
      if (result.wasNewCompany) newCompaniesCreated++;
    }
  } catch (err) {
    // One company's failure (bad token aside, already handled inside each SignalSource) never
    // stops the rest of the batch.
    log.error({ company: sourceCompany.company_name, err }, "ingest failed for company — continuing");
  }
}

console.log(`
${sourceName} ingest summary
--------------------------
Companies processed:   ${companiesProcessed}
Postings inserted:     ${postingsInserted}
Duplicates skipped:    ${duplicatesSkipped}
New companies created: ${newCompaniesCreated}
`);
