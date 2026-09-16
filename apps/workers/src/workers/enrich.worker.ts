import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import type { LeadContract } from "@fdl/contracts";

const selectContactQueue = createQueue<LeadContract>(QUEUE_NAMES.SELECT_CONTACT);

export function createEnrichWorker(log: Logger): Worker<LeadContract> {
  // TODO(day 8): set a concurrency limit — every Seamless.AI call has a real cost.
  return createWorker<LeadContract>(QUEUE_NAMES.ENRICH, async (job) => {
    log.info({ stage: "enrich", jobId: job.id, payload: job.data }, "stage received job");
    await selectContactQueue.add(QUEUE_NAMES.SELECT_CONTACT, job.data);
  });
}
