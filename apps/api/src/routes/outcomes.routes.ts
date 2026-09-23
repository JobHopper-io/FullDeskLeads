import type { FastifyInstance } from "fastify";
import { interactionEventRepository } from "@fdl/db";
import { requireSeat } from "../plugins/auth.plugin.js";

export async function outcomesRoutes(app: FastifyInstance) {
  app.post<{ Body: { leadAssignmentId: string; outcome: "contacted" } }>(
    "/outcomes",
    {
      preHandler: requireSeat,
      schema: {
        body: {
          type: "object",
          required: ["leadAssignmentId", "outcome"],
          additionalProperties: false,
          properties: {
            leadAssignmentId: { type: "string", format: "uuid" },
            outcome: { type: "string", enum: ["contacted"] },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, id: seatId } = request.seat;
      const { leadAssignmentId, outcome } = request.body;

      // The assignment must belong to the caller's tenant; anything else is a 404, not a 403,
      // so another tenant's assignment ids can't be probed.
      const { data: assignment, error } = await request.db
        .from("lead_assignments")
        .select("id")
        .eq("id", leadAssignmentId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      if (!assignment) return reply.code(404).send({ error: "lead assignment not found" });

      const event = await interactionEventRepository(request.db).create({
        tenantId,
        leadAssignmentId,
        seatId,
        eventType: outcome,
      });
      return reply.code(201).send(event);
    },
  );
}
