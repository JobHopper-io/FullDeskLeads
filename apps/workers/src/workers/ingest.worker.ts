import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import { runIngestForCompany } from "@fdl/pipeline";
import { createServiceClient, sourceCompanyRepository } from "@fdl/db";
import { loadEnv } from "@fdl/shared";

// Job payload is a source_companies row id — this resolves it to the full row.
const db = createServiceClient(loadEnv());
const normalizeQueue = createQueue<string>(QUEUE_NAMES.NORMALIZE);

export function createIngestWorker(log: Logger): Worker<string> {
  return createWorker<string>(QUEUE_NAMES.INGEST, async (job) => {
    const sourceCompanyId = job.data;
    const sourceCompany = await sourceCompanyRepository(db).findById(sourceCompanyId);
    if (!sourceCompany) {
      log.warn({ stage: "ingest", jobId: job.id, sourceCompanyId }, "source company not found — skipping");
      return;
    }

    const { inserted, skipped, rawSignalIds } = await runIngestForCompany(sourceCompany);
    log.info(
      {
        stage: "ingest",
        jobId: job.id,
        sourceCompanyId,
        companyName: sourceCompany.company_name,
        inserted,
        skipped,
      },
      "ingest complete",
    );

    // One normalize job per raw_signal actually inserted, not per company.
    await Promise.all(rawSignalIds.map((rawSignalId) => normalizeQueue.add(QUEUE_NAMES.NORMALIZE, rawSignalId)));
  });
}
