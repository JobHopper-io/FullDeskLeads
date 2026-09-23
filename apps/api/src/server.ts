import Fastify from "fastify";
import { setupAuth } from "./plugins/auth.plugin.js";
import { healthRoutes } from "./routes/health.routes.js";
import { queueRoutes } from "./routes/queue.routes.js";
import { outcomesRoutes } from "./routes/outcomes.routes.js";

const app = Fastify({ logger: true });

setupAuth(app);
await app.register(healthRoutes);
await app.register(queueRoutes);
await app.register(outcomesRoutes);

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
