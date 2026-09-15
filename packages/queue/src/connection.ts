import { Redis } from "ioredis";

let connection: Redis | undefined;

export function getRedisConnection(redisUrl: string): Redis {
  connection ??= new Redis(redisUrl, { maxRetriesPerRequest: null });
  return connection;
}
