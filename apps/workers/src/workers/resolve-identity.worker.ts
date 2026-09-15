import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import { resolveIdentity, dedupe } from "@fdl/pipeline";
import type { Logger } from "pino";

export function createResolveIdentityWorker(connection: Redis, log: Logger): Worker {
  return new Worker(
    "resolve-identity",
    async (job) => dedupe(await resolveIdentity(job.data, log), log),
    { connection },
  );
}
