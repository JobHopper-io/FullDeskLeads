import type { SupabaseClient } from "@supabase/supabase-js";

// TODO(day 2): fill out once the `tenant` table migration lands.
export function tenantRepository(db: SupabaseClient) {
  return {
    findById: async (id: string) => {
      const { data, error } = await db.from("tenant").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  };
}
