import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import type { LeadContract } from "@fdl/contracts";

const scoreQueue = createQueue<LeadContract>(QUEUE_NAMES.SCORE);

export function createSelectContactWorker(log: Logger): Worker<LeadContract> {
  return createWorker<LeadContract>(QUEUE_NAMES.SELECT_CONTACT, async (job) => {
    log.info({ stage: "select-contact", jobId: job.id, payload: job.data }, "stage received job");
    await scoreQueue.add(QUEUE_NAMES.SCORE, job.data);
  });
}
