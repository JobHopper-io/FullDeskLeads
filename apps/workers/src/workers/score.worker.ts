import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, createQueue, QUEUE_NAMES } from "@fdl/queue";
import { scoreHiringSignal } from "@fdl/pipeline";
import { createServiceClient, tenantRepository } from "@fdl/db";
import { loadEnv } from "@fdl/shared";

export interface EmitJobPayload {
  hiringSignalId: string;
  tenantId: string;
}

const db = createServiceClient(loadEnv());
const emitQueue = createQueue<EmitJobPayload>(QUEUE_NAMES.EMIT);

// Job payload is a hiring_signal id, same as every stage since normalize (see normalize.worker.ts).
export function createScoreWorker(log: Logger): Worker<string> {
  return createWorker<string>(QUEUE_NAMES.SCORE, async (job) => {
    const hiringSignalId = job.data;

    // Score against every real tenant, not a hardcoded pair — the two seeded test tenants are
    // just what's in the table today.
    const tenants = await tenantRepository(db).listAll();

    for (const tenant of tenants) {
      const { scoreRecordId, fitScore, eligible } = await scoreHiringSignal(hiringSignalId, tenant.id);
      log.info(
        { stage: "score", jobId: job.id, hiringSignalId, tenantId: tenant.id, scoreRecordId, fitScore, eligible },
        "scored hiring_signal for tenant",
      );

      if (eligible) {
        await emitQueue.add(QUEUE_NAMES.EMIT, { hiringSignalId, tenantId: tenant.id });
      }
    }
  });
}
