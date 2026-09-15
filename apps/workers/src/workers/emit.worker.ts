import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { emit } from "@fdl/pipeline";
import type { Logger } from "pino";

export function createEmitWorker(connection: Redis, log: Logger): Worker {
  return new Worker("emit", (job) => emit(job.data, log), { connection });
}
