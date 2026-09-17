import { Worker, type Processor, type WorkerOptions } from "bullmq";
import { redisConnection } from "./connection.js";
import type { QueueName } from "./queueNames.js";

export function createWorker<Payload = unknown, Result = unknown>(
  name: QueueName,
  processor: Processor<Payload, Result>,
  options?: Omit<WorkerOptions, "connection">,
): Worker<Payload, Result> {
  return new Worker<Payload, Result>(name, processor, { connection: redisConnection, ...options });
}
