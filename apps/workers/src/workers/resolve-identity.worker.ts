import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import type { LeadContract } from "@fdl/contracts";

const filterQueue = createQueue<LeadContract>(QUEUE_NAMES.FILTER);

export function createResolveIdentityWorker(log: Logger): Worker<LeadContract> {
  return createWorker<LeadContract>(QUEUE_NAMES.RESOLVE_IDENTITY, async (job) => {
    log.info({ stage: "resolve-identity", jobId: job.id, payload: job.data }, "stage received job");
    await filterQueue.add(QUEUE_NAMES.FILTER, job.data);
  });
}
