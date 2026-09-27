import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabaseClient";
import { apiGet } from "./apiClient";
import type { Seat } from "./types";

interface AuthState {
  loading: boolean;
  session: Session | null;
  /** The logged-in user's seat (tenant_id, role), resolved by the API from their JWT. */
  seat: Seat | null;
  seatError: string | null;
}

const AuthContext = createContext<AuthState>({ loading: true, session: null, seat: null, seatError: null });
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [seat, setSeat] = useState<Seat | null>(null);
  const [seatError, setSeatError] = useState<string | null>(null);

  useEffect(() => {
    // Local testing: with VITE_AUTO_LOGIN_* set (apps/web/.env.local only), sign in as that user when there's no
    // saved session, so the login page never shows. Real token, real API checks; unset the vars to get login back.
    const email = import.meta.env.VITE_AUTO_LOGIN_EMAIL;
    const password = import.meta.env.VITE_AUTO_LOGIN_PASSWORD;
    supabase.auth.getSession().then(async ({ data }) => {
      const auto = !data.session && email && password ? await supabase.auth.signInWithPassword({ email, password }) : null;
      setSession(auto?.data.session ?? data.session);
      setSessionLoaded(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    setSeat(null);
    setSeatError(null);
    if (!userId) return;
    apiGet<Seat>("/me").then(setSeat, (err: Error) => setSeatError(err.message));
  }, [userId]);

  const loading = !sessionLoaded || (!!session && !seat && !seatError);
  return <AuthContext.Provider value={{ loading, session, seat, seatError }}>{children}</AuthContext.Provider>;
}
