import type { Logger } from "pino";
import type { Worker } from "bullmq";
import { createWorker, QUEUE_NAMES } from "@fdl/queue";
import { sweepEmittedLeads } from "@fdl/pipeline";

// No payload: every run re-checks every lead a recruiter can still work (see sweepEmittedLeads).
export function createSweepWorker(log: Logger): Worker<Record<string, never>> {
  return createWorker<Record<string, never>>(QUEUE_NAMES.SWEEP, async (job) => {
    const { assignmentsChecked, signalsChecked, findings } = await sweepEmittedLeads();
    const changed = findings.filter((f) => f.expiredAssignmentIds.length > 0);
    log.info(
      { stage: "sweep", jobId: job.id, assignmentsChecked, signalsChecked, expired: changed.length, unknown: findings.filter((f) => f.outcome === "unknown").length },
      "lead sweep complete",
    );
  });
}
