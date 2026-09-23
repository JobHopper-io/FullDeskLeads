import { AuthProvider, useAuth } from "./lib/auth";
import { supabase } from "./lib/supabaseClient";
import LoginPage from "./pages/LoginPage";
import QueuePage from "./pages/QueuePage";

function Shell() {
  const { loading, session, seat, seatError } = useAuth();

  if (loading) return <p className="empty">Loading…</p>;
  if (!session) return <LoginPage />;

  return (
    <>
      <header className="app-header">
        <h1>Full Desk Leads</h1>
        <div className="who">
          <span>{session.user.email}{seat ? ` · ${seat.role}` : ""}</span>
          <button className="link-button" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      {seat ? <QueuePage /> : <p className="error empty">Signed in, but no tenant seat could be loaded ({seatError}).</p>}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
