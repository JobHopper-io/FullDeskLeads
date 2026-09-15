import { createClient } from "@supabase/supabase-js";

// TODO(day 12): wire authentication through Supabase Auth.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? "",
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? "",
);
