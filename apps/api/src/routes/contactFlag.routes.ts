import type { FastifyInstance } from "fastify";
import { requireSeat } from "../plugins/auth.plugin.js";
import { service } from "../serviceDb.js";

export async function contactFlagRoutes(app: FastifyInstance) {
  // "Report bad contact info" (Layer 2). Record-only: writes one contact_flags row for this tenant and the
  // lead's primary contact — no interaction_event, no state change (that's log_outcome's job, deliberately
  // not involved). Keyed by lead assignment, not contact id, so the caller can only ever flag the contact of
  // an assignment their own tenant holds. Idempotent: flagging twice is not an error and keeps the first flag.
  app.post<{ Params: { leadAssignmentId: string } }>(
    "/lead-assignments/:leadAssignmentId/contact-flag",
    {
      preHandler: requireSeat,
      schema: { params: { type: "object", required: ["leadAssignmentId"], properties: { leadAssignmentId: { type: "string", format: "uuid" } } } },
    },
    async (request, reply) => {
      const { tenantId, id: seatId } = request.seat;
      const { leadAssignmentId } = request.params;

      // Tenant-filtered read first: another tenant's assignment id is a 404, not a 403 (can't be probed).
      const { data: assignment, error } = await request.db
        .from("lead_assignments")
        .select("lead_id")
        .eq("id", leadAssignmentId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (error) throw error;
      if (!assignment) return reply.code(404).send({ error: "lead assignment not found" });

      const { data: lead, error: leadError } = await service().from("leads").select("primary_contact_id").eq("id", assignment.lead_id).single();
      if (leadError) throw leadError;

      // ON CONFLICT DO NOTHING on (tenant_id, contact_id): a repeat flag leaves the original row untouched.
      // The insert returns its row only when it actually inserted; on a conflict, read the existing one.
      const { data: inserted, error: upsertError } = await request.db
        .from("contact_flags")
        .upsert(
          { tenant_id: tenantId, contact_id: lead.primary_contact_id, lead_assignment_id: leadAssignmentId, seat_id: seatId },
          { onConflict: "tenant_id,contact_id", ignoreDuplicates: true },
        )
        .select("created_at");
      if (upsertError) throw upsertError;
      let flaggedAt = inserted[0]?.created_at;
      if (!flaggedAt) {
        const { data: flag, error: flagError } = await request.db
          .from("contact_flags")
          .select("created_at")
          .eq("tenant_id", tenantId)
          .eq("contact_id", lead.primary_contact_id)
          .single();
        if (flagError) throw flagError;
        flaggedAt = flag.created_at;
      }
      return reply.code(201).send({ contactId: lead.primary_contact_id, flaggedAt });
    },
  );
}
