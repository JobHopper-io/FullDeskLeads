import type { ReactNode } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router";
import { AuthProvider, useAuth } from "./lib/auth";
import { LeadsProvider, isActive, isDue, isFollowUpDueToday, isOverdue, useLeads } from "./lib/leads";
import { supabase } from "./lib/supabaseClient";
import type { QueueItem } from "./lib/types";
import LoginPage from "./pages/LoginPage";
import MyDayPage from "./pages/MyDayPage";
import NewLeadsPage from "./pages/NewLeadsPage";
import LeadDetailPage from "./pages/LeadDetailPage";
import GuidedSheetPage from "./pages/GuidedSheetPage";
import FollowUpsPage from "./pages/FollowUpsPage";
import HistoryPage from "./pages/HistoryPage";
import OpportunitiesPage from "./pages/OpportunitiesPage";
import SettingsPage from "./pages/SettingsPage";
import PageLayout from "./components/PageLayout";

const count = (items: QueueItem[] | null, rule: (i: QueueItem) => boolean) => items?.filter(rule).length;

function Nav() {
  const { items } = useLeads();
  // No badge until the list has loaded: a 0 before then would be made up.
  const badge = (n: number | undefined, className = "nav-badge") => n !== undefined && <span className={className}>{n}</span>;
  const overdue = count(items, isOverdue) ?? 0;
  return (
    <nav className="app-nav" aria-labelledby="workspace-label">
      <div id="workspace-label" className="nav-label">Workspace</div>
      {/* Workable = active and due now (My Day's queue); unworked = active with no outcome ever logged. */}
      <NavLink to="/my-day">My Day{badge(count(items, (i) => isActive(i) && isDue(i)))}</NavLink>
      <NavLink to="/leads" end>New Leads{badge(count(items, (i) => isActive(i) && !i.lastEvent))}</NavLink>
      {/* Due = Follow-Ups' "Due today" count; it turns red while any of them is overdue, the one alarm kept on every screen. */}
      <NavLink to="/follow-ups" title={overdue ? `${overdue} overdue` : undefined}>
        Follow-Ups{badge(count(items, isFollowUpDueToday), overdue ? "nav-badge overdue" : "nav-badge")}
      </NavLink>
      <NavLink to="/opportunities">Opportunities</NavLink>
      <NavLink to="/history">History</NavLink>
      <NavLink to="/settings">Settings</NavLink>
    </nav>
  );
}

// Every screen reads the one shared lead list; this keeps the load/error states in one place.
function Loaded({ children }: { children: ReactNode }) {
  const { items, error } = useLeads();
  if (error) return <PageLayout><p className="error empty">Couldn't load your leads: {error}</p></PageLayout>;
  if (!items) return <PageLayout><p className="empty">Loading leads…</p></PageLayout>;
  return children;
}

function Account({ name, email, role }: { name: string; email: string; role?: string }) {
  const initials = name.split(/[\s._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
  return (
    <>
      <span className="account-initials" aria-hidden="true">{initials}</span>
      <span className="account-who">
        <span className="account-name" title={email}>{name}</span>
        {role && <span className="account-role">{role} seat</span>}
      </span>
      <button className="account-signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
    </>
  );
}

function Shell() {
  const { loading, session, seat, seatError } = useAuth();

  if (loading) return <p className="empty">Loading…</p>;
  if (!session) return <LoginPage />;

  const email = session.user.email ?? "";
  // The profile name when the account has one; otherwise the email's local part, never an invented name.
  const meta = session.user.user_metadata as { full_name?: string; name?: string };
  const name = meta.full_name || meta.name || email.split("@")[0];
  return (
    <LeadsProvider key={session.user.id}>
      <div className="app">
        <aside className="sidebar">
          <div className="wordmark"><img src="/brand/logos/fdl-wordmark-white.svg" alt="Full Desk Leads" /></div>
          {seat && <Nav />}
          <div className="account"><Account name={name} email={email} role={seat?.role} /></div>
        </aside>
        <main className="main">
          {seat ? (
            <Routes>
              <Route path="/my-day" element={<Loaded><MyDayPage /></Loaded>} />
              <Route path="/leads" element={<Loaded><NewLeadsPage /></Loaded>} />
              <Route path="/leads/:id" element={<Loaded><LeadDetailPage /></Loaded>} />
              <Route path="/leads/:id/guided" element={<Loaded><GuidedSheetPage /></Loaded>} />
              <Route path="/follow-ups" element={<Loaded><FollowUpsPage /></Loaded>} />
              <Route path="/history" element={<Loaded><HistoryPage /></Loaded>} />
              <Route path="/opportunities" element={<OpportunitiesPage />} />
              <Route path="/settings" element={<SettingsPage />} />
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
