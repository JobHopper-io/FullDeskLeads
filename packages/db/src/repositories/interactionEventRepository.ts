import type { SupabaseClient } from "@supabase/supabase-js";

// TODO(day 13): one outcome action writes a row here against a lead_assignment.
export function interactionEventRepository(db: SupabaseClient) {
  return {
    create: async (event: { leadAssignmentId: string; type: string }) => {
      const { data, error } = await db
        .from("interaction_event")
        .insert({ lead_assignment_id: event.leadAssignmentId, type: event.type })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
