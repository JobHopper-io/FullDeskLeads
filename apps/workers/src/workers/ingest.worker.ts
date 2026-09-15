import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { ingest } from "@fdl/pipeline";
import type { Logger } from "pino";

export function createIngestWorker(connection: Redis, log: Logger): Worker {
  return new Worker("ingest", (job) => ingest(job.data, log), { connection });
}
