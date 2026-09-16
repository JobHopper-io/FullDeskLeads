import { createQueue, QUEUE_NAMES } from "@fdl/queue";
import { createLogger } from "@fdl/shared";
import { startBullBoard } from "./board.js";
import { createIngestWorker } from "./workers/ingest.worker.js";
import { createNormalizeWorker } from "./workers/normalize.worker.js";
import { createResolveIdentityWorker } from "./workers/resolve-identity.worker.js";
import { createFilterWorker } from "./workers/filter.worker.js";
import { createEnrichWorker } from "./workers/enrich.worker.js";
import { createSelectContactWorker } from "./workers/select-contact.worker.js";
import { createScoreWorker } from "./workers/score.worker.js";
import { createEmitWorker } from "./workers/emit.worker.js";

const log = createLogger("workers");

createIngestWorker(log);
createNormalizeWorker(log);
createResolveIdentityWorker(log);
createFilterWorker(log);
createEnrichWorker(log);
createSelectContactWorker(log);
createScoreWorker(log);
createEmitWorker(log);

const activeQueues = Object.values(QUEUE_NAMES);
log.info({ queues: activeQueues }, `all ${activeQueues.length} pipeline-stage workers listening`);

const boardPort = Number(process.env.BULL_BOARD_PORT ?? 3001);
await startBullBoard(
  activeQueues.map((name) => createQueue(name)),
  log,
  boardPort,
);
