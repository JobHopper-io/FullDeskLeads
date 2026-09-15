import { getRedisConnection } from "@fdl/queue";
import { createLogger } from "@fdl/shared";
import { createIngestWorker } from "./workers/ingest.worker.js";
import { createNormalizeWorker } from "./workers/normalize.worker.js";
import { createResolveIdentityWorker } from "./workers/resolve-identity.worker.js";
import { createFilterWorker } from "./workers/filter.worker.js";
import { createEnrichWorker } from "./workers/enrich.worker.js";
import { createSelectContactWorker } from "./workers/select-contact.worker.js";
import { createScoreWorker } from "./workers/score.worker.js";
import { createEmitWorker } from "./workers/emit.worker.js";

const log = createLogger("workers");
const connection = getRedisConnection(process.env.REDIS_URL ?? "redis://localhost:6379");

connection.on("connect", () => log.info("connected to redis"));
connection.on("error", (err) => log.error({ err }, "redis connection error"));

const pong = await connection.ping();
log.info({ pong }, "redis ping");

createIngestWorker(connection, log);
createNormalizeWorker(connection, log);
createResolveIdentityWorker(connection, log);
createFilterWorker(connection, log);
createEnrichWorker(connection, log);
createSelectContactWorker(connection, log);
createScoreWorker(connection, log);
createEmitWorker(connection, log);

log.info("all pipeline-stage workers listening");
