import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import type { LeadContract } from "@fdl/contracts";

const normalizeQueue = createQueue<LeadContract>(QUEUE_NAMES.NORMALIZE);

export function createIngestWorker(log: Logger): Worker<LeadContract> {
  return createWorker<LeadContract>(QUEUE_NAMES.INGEST, async (job) => {
    log.info({ stage: "ingest", jobId: job.id, payload: job.data }, "stage received job");
    await normalizeQueue.add(QUEUE_NAMES.NORMALIZE, job.data);
  });
}
