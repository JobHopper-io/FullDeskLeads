import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { enrich } from "@fdl/pipeline";
import type { Logger } from "pino";

export function createEnrichWorker(connection: Redis, log: Logger): Worker {
  // TODO(day 8): set a concurrency limit — every Seamless.AI call has a real cost.
  return new Worker("enrich", (job) => enrich(job.data, log), { connection });
}
