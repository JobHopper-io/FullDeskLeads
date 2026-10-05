import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArchetypeFilter, RecruiterPreferencesRow } from "../types.js";

export interface PreferencesInput {
  industry: string[];
  roleFamily: string[];
  freshness: string[];
  tier: string[];
  archetype: ArchetypeFilter;
}

// One row per seat (migration 0038). Scoped by seat_id only; the nullable tenant_id seam is not read or written here.
export function recruiterPreferencesRepository(db: SupabaseClient) {
  return {
    findBySeat: async (seatId: string): Promise<RecruiterPreferencesRow | null> => {
      const { data, error } = await db.from("recruiter_preferences").select("*").eq("seat_id", seatId).maybeSingle();
      if (error) throw error;
      return data;
    },

    // Emit: the saved preferences of whichever of these seats have any (no row = never configured).
    listForSeats: async (seatIds: string[]): Promise<RecruiterPreferencesRow[]> => {
      if (!seatIds.length) return [];
      const { data, error } = await db.from("recruiter_preferences").select("*").in("seat_id", seatIds);
      if (error) throw error;
      return data;
    },

    // Saving all-empty is valid and meaningful ("see everything"): it still writes the row.
    upsertForSeat: async (seatId: string, input: PreferencesInput): Promise<RecruiterPreferencesRow> => {
      const { data, error } = await db
        .from("recruiter_preferences")
        .upsert(
          {
            seat_id: seatId,
            industry_filters: input.industry,
            role_family_filters: input.roleFamily,
            freshness_filter: input.freshness,
            content_tier_filter: input.tier,
            archetype_filter: input.archetype,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "seat_id" },
        )
        .select()
        .single();
      if (error) throw error;
      return data;
    },
  };
}
