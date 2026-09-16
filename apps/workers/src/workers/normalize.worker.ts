import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import { normalizeRawSignal } from "@fdl/pipeline";

// Downstream (resolve-identity onward) is still stub passthrough logic — this pushes the new
// hiringSignalId through, ready for whichever stage implements real resolve-identity logic next.
const resolveIdentityQueue = createQueue<string>(QUEUE_NAMES.RESOLVE_IDENTITY);

export function createNormalizeWorker(log: Logger): Worker<string> {
  return createWorker<string>(QUEUE_NAMES.NORMALIZE, async (job) => {
    const rawSignalId = job.data;
    const { hiringSignalId, wasNewCompany, wasDuplicate } = await normalizeRawSignal(rawSignalId);
    log.info(
      { stage: "normalize", jobId: job.id, rawSignalId, hiringSignalId, wasNewCompany, wasDuplicate },
      "normalize complete",
    );

    if (!wasDuplicate) {
      await resolveIdentityQueue.add(QUEUE_NAMES.RESOLVE_IDENTITY, hiringSignalId);
    }
  });
}
