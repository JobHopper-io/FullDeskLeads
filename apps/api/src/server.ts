import Fastify from "fastify";
import { healthRoutes } from "./routes/health.routes.js";

const app = Fastify({ logger: true });

await app.register(healthRoutes);
// TODO(day 12-13): register supabasePlugin, authPlugin, leadsRoutes, outcomesRoutes.

const port = Number(process.env.PORT ?? 3000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
