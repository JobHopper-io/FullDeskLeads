import { useEffect, useRef, useState } from "react";
import { apiGet, apiPut } from "../lib/apiClient";
import { EMPTY_FILTERS, activeFilterCount, filterParams, toFilterState, toPreferences, type FilterState } from "../lib/specialtyFilters";
import type { PreferencesResponse } from "../lib/types";
import { SpecialtyFilterControls } from "../components/SpecialtyFilterControls";
import PageLayout from "../components/PageLayout";
import ProfileSection from "../components/ProfileSection";

const COUNT_TIMEOUT_MS = 20_000;

export default function SettingsPage() {
  const [saved, setSaved] = useState<PreferencesResponse | null>(null);
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The last count that came back stays on screen while a newer one loads, so the number never blanks out.
  const [count, setCount] = useState<{ count: number; capped: boolean } | null>(null);
  const [counting, setCounting] = useState(false);
  const [countError, setCountError] = useState<string | null>(null);
  const [countAttempt, setCountAttempt] = useState(0);
  const firstCount = useRef(true);

  useEffect(() => {
    let cancelled = false;
    apiGet<PreferencesResponse>("/me/preferences").then(
      (res) => { if (!cancelled) { setSaved(res); setFilters(toFilterState(res.preferences)); } },
      (err: Error) => { if (!cancelled) setError(err.message); },
    );
    return () => { cancelled = true; };
  }, []);

  // Live count: the real Opportunities pool run through the filters as they stand in the form (unsaved). Keyed on
  // the query string, not object identity, so saving the same filters doesn't recount.
  const ready = saved !== null;
  const query = filterParams(filters).toString();
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    // The first count goes out at once; later ones wait 300ms so ticking several values sends one request.
    const delay = firstCount.current ? 0 : 300;
    firstCount.current = false;
    const t = setTimeout(() => {
      setCounting(true);
      setCountError(null);
      apiGet<{ count: number; capped: boolean }>(`/opportunities/count?${query}`, { timeoutMs: COUNT_TIMEOUT_MS }).then(
        (res) => { if (!cancelled) { setCount(res); setCounting(false); } },
        (err: Error) => { if (!cancelled) { setCountError(err.message); setCounting(false); } },
      );
    }, delay);
    return () => { cancelled = true; clearTimeout(t); };
  }, [ready, query, countAttempt]);

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

  const savedQuery = saved ? filterParams(toFilterState(saved.preferences)).toString() : "";
  const dirty = ready && query !== savedQuery;
  const activeCount = activeFilterCount(filters);
  const change = (next: FilterState) => { setFilters(next); setJustSaved(null); };

  let countLine;
  if (countError && !counting) {
    countLine = (
      <>
        <span className="error">Couldn't count matching leads right now ({countError}).</span>{" "}
        <button className="link-button" onClick={() => setCountAttempt((n) => n + 1)}>Try again</button>
      </>
    );
  } else if (count === null) {
    countLine = "Counting matching leads…";
  } else {
    const n = `${count.count}${count.capped ? "+" : ""}`;
    const one = count.count === 1 && !count.capped;
    countLine = (
      <>
        <strong>{n}</strong> {one ? "lead currently matches" : "leads currently match"} these filters in Opportunities.
        {counting && <span className="cell-sub"> Updating…</span>}
      </>
    );
  }

  return (
    <PageLayout width="narrow" className="settings">
      <h1 className="settings-title">Settings</h1>

      <ProfileSection />

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
              <SpecialtyFilterControls filters={filters} onChange={change} industryOptions={saved.options.industry} />
            </div>

            <p className="settings-count" role="status" aria-live="polite">{countLine}</p>

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
    </PageLayout>
  );
}
