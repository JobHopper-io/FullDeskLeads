import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { apiGet, apiPost } from "../lib/apiClient";
import { EMPTY_FILTERS, activeFilterCount, filterParams, toFilterState, type FilterState } from "../lib/specialtyFilters";
import type { OpportunitiesResponse, OpportunityItem, PreferencesResponse } from "../lib/types";
import { ActiveFilterChips, SpecialtyFilterControls } from "../components/SpecialtyFilterControls";

type Sort = "newest" | "company" | "tier";

const tierLabel = (t: OpportunityItem["contentTierName"]) => t[0].toUpperCase() + t.slice(1);

function Row({ item, selected, onSelect, onAdd, adding }: { item: OpportunityItem; selected: boolean; onSelect: () => void; onAdd: () => void; adding: boolean }) {
  const contactDot = item.contactStatus === "verified" ? "fresh" : item.contactStatus === "pending" ? "ageing" : "stale";
  return (
    <tr>
      <td><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${item.company}`} /></td>
      <td>
        <span className="cell-main">{item.company}</span>
        {item.outsideFilters && <span className="outside-filters-tag" title="This lead doesn't match your saved Specialty Filters">Outside your filters</span>}
        <div className="cell-sub">{item.roleTitle}</div>
        {item.whyNowPreview && <div className="cell-sub">{item.whyNowPreview}</div>}
      </td>
      <td className="nowrap">{item.industry}</td>
      <td className="nowrap"><span className={`tag ${item.freshnessBand}`}>{item.freshnessBand}</span></td>
      <td className="nowrap"><span className={`tag ${contactDot}`}>{item.contactStatus}</span></td>
      <td className="nowrap"><span className="tag">{tierLabel(item.contentTierName)}</span></td>
      <td className="nowrap"><button className="link-button" onClick={onAdd} disabled={adding}>{adding ? "Adding…" : "Add to My Day"}</button></td>
    </tr>
  );
}

// Opportunities (spec): the lead pool outside every recruiter's own My Day. The page opens with the recruiter's
// saved Specialty Filters applied (Settings); changing them here is session-only and never writes them back.
export default function OpportunitiesPage() {
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  // The first list fetch waits for the saved filters, so the page never flashes the unfiltered pool first.
  const [saved, setSaved] = useState<PreferencesResponse | null>(null);
  const [sort, setSort] = useState<Sort>("newest");
  const [items, setItems] = useState<OpportunityItem[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiGet<PreferencesResponse>("/me/preferences").then(
      (res) => { if (!cancelled) { setFilters(toFilterState(res.preferences)); setSaved(res); } },
      (err: Error) => { if (!cancelled) { setError(err.message); setLoading(false); } },
    );
    return () => { cancelled = true; };
  }, []);

  // Debounce the search box: unlike every other screen here, this one is a real round trip per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const reqId = useRef(0);

  async function fetchPage(cursor: string | null) {
    const params = filterParams(filters);
    if (debouncedQ) params.set("q", debouncedQ);
    params.set("sort", sort);
    if (cursor) params.set("cursor", cursor);
    return apiGet<OpportunitiesResponse>(`/opportunities?${params}`);
  }

  // Reset to page one whenever search, filters or sort change (once the saved filters have loaded).
  useEffect(() => {
    if (!saved) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    fetchPage(null).then(
      (res) => {
        if (id !== reqId.current) return;
        setItems(res.items);
        setNextCursor(res.nextCursor);
        setSelected(new Set());
        setLoading(false);
      },
      (err: Error) => { if (id === reqId.current) { setError(err.message); setLoading(false); } },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, debouncedQ, filters, sort]);

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const res = await fetchPage(nextCursor);
      setItems((prev) => [...(prev ?? []), ...res.items]);
      setNextCursor(res.nextCursor);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }

  async function addToMyDay(leadIds: string[]) {
    setBusyIds((prev) => new Set([...prev, ...leadIds]));
    setNotice(null);
    try {
      const { results } = await apiPost<{ results: { leadId: string; status: "claimed" | "already_claimed" }[] }>("/opportunities/claim", { leadIds });
      const claimed = new Set(results.filter((r) => r.status === "claimed").map((r) => r.leadId));
      const alreadyClaimed = results.filter((r) => r.status === "already_claimed").length;
      setItems((prev) => prev && prev.filter((i) => !claimed.has(i.leadId)));
      setSelected((prev) => new Set([...prev].filter((id) => !claimed.has(id))));
      if (alreadyClaimed) setNotice(`${alreadyClaimed} of ${leadIds.length} lead${leadIds.length > 1 ? "s were" : " was"} already claimed by someone else.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyIds((prev) => new Set([...prev].filter((id) => !leadIds.includes(id))));
    }
  }

  const clearFilters = () => setFilters(EMPTY_FILTERS);
  const activeCount = activeFilterCount(filters);

  return (
    <div className="page opportunities">
      <div className="filters">
        <input type="search" className="search" placeholder="Search company, role or contact" value={q} onChange={(e) => setQ(e.target.value)} />
        <SpecialtyFilterControls filters={filters} onChange={setFilters} industryOptions={saved?.options.industry ?? []} />
        <label className="filter-chip">
          Sort
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
            <option value="newest">Newest posting</option>
            <option value="company">Company name</option>
            <option value="tier">Content tier</option>
          </select>
        </label>
      </div>

      {saved?.configured && (
        <p className="cell-sub">
          Opened with your saved Specialty Filters. Changes here last for this visit only; edit them in <Link to="/settings">Settings</Link>.
        </p>
      )}
      <ActiveFilterChips filters={filters} onChange={setFilters} onClear={clearFilters} />

      {notice && <p className="outcome-logged" role="status">{notice}</p>}
      {error && <p className="error">{error}</p>}

      {selected.size > 0 && (
        <div className="opp-bulk-bar">
          <span>{selected.size} selected</span>
          <button className="outcome-button" onClick={() => addToMyDay([...selected])}>Add {selected.size} to My Day</button>
        </div>
      )}

      {loading ? (
        <p className="empty">Loading opportunities…</p>
      ) : !items?.length ? (
        <div className="empty">
          <p>No leads match these filters.</p>
          {activeCount > 0 || debouncedQ ? <button className="link-button" onClick={() => { clearFilters(); setQ(""); }}>Clear filters</button> : null}
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="leads-table">
              <thead>
                <tr><th /><th>Company &amp; role</th><th>Industry</th><th>Freshness</th><th>Contact</th><th>Tier</th><th /></tr>
              </thead>
              <tbody>
                {items.map((i) => (
                  <Row
                    key={i.leadId}
                    item={i}
                    selected={selected.has(i.leadId)}
                    onSelect={() => setSelected((prev) => {
                      const next = new Set(prev);
                      if (next.has(i.leadId)) next.delete(i.leadId); else next.add(i.leadId);
                      return next;
                    })}
                    onAdd={() => addToMyDay([i.leadId])}
                    adding={busyIds.has(i.leadId)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && <button className="link-button" onClick={loadMore} disabled={loadingMore}>{loadingMore ? "Loading…" : "Load more"}</button>}
        </>
      )}
      <p className="cell-sub">Job orders and meetings you log elsewhere are still saved in each lead's history; see <Link to="/history">History</Link>.</p>
    </div>
  );
}
