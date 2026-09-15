import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { normalize } from "@fdl/pipeline";
import type { Logger } from "pino";

export function createNormalizeWorker(connection: Redis, log: Logger): Worker {
  return new Worker("normalize", (job) => normalize(job.data, log), { connection });
}
