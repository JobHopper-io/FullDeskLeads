import { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { QueueName } from "./queueNames.js";

export function createQueue(name: QueueName, connection: Redis): Queue {
  return new Queue(name, { connection });
}
