import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import { filterHiringSignal } from "@fdl/pipeline";

// Job payload is a hiring_signal id, same as every stage since normalize (see normalize.worker.ts).
const enrichQueue = createQueue<string>(QUEUE_NAMES.ENRICH);

export function createFilterWorker(log: Logger): Worker<string> {
  return createWorker<string>(QUEUE_NAMES.FILTER, async (job) => {
    const hiringSignalId = job.data;
    const { excluded, reason } = await filterHiringSignal(hiringSignalId);

    if (excluded) {
      // This is the only producer into the ENRICH queue — not enqueuing here is what actually
      // keeps an excluded signal from ever reaching enrichHiringSignal via the queue path.
      log.info(
        { stage: "filter", jobId: job.id, hiringSignalId, reason },
        "excluded hiring_signal — not enqueuing enrich",
      );
      return;
    }

    log.info({ stage: "filter", jobId: job.id, hiringSignalId }, "passed filter — enqueuing enrich");
    await enrichQueue.add(QUEUE_NAMES.ENRICH, hiringSignalId);
  });
}
