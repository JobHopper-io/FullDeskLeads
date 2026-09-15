import type { SupabaseClient } from "@supabase/supabase-js";

// TODO(day 4): resolve-or-create on name+domain match, per the Greenhouse ingest step.
export function companyRepository(db: SupabaseClient) {
  return {
    findById: async (id: string) => {
      const { data, error } = await db.from("company").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  };
}
