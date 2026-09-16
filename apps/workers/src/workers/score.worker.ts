import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import type { LeadContract } from "@fdl/contracts";

const emitQueue = createQueue<LeadContract>(QUEUE_NAMES.EMIT);

export function createScoreWorker(log: Logger): Worker<LeadContract> {
  return createWorker<LeadContract>(QUEUE_NAMES.SCORE, async (job) => {
    log.info({ stage: "score", jobId: job.id, payload: job.data }, "stage received job");
    await emitQueue.add(QUEUE_NAMES.EMIT, job.data);
  });
}
