import type { SupabaseClient } from "@supabase/supabase-js";

// TODO(day 10): written by the emit stage, shaped against the frozen lead contract.
export function leadRepository(db: SupabaseClient) {
  return {
    findById: async (id: string) => {
      const { data, error } = await db.from("lead").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  };
}
