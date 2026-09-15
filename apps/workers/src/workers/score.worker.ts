import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { score } from "@fdl/pipeline";
import type { Logger } from "pino";

export function createScoreWorker(connection: Redis, log: Logger): Worker {
  return new Worker("score", (job) => score(job.data, log), { connection });
}
