import type { SupabaseClient } from "@supabase/supabase-js";
import type { SeatRole, SeatRow } from "../types.js";

export function seatRepository(db: SupabaseClient) {
  return {
    // Day 12 auth plugin: resolve which tenant(s) the logged-in user belongs to.
    findByUserId: async (userId: string): Promise<SeatRow[]> => {
      const { data, error } = await db.from("seats").select("*").eq("user_id", userId);
      if (error) throw error;
      return data;
    },

    // Day 2 seed script.
    create: async (input: { tenantId: string; userId: string; role: SeatRole }): Promise<SeatRow> => {
      const { data, error } = await db
        .from("seats")
        .insert({ tenant_id: input.tenantId, user_id: input.userId, role: input.role })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
