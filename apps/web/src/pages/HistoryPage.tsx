import { useEffect, useState } from "react";
import { Link } from "react-router";
import { apiGet } from "../lib/apiClient";
import { dispositionLabel, useLeads } from "../lib/leads";
import { DISPOSITIONS, NOT_A_FIT_REASONS } from "../lib/outcomes";
import type { QueueItem, TimelineEvent } from "../lib/types";

const at = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

// The selected lead's real outcome timeline, oldest first. Keyed by lead, so switching starts fresh.
function Timeline({ item }: { item: QueueItem }) {
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    apiGet<TimelineEvent[]>(`/lead-assignments/${item.id}/events`).then(
      (rows) => !cancelled && setEvents(rows),
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [item.id]);

  return (
    <aside className="history-rail">
      <h2>{item.company}</h2>
      <p className="cell-sub">{item.contact.name} · {item.roleTitle}</p>
      <Link to={`/leads/${item.id}`}>Open lead →</Link>
      {error && <p className="error">{error}</p>}
      {!events && !error && <p className="empty">Loading timeline…</p>}
      {events && (
        <ol className="timeline">
          {events.map((e) => (
            <li key={e.id}>
              <span className="cell-sub">{at(e.occurred_at)}</span>
              <strong>
                {dispositionLabel(e.disposition ?? e.event_type)}
                {e.not_a_fit_reason && ` · ${NOT_A_FIT_REASONS.find((r) => r.value === e.not_a_fit_reason)?.label ?? e.not_a_fit_reason}`}
              </strong>
              {e.note && <span>{e.note}</span>}
              {e.follow_up_at && <span className="cell-sub">Follow-up set for {at(e.follow_up_at)}</span>}
            </li>
          ))}
        </ol>
      )}
    </aside>
  );
}

// Every lead with at least one logged outcome. Read-only: everything here was logged elsewhere.
export default function HistoryPage() {
  const { items } = useLeads();
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const needle = q.trim().toLowerCase();
  // Date inputs are local calendar days; "to" includes that whole day.
  const fromMs = from ? new Date(`${from}T00:00`).getTime() : -Infinity;
  const toMs = to ? new Date(`${to}T00:00`).getTime() + 86_400_000 : Infinity;
  const rows = items!
    .filter((i) => i.lastEvent)
    .filter((i) => {
      const when = Date.parse(i.lastEvent!.occurredAt);
      return (
        (!needle || [i.company, i.contact.name, ...i.notes].some((t) => t.toLowerCase().includes(needle))) &&
        (!outcome || i.lastEvent!.disposition === outcome) &&
        when >= fromMs && when < toMs
      );
    })
    .sort((a, b) => b.lastEvent!.occurredAt.localeCompare(a.lastEvent!.occurredAt));
  const selected = rows.find((i) => i.id === selectedId);

  return (
    <div className="page history">
      <div className="filters">
        <input type="search" className="search" placeholder="Search company, contact or note" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className={outcome ? "filter-chip on" : "filter-chip"}>
          Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)}>
            <option value="">Any</option>
            {DISPOSITIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </label>
        <label className="filter-chip">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="filter-chip">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      <div className="history-main">
        <ul className="history-list">
          {rows.map((i) => (
            <li key={i.id}>
              <button className="history-row" aria-current={i.id === selectedId} onClick={() => setSelectedId(i.id)}>
                <span className="top">
                  <strong>{i.company}</strong>
                  <span className="tag">{dispositionLabel(i.lastEvent!.disposition)}</span>
                </span>
                <span className="cell-sub">{i.contact.name} · {at(i.lastEvent!.occurredAt)}</span>
                {i.lastEvent!.note && <span className="history-note">{i.lastEvent!.note}</span>}
              </button>
            </li>
          ))}
          {!rows.length && <p className="empty">No worked leads match.</p>}
        </ul>
        {selected ? <Timeline key={selected.id} item={selected} /> : <aside className="history-rail empty">Select a lead to see its timeline.</aside>}
      </div>
    </div>
  );
}
