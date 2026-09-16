import Fastify from "fastify";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { FastifyAdapter } from "@bull-board/fastify";
import type { Queue } from "bullmq";
import type { Logger } from "pino";

const BASE_PATH = "/admin/queues";

// Local-only: bound to 127.0.0.1 so this never becomes reachable off the dev box.
export async function startBullBoard(queues: Queue[], log: Logger, port: number): Promise<void> {
  const app = Fastify();
  const serverAdapter = new FastifyAdapter();
  serverAdapter.setBasePath(BASE_PATH);

  createBullBoard({
    queues: queues.map((queue) => new BullMQAdapter(queue)),
    serverAdapter,
  });

  await app.register(serverAdapter.registerPlugin(), { prefix: BASE_PATH });
  await app.listen({ port, host: "127.0.0.1" });

  log.info({ url: `http://127.0.0.1:${port}${BASE_PATH}` }, "bull board listening (local only)");
}
