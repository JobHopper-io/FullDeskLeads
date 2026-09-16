import { createServiceClient, sourceCompanyRepository } from "@fdl/db";
import { runIngestForCompany, normalizeRawSignal } from "@fdl/pipeline";
import { loadEnv, createLogger } from "@fdl/shared";

// Fast local debugging path: calls the pipeline functions directly, bypassing BullMQ/Redis
// entirely, so you can see real ingest+normalize results in the terminal.
const log = createLogger("run-greenhouse-ingest");
const db = createServiceClient(loadEnv());

const sourceCompanies = await sourceCompanyRepository(db).listActiveBySource("greenhouse");

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
    // One company's failure (bad token aside, already handled inside GreenhouseSource) never
    // stops the rest of the batch.
    log.error({ company: sourceCompany.company_name, err }, "ingest failed for company — continuing");
  }
}

console.log(`
Greenhouse ingest summary
--------------------------
Companies processed:   ${companiesProcessed}
Postings inserted:     ${postingsInserted}
Duplicates skipped:    ${duplicatesSkipped}
New companies created: ${newCompaniesCreated}
`);
