import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import type { LeadContract } from "@fdl/contracts";

const enrichQueue = createQueue<LeadContract>(QUEUE_NAMES.ENRICH);

export function createFilterWorker(log: Logger): Worker<LeadContract> {
  return createWorker<LeadContract>(QUEUE_NAMES.FILTER, async (job) => {
    log.info({ stage: "filter", jobId: job.id, payload: job.data }, "stage received job");
    await enrichQueue.add(QUEUE_NAMES.ENRICH, job.data);
  });
}
