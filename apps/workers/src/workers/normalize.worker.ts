import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import type { LeadContract } from "@fdl/contracts";

const resolveIdentityQueue = createQueue<LeadContract>(QUEUE_NAMES.RESOLVE_IDENTITY);

export function createNormalizeWorker(log: Logger): Worker<LeadContract> {
  return createWorker<LeadContract>(QUEUE_NAMES.NORMALIZE, async (job) => {
    log.info({ stage: "normalize", jobId: job.id, payload: job.data }, "stage received job");
    await resolveIdentityQueue.add(QUEUE_NAMES.RESOLVE_IDENTITY, job.data);
  });
}
