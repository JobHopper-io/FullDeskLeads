import type { ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router";
import { AuthProvider, useAuth } from "./lib/auth";
import { LeadsProvider, isOverdue, useLeads } from "./lib/leads";
import { supabase } from "./lib/supabaseClient";
import LoginPage from "./pages/LoginPage";
import MyDayPage from "./pages/MyDayPage";
import NewLeadsPage from "./pages/NewLeadsPage";
import LeadDetailPage from "./pages/LeadDetailPage";
import FollowUpsPage from "./pages/FollowUpsPage";
import HistoryPage from "./pages/HistoryPage";
import OpportunitiesPage from "./pages/OpportunitiesPage";

function Nav() {
  const { items } = useLeads();
  // Overdue is the one number that stays visible on every screen.
  const overdue = items?.filter(isOverdue).length ?? 0;
  return (
    <nav className="app-nav">
      <NavLink to="/my-day">My Day</NavLink>
      <NavLink to="/leads" end>New Leads</NavLink>
      <NavLink to="/follow-ups">Follow-Ups{overdue > 0 && <span className="overdue-badge" title={`${overdue} overdue`}>{overdue}</span>}</NavLink>
      <NavLink to="/history">History</NavLink>
      <NavLink to="/opportunities">Opportunities<span className="soon">Soon</span></NavLink>
    </nav>
  );
}

// Every screen reads the one shared lead list; this keeps the load/error states in one place.
function Loaded({ children }: { children: ReactNode }) {
  const { items, error, notice } = useLeads();
  if (error) return <p className="error empty">Couldn't load your leads: {error}</p>;
  if (!items) return <p className="empty">Loading leads…</p>;
  return (
    <>
      {notice && <p className="outcome-logged app-notice" role="status">{notice}</p>}
      {children}
    </>
  );
}

function Account({ email, role }: { email: string; role?: string }) {
  return (
    <>
      <span className="account-email" title={email}>{email.split("@")[0]}<wbr />@{email.split("@")[1]}</span>
      {role && <span className="account-role">{role}</span>}
      <button className="link-button" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </>
  );
}

function Shell() {
  const { loading, session, seat, seatError } = useAuth();

  if (loading) return <p className="empty">Loading…</p>;
  if (!session) return <LoginPage />;

  const email = session.user.email ?? "";
  return (
    <LeadsProvider key={session.user.id}>
      <div className="app">
        <aside className="sidebar">
          <div className="wordmark"><img src="/brand/logos/fdl-wordmark-white.svg" alt="Full Desk Leads" /></div>
          {seat && <Nav />}
          <div className="account"><Account email={email} role={seat?.role} /></div>
        </aside>
        <main className="main">
          {seat ? (
            <Routes>
              <Route path="/my-day" element={<Loaded><MyDayPage /></Loaded>} />
              <Route path="/leads" element={<Loaded><NewLeadsPage /></Loaded>} />
              <Route path="/leads/:id" element={<Loaded><LeadDetailPage /></Loaded>} />
              <Route path="/follow-ups" element={<Loaded><FollowUpsPage /></Loaded>} />
              <Route path="/history" element={<Loaded><HistoryPage /></Loaded>} />
              <Route path="/opportunities" element={<OpportunitiesPage />} />
              <Route path="*" element={<Navigate to="/my-day" replace />} />
            </Routes>
          ) : (
            <p className="error empty">Signed in, but no tenant seat could be loaded ({seatError}).</p>
          )}
        </main>
      </div>
    </LeadsProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </BrowserRouter>
  );
}
