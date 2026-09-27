import type { Queue } from "bullmq";

// TODO(day 4-5): register one repeatable ingest job per signal source (Greenhouse, Lever),
// each keyed by a board token from the source_companies config table.

/** Daily 10:00 UTC: before any US recruiter's workday starts (6am ET / 3am PT), so the queue is clean when they log in. */
export const LEAD_SWEEP_CRON = "0 10 * * *";

/**
 * Registers the repeatable jobs. upsertJobScheduler is idempotent per scheduler id, so calling this on every worker
 * start updates the one schedule instead of stacking a duplicate. Only fires while a workers process is running.
 */
export async function registerSchedules(queues: { sweep: Queue }): Promise<void> {
  await queues.sweep.upsertJobScheduler("sweep-emitted-leads", { pattern: LEAD_SWEEP_CRON, tz: "UTC" }, { name: "sweep", data: {} });
}
