import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { selectContact } from "@fdl/pipeline";
import type { Logger } from "pino";

export function createSelectContactWorker(connection: Redis, log: Logger): Worker {
  return new Worker("select-contact", (job) => selectContact(job.data, log), { connection });
}
