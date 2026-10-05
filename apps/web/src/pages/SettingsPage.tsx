import { useEffect, useState } from "react";
import { apiGet, apiPut } from "../lib/apiClient";
import { EMPTY_FILTERS, activeFilterCount, filterParams, toFilterState, toPreferences, type FilterState } from "../lib/specialtyFilters";
import type { PreferencesResponse } from "../lib/types";
import { ActiveFilterChips, SpecialtyFilterControls } from "../components/SpecialtyFilterControls";

const same = (a: FilterState, b: FilterState) => JSON.stringify(Object.keys(a).map((k) => [...a[k as keyof FilterState]].sort())) === JSON.stringify(Object.keys(b).map((k) => [...b[k as keyof FilterState]].sort()));

export default function SettingsPage() {
  const [saved, setSaved] = useState<PreferencesResponse | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<{ count: number; capped: boolean } | null>(null);
  const [countError, setCountError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<PreferencesResponse>("/me/preferences").then(
      (res) => { if (!cancelled) { setSaved(res); setFilters(toFilterState(res.preferences)); } },
      (err: Error) => { if (!cancelled) setError(err.message); },
    );
    return () => { cancelled = true; };
  }, []);

  // Live count: the real Opportunities pool run through the filters as they stand in the form (unsaved), debounced.
  useEffect(() => {
    if (!saved) return;
    let cancelled = false;
    setCount(null);
    setCountError(null);
    const t = setTimeout(() => {
      apiGet<{ count: number; capped: boolean }>(`/opportunities/count?${filterParams(filters)}`).then(
        (res) => { if (!cancelled) setCount(res); },
        (err: Error) => { if (!cancelled) setCountError(err.message); },
      );
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [saved, filters]);

  async function persist(next: FilterState, message: string) {
    setSaving(true);
    setError(null);
    setJustSaved(null);
    try {
      const res = await apiPut<PreferencesResponse>("/me/preferences", toPreferences(next));
      setSaved(res);
      setFilters(toFilterState(res.preferences));
      setJustSaved(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = saved ? !same(filters, toFilterState(saved.preferences)) : false;
  const activeCount = activeFilterCount(filters);

  return (
    <div className="page settings">
      <h1 className="settings-title">Settings</h1>

      <section className="md-panel settings-section" aria-labelledby="profile-h">
        <h2 id="profile-h">Profile</h2>
        <p className="cell-sub">Coming soon. Name, password and account details aren't editable here yet.</p>
      </section>

      <section className="md-panel settings-section" aria-labelledby="specialty-h">
        <h2 id="specialty-h">Specialty Filters</h2>
        <p className="settings-note">
          These filters do two things, not one. They set what you see by default on Opportunities, <strong>and</strong> they
          decide which new leads are automatically assigned to you. Leads in your specialty come to you first; a lead outside
          your filters is only added when your day isn't full, and it is tagged “Outside your filters” so you can always tell.
          Changing them never moves leads you already have.
        </p>

        {!saved && !error && <p className="empty">Loading your filters…</p>}
        {saved && (
          <>
            <p className="cell-sub">
              {saved.configured
                ? activeFilterCount(toFilterState(saved.preferences)) > 0
                  ? "Saved. You get leads in your specialty first."
                  : "Saved: you see everything, with no specialty."
                : "Nothing saved yet. You see everything until you save a specialty."}
            </p>
            <div className="filters">
              <SpecialtyFilterControls filters={filters} onChange={(next) => { setFilters(next); setJustSaved(null); }} industryOptions={saved.options.industry} />
            </div>
            <ActiveFilterChips filters={filters} onChange={(next) => { setFilters(next); setJustSaved(null); }} onClear={() => persist(EMPTY_FILTERS, "Cleared and saved: you see everything.")} />

            <p className="settings-count" role="status" aria-live="polite">
              {countError ? <span className="error">Couldn't count: {countError}</span>
                : count === null ? "Counting matching leads…"
                : <><strong>{count.count}{count.capped ? "+" : ""}</strong> lead{count.count === 1 && !count.capped ? "" : "s"} currently match these filters in Opportunities.</>}
            </p>

            <div className="settings-actions">
              <button className="outcome-button" onClick={() => persist(filters, "Saved.")} disabled={saving || (!dirty && saved.configured)}>
                {saving ? "Saving…" : "Save filters"}
              </button>
              <button className="link-button" onClick={() => persist(EMPTY_FILTERS, "Cleared and saved: you see everything.")} disabled={saving || (activeCount === 0 && saved.configured && !dirty)}>
                Clear filters
              </button>
              {justSaved && <span className="outcome-logged" role="status">{justSaved}</span>}
              {error && <span className="error">{error}</span>}
            </div>
          </>
        )}
        {!saved && error && <p className="error">Couldn't load your filters: {error}</p>}
      </section>
    </div>
  );
}
