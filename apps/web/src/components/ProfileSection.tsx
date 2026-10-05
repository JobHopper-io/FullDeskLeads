import { useState, type FormEvent } from "react";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabaseClient";

const MIN_PASSWORD = 8;

/**
 * Settings → Profile. Name and password are changed through Supabase Auth directly (the user's own session); the
 * sidebar's name follows on its own, because AuthProvider re-reads the session on every auth change.
 *
 * Email, workspace and role are shown but not editable: an email change needs a confirmation-email flow, and a seat's
 * workspace and role are set by whoever manages the account, not by the recruiter.
 */
export default function ProfileSection() {
  const { session, seat } = useAuth();
  const email = session?.user.email ?? "";
  const meta = (session?.user.user_metadata ?? {}) as { full_name?: string; name?: string };
  const savedName = meta.full_name || meta.name || "";

  const [name, setName] = useState(savedName);
  const [nameBusy, setNameBusy] = useState(false);
  const [nameStatus, setNameStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwStatus, setPwStatus] = useState<{ ok: boolean; text: string } | null>(null);

  async function saveName(e: FormEvent) {
    e.preventDefault();
    setNameBusy(true);
    setNameStatus(null);
    const { error } = await supabase.auth.updateUser({ data: { full_name: name.trim() } });
    setNameBusy(false);
    setNameStatus(error ? { ok: false, text: `Couldn't save your name: ${error.message}` } : { ok: true, text: "Name saved." });
  }

  // Shown before submitting, so the button only enables for a password that can actually be saved.
  const pwProblem =
    !current ? "Enter your current password."
    : next.length < MIN_PASSWORD ? `New password needs at least ${MIN_PASSWORD} characters.`
    : next === current ? "New password must be different from the current one."
    : confirm !== next ? "The two new passwords don't match."
    : null;

  async function savePassword(e: FormEvent) {
    e.preventDefault();
    if (pwProblem) return;
    setPwBusy(true);
    setPwStatus(null);
    // A signed-in session alone can change the password, so the current one is checked first: someone at an unlocked
    // screen shouldn't be able to take over the account.
    const check = await supabase.auth.signInWithPassword({ email, password: current });
    if (check.error) {
      setPwBusy(false);
      setPwStatus({ ok: false, text: "Your current password isn't right." });
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: next });
    setPwBusy(false);
    if (error) {
      setPwStatus({ ok: false, text: `Couldn't change your password: ${error.message}` });
      return;
    }
    setCurrent("");
    setNext("");
    setConfirm("");
    setPwStatus({ ok: true, text: "Password changed. Use the new one next time you sign in." });
  }

  const trimmed = name.trim();
  return (
    <section className="md-panel settings-section" aria-labelledby="profile-h">
      <h2 id="profile-h">Profile</h2>

      <dl className="l2-facts profile-facts">
        <dt>Email</dt><dd>{email}</dd>
        <dt>Workspace</dt><dd>{seat?.tenantName ?? "—"}</dd>
        <dt>Role</dt><dd className="profile-role">{seat?.role ?? "—"}</dd>
      </dl>
      <p className="cell-sub">To change your email, workspace or role, ask whoever manages your account.</p>

      <form className="profile-form" onSubmit={saveName}>
        <h3 className="eyebrow">Name</h3>
        <label className="sheet-field">
          Display name
          <input type="text" autoComplete="name" maxLength={80} value={name} placeholder={email.split("@")[0]}
            onChange={(e) => { setName(e.target.value); setNameStatus(null); }} />
        </label>
        <div className="settings-actions">
          <button className="outcome-button" type="submit" disabled={nameBusy || !trimmed || trimmed === savedName}>
            {nameBusy ? "Saving…" : "Save name"}
          </button>
          {nameStatus && <span className={nameStatus.ok ? "outcome-logged" : "error"} role="status">{nameStatus.text}</span>}
        </div>
      </form>

      <form className="profile-form" onSubmit={savePassword}>
        <h3 className="eyebrow">Password</h3>
        {/* Lets password managers pair the new password with this account. */}
        <input type="email" autoComplete="username" value={email} readOnly hidden />
        <label className="sheet-field">
          Current password
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => { setCurrent(e.target.value); setPwStatus(null); }} />
        </label>
        <div className="profile-pair">
          <label className="sheet-field">
            New password
            <input type="password" autoComplete="new-password" value={next} onChange={(e) => { setNext(e.target.value); setPwStatus(null); }} />
          </label>
          <label className="sheet-field">
            Confirm new password
            <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => { setConfirm(e.target.value); setPwStatus(null); }} />
          </label>
        </div>
        <div className="settings-actions">
          <button className="outcome-button" type="submit" disabled={pwBusy || !!pwProblem}>{pwBusy ? "Changing…" : "Change password"}</button>
          {pwStatus
            ? <span className={pwStatus.ok ? "outcome-logged" : "error"} role="status">{pwStatus.text}</span>
            : (current || next || confirm) && pwProblem && <span className="cell-sub">{pwProblem}</span>}
        </div>
      </form>
    </section>
  );
}
