import type { SupabaseClient } from "@supabase/supabase-js";

// TODO(day 10, 12): tenant-scoped; the queue view (day 12) lists rows through this.
export function leadAssignmentRepository(db: SupabaseClient) {
  return {
    listForTenant: async (tenantId: string) => {
      const { data, error } = await db.from("lead_assignment").select("*").eq("tenant_id", tenantId);
      if (error) throw error;
      return data;
    },
  };
}
