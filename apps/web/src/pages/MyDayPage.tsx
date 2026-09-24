import { useState } from "react";
import { useNavigate } from "react-router";
import { isActive, isDue, isOverdue, startOfToday, useLeads } from "../lib/leads";
import QueueList from "../components/QueueList";
import LeadCard from "../components/LeadCard/LeadCard";

const RAIL_SIZE = 3;

// One dominant card and only the next three leads: showing everything invites browsing instead of
// calling (full browsing is /leads).
export default function MyDayPage() {
  const { items, worked, logged } = useLeads();
  const navigate = useNavigate();
  // The lead the recruiter jumped to from the rail; otherwise (or once it's worked) the top of the queue.
  const [pickedId, setPickedId] = useState<string | null>(null);

  const today = startOfToday();
  const due = items!.filter((i) => isActive(i) && isDue(i));
  const counters = [
    { label: "New today", value: items!.filter((i) => i.deliveredAt && Date.parse(i.deliveredAt) >= today).length },
    { label: "Worked today", value: items!.filter((i) => i.lastEvent && Date.parse(i.lastEvent.occurredAt) >= today).length },
    { label: "Overdue follow-ups", value: items!.filter(isOverdue).length, overdue: true },
    { label: "Active", value: due.length },
  ];

  const queue = due.filter((i) => !worked.has(i.id));
  const current = queue.find((i) => i.id === pickedId) ?? queue[0];
  const rest = queue.filter((i) => i !== current);

  return (
    <div className="my-day">
      <dl className="counters">
        {counters.map((c) => (
          <div key={c.label} className={c.overdue ? (c.value > 0 ? "counter overdue alert" : "counter overdue") : "counter"}>
            <dt>{c.label}</dt>
            <dd>{c.value}</dd>
          </div>
        ))}
      </dl>
      <div className="my-day-main">
        <div className="my-day-card">
          {current ? (
            <LeadCard
              key={current.id}
              item={current}
              submitLabel="Save and next"
              onLogged={(event) => logged(current, event)}
              onExpand={(section) => navigate(`/leads/${current.id}?section=${section}`)}
            />
          ) : (
            <p className="empty">Queue clear. Nothing left to call right now.</p>
          )}
        </div>
        {rest.length > 0 && (
          <aside className="my-day-rail" aria-label="Up next">
            <h2>Up next</h2>
            <QueueList items={rest.slice(0, RAIL_SIZE)} selectedId={null} onSelect={setPickedId} />
            {rest.length > RAIL_SIZE && <p className="rail-more">+ {rest.length - RAIL_SIZE} more</p>}
          </aside>
        )}
      </div>
    </div>
  );
}
