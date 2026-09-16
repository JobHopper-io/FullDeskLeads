import { Redis } from "ioredis";

// Single shared connection, reused by every queue and worker in the process — BullMQ
// recommends against opening one connection per queue/worker.
export const redisConnection = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
