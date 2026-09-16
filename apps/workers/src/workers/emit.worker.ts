import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, QUEUE_NAMES } from "@fdl/queue";
import type { LeadContract } from "@fdl/contracts";

export function createEmitWorker(log: Logger): Worker<LeadContract> {
  return createWorker<LeadContract>(QUEUE_NAMES.EMIT, async (job) => {
    log.info({ stage: "emit", jobId: job.id, payload: job.data }, "stage received job — pipeline complete");
  });
}
