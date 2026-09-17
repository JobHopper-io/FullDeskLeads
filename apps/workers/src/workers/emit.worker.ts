import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, QUEUE_NAMES } from "@fdl/queue";
import { emitLead } from "@fdl/pipeline";
import type { EmitJobPayload } from "./score.worker.js";

export function createEmitWorker(log: Logger): Worker<EmitJobPayload> {
  return createWorker<EmitJobPayload>(QUEUE_NAMES.EMIT, async (job) => {
    const { hiringSignalId, tenantId } = job.data;
    const result = await emitLead(hiringSignalId, tenantId);

    if ("skipped" in result) {
      log.info({ stage: "emit", jobId: job.id, hiringSignalId, tenantId, reason: result.reason }, "emission skipped");
    } else {
      log.info(
        { stage: "emit", jobId: job.id, hiringSignalId, tenantId, leadId: result.leadId, leadAssignmentId: result.leadAssignmentId },
        "pipeline complete — lead assigned",
      );
    }
  });
}
