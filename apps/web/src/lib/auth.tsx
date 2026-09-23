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
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
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
