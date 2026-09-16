import { Queue, type QueueOptions } from "bullmq";
import { redisConnection } from "./connection.js";
import type { QueueName } from "./queueNames.js";

// BullMQ ties attempts/backoff to jobs, not workers — set here as defaultJobOptions so every
// job added to any queue built with createQueue retries the same way unless a call site overrides it.
export const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: "exponential", delay: 2000 },
} as const;

export function createQueue<Payload = unknown>(name: QueueName, options?: QueueOptions): Queue<Payload> {
  return new Queue<Payload>(name, {
    connection: redisConnection,
    defaultJobOptions: DEFAULT_JOB_OPTIONS,
    ...options,
  });
}
