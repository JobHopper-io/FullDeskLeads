import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createScopedClient, seatRepository, type SeatRole } from "@fdl/db";
import { loadEnv } from "@fdl/shared";

export interface RequestSeat {
  id: string;
  tenantId: string;
  role: SeatRole;
}

declare module "fastify" {
  interface FastifyRequest {
    seat: RequestSeat;
    /** Supabase client acting as the logged-in user — RLS applies on top of the explicit tenant filters. */
    db: ReturnType<typeof createScopedClient>;
  }
}

export function setupAuth(app: FastifyInstance) {
  app.decorateRequest("seat", null as never);
  app.decorateRequest("db", null as never);
}

/**
 * preHandler for every tenant route. tenant_id is derived here, from the verified JWT's user →
 * their seat, and nowhere else: no route ever reads a tenant id from the query, params or body.
 */
export async function requireSeat(request: FastifyRequest, reply: FastifyReply) {
  const token = request.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return reply.code(401).send({ error: "missing bearer token" });

  const db = createScopedClient(loadEnv(), token);
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return reply.code(401).send({ error: "invalid or expired token" });

  const seats = await seatRepository(db).findByUserId(data.user.id);
  // No silent pick between tenants: a user must map to exactly one seat until a tenant switcher exists.
  if (seats.length !== 1) return reply.code(403).send({ error: "user has no single tenant seat" });

  request.seat = { id: seats[0].id, tenantId: seats[0].tenant_id, role: seats[0].role };
  request.db = db;
}
