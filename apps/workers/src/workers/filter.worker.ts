import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { filter } from "@fdl/pipeline";
import type { Logger } from "pino";

export function createFilterWorker(connection: Redis, log: Logger): Worker {
  return new Worker("filter", (job) => filter(job.data, log), { connection });
}
