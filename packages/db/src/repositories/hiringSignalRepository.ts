import type { SupabaseClient } from "@supabase/supabase-js";

// TODO(day 4-6): written by normalize, deduped by the identity/dedup step.
export function hiringSignalRepository(db: SupabaseClient) {
  return {
    findById: async (id: string) => {
      const { data, error } = await db.from("hiring_signal").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  };
}
