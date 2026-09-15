import type { SupabaseClient } from "@supabase/supabase-js";

// TODO(day 8): written by the Seamless.AI enrich worker with confidence_score and source.
export function contactRepository(db: SupabaseClient) {
  return {
    findById: async (id: string) => {
      const { data, error } = await db.from("contact").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  };
}
