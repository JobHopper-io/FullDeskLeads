import type { SupabaseClient } from "@supabase/supabase-js";
import type { InteractionEventRow } from "../types.js";

export function interactionEventRepository(db: SupabaseClient) {
  return {
    // Day 13: the one outcome action, writing an event against the lead_assignment it belongs to.
    create: async (input: {
      tenantId: string;
      leadAssignmentId: string;
      seatId?: string | null;
      eventType: string;
      payload?: unknown;
    }): Promise<InteractionEventRow> => {
      const { data, error } = await db
        .from("interaction_events")
        .insert({
          tenant_id: input.tenantId,
          lead_assignment_id: input.leadAssignmentId,
          seat_id: input.seatId ?? null,
          event_type: input.eventType,
          payload: input.payload ?? {},
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
