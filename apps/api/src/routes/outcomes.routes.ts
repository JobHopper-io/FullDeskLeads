import type { FastifyInstance } from "fastify";
import { createServiceClient } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import { requireSeat } from "../plugins/auth.plugin.js";

const DISPOSITIONS = [
  "no_answer", "left_voicemail", "gatekeeper", "connected", "no_interest", "follow_up_later",
  "job_order", "bad_contact_data", "not_a_fit", "do_not_contact", "meeting_set",
] as const;
const NOT_A_FIT_REASONS = ["wrong_size", "wrong_industry", "self_performs", "existing_client", "too_far", "other"] as const;

interface Body {
  leadAssignmentId: string;
  disposition: (typeof DISPOSITIONS)[number];
  note?: string;
  followUpAt?: string;
  notAFitReason?: (typeof NOT_A_FIT_REASONS)[number];
  /** True when the recruiter picked the date/time themselves (Custom); skips the weekend roll. */
  followUpIsCustom?: boolean;
  /** Caller's IANA time zone; defines Saturday/Sunday and "9:00" for the weekend roll. */
  timeZone?: string;
}

// Global tables aren't readable with the user's JWT; the ids below are only ever looked up from an
// assignment the caller's tenant-filtered query already returned.
let serviceDb: ReturnType<typeof createServiceClient> | undefined;
const service = () => (serviceDb ??= createServiceClient(loadEnv()));

export async function outcomesRoutes(app: FastifyInstance) {
  app.post<{ Body: Body }>(
    "/outcomes",
    {
      preHandler: requireSeat,
      schema: {
        body: {
          type: "object",
          required: ["leadAssignmentId", "disposition"],
          additionalProperties: false,
          properties: {
            leadAssignmentId: { type: "string", format: "uuid" },
            disposition: { type: "string", enum: DISPOSITIONS },
            note: { type: "string", maxLength: 280 },
            followUpAt: { type: "string", format: "date-time" },
            notAFitReason: { type: "string", enum: NOT_A_FIT_REASONS },
            followUpIsCustom: { type: "boolean" },
            timeZone: { type: "string", maxLength: 64 },
          },
        },
      },
    },
    async (request, reply) => {
      const { tenantId, id: seatId } = request.seat;
      const { leadAssignmentId, disposition, note, followUpAt, notAFitReason, followUpIsCustom, timeZone } = request.body;

      // do_not_contact needs the lead's company, bad_contact_data its primary contact. The assignment
      // is read tenant-filtered first, so another tenant's ids are a 404, not a 403 (can't be probed).
      let companyId: string | null = null;
      let contactId: string | null = null;
      if (disposition === "do_not_contact" || disposition === "bad_contact_data") {
        const { data: assignment, error } = await request.db
          .from("lead_assignments")
          .select("lead_id")
          .eq("id", leadAssignmentId)
          .eq("tenant_id", tenantId)
          .maybeSingle();
        if (error) throw error;
        if (!assignment) return reply.code(404).send({ error: "lead assignment not found" });

        const { data: lead, error: leadError } = await service()
          .from("leads")
          .select("primary_contact_id, hiring_signal:hiring_signals ( company_id )")
          .eq("id", assignment.lead_id)
          .single();
        if (leadError) throw leadError;
        contactId = lead.primary_contact_id;
        companyId = (lead.hiring_signal as unknown as { company_id: string }).company_id;
      }

      // One database transaction (migrations 0022/0023): the event, the state change and any suppression /
      // contact flag land together or not at all. The function re-checks tenant ownership.
      const { data, error } = await request.db.rpc("log_outcome", {
        p_lead_assignment_id: leadAssignmentId,
        p_tenant_id: tenantId,
        p_seat_id: seatId,
        p_disposition: disposition,
        p_note: note?.trim() || null,
        p_follow_up_at: followUpAt ?? null,
        p_not_a_fit_reason: notAFitReason ?? null,
        p_company_id: companyId,
        p_contact_id: contactId,
        p_follow_up_is_custom: followUpIsCustom ?? false,
        p_time_zone: timeZone ?? "UTC",
      });
      if (error?.code === "P0002") return reply.code(404).send({ error: "lead assignment not found" });
      if (error?.code === "22023") return reply.code(400).send({ error: error.message });
      if (error) throw error;
      return reply.code(201).send(data);
    },
  );
}
