import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { isActive, startOfToday, useLeads } from "../lib/leads";
import { confidenceBand, confidenceLabel } from "../lib/provenance";
// The scorer's own location parser (a pure file, no deps), so a chip matches exactly what scoring matched.
import { statesInLocation } from "../../../../packages/pipeline/src/score/geography";

const FRESHNESS = ["fresh", "recent", "ageing", "stale"];
const BANDS = ["High", "Medium", "Low"];

function deliveredAge(iso: string | null) {
  if (!iso) return "—";
  const days = Math.floor((startOfToday() - new Date(iso).setHours(0, 0, 0, 0)) / 86_400_000);
  return days <= 0 ? "Today" : days === 1 ? "1 day" : `${days} days`;
}

// A fixed chip: "Any" or one value. Native <select>, not a query builder.
function Chip({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className={value ? "filter-chip on" : "filter-chip"}>
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}

// Dense table for choosing leads, not calling them. Rows come in score order (best first) from the API.
export default function NewLeadsPage() {
  const { items } = useLeads();
  const navigate = useNavigate();
  const [state, setState] = useState("");
  const [freshness, setFreshness] = useState("");
  const [band, setBand] = useState("");

  const active = items!.filter(isActive);
  const statesOf = (location: string | null) => (location ? statesInLocation(location) : new Set<string>());
  // Only states that really occur, most common first.
  const stateCounts = new Map<string, number>();
  for (const i of active) for (const s of statesOf(i.location)) stateCounts.set(s, (stateCounts.get(s) ?? 0) + 1);
  const stateOptions = [...stateCounts.keys()].sort((a, b) => stateCounts.get(b)! - stateCounts.get(a)!);

  const rows = active.filter(
    (i) =>
      (!state || statesOf(i.location).has(state)) &&
      (!freshness || i.freshnessBand === freshness) &&
      (!band || confidenceBand(i.contactConfidence) === band),
  );

  return (
    <div className="page">
      <div className="filters">
        {/* companies.industry isn't populated for any lead yet, so there is nothing real to filter on. */}
        <label className="filter-chip disabled" title="No market data yet">
          Market
          <select disabled><option>No market data yet</option></select>
        </label>
        <Chip label="Geography" value={state} options={stateOptions} onChange={setState} />
        <Chip label="Freshness" value={freshness} options={FRESHNESS} onChange={setFreshness} />
        <Chip label="Match" value={band} options={BANDS} onChange={setBand} />
        <span className="filter-count">{rows.length} of {active.length} · sorted by score</span>
      </div>
      <div className="table-wrap">
        <table className="leads-table">
          <thead>
            <tr><th>Company &amp; role</th><th>Location</th><th>Hiring contact</th><th>Direct line</th><th>Match</th><th>Delivered</th></tr>
          </thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} onClick={() => navigate(`/leads/${i.id}`)}>
                <td>
                  <Link to={`/leads/${i.id}`} onClick={(e) => e.stopPropagation()} className="cell-main">{i.company}</Link>
                  <div className="cell-sub">{i.roleTitle}</div>
                </td>
                <td>{i.location ?? "—"}</td>
                <td><div>{i.contact.name}</div><div className="cell-sub">{i.contact.title}</div></td>
                <td className="nowrap">{i.contact.phone ?? "—"}</td>
                <td className="nowrap">{confidenceLabel(i.contactConfidence)}</td>
                <td className="nowrap">{deliveredAge(i.deliveredAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <p className="empty">No leads match these filters.</p>}
      </div>
    </div>
  );
}
