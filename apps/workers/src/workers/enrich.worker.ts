import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import { enrichHiringSignal } from "@fdl/pipeline";

// Each enrichHiringSignal call is 2-4 real HTTP requests (search, research, one or more polls)
// against Seamless's 60 req/min org-wide ceiling — keep this conservative, not per-request.
// Confirmed by real load: concurrency=3 sat at ~60 requests/minute per endpoint with zero
// headroom (23 completions in ~23s during a real run) and produced real 429s. Dropped to 2 for
// actual margin below the ceiling, not just a smaller guess.
const ENRICH_CONCURRENCY = 2;

// Job payload is a hiring_signal id, same as every stage since normalize (see normalize.worker.ts).
const selectContactQueue = createQueue<string>(QUEUE_NAMES.SELECT_CONTACT);

export function createEnrichWorker(log: Logger): Worker<string> {
  return createWorker<string>(
    QUEUE_NAMES.ENRICH,
    async (job) => {
      const hiringSignalId = job.data;
      const { contactId, confidence, terminalStatus } = await enrichHiringSignal(hiringSignalId);

      if (contactId) {
        log.info(
          { stage: "enrich", jobId: job.id, hiringSignalId, contactId, confidence },
          "enrich found a contact — enqueuing select-contact",
        );
        await selectContactQueue.add(QUEUE_NAMES.SELECT_CONTACT, hiringSignalId);
      } else {
        log.info(
          { stage: "enrich", jobId: job.id, hiringSignalId, terminalStatus },
          "enrich found no contact — not enqueuing select-contact",
        );
      }
    },
    { concurrency: ENRICH_CONCURRENCY },
  );
}
