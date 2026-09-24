import { Link } from "react-router";
import { isActive, isOverdue, useLeads } from "../lib/leads";
import type { QueueItem } from "../lib/types";

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function Entry({ item }: { item: QueueItem }) {
  const overdue = isOverdue(item);
  return (
    <li>
      <Link to={`/leads/${item.id}`} className={overdue ? "fu-row overdue" : "fu-row"}>
        <span className="fu-when">{overdue && <strong>Overdue · </strong>}{when(item.nextActionAt!)}</span>
        <span className="fu-lead"><strong>{item.company}</strong> · {item.contact.name}, {item.contact.title}</span>
        <span className="fu-note">{item.lastEvent?.followUpNote ?? "No note"}</span>
      </Link>
    </li>
  );
}

// Every active lead with a follow-up set, split at the end of today. Overdue ones sit in Due today, in red.
export default function FollowUpsPage() {
  const { items } = useLeads();
  const endOfToday = new Date().setHours(24, 0, 0, 0);
  const all = items!
    .filter((i) => isActive(i) && i.nextActionAt)
    .sort((a, b) => a.nextActionAt!.localeCompare(b.nextActionAt!));
  const dueToday = all.filter((i) => Date.parse(i.nextActionAt!) < endOfToday);
  const upcoming = all.filter((i) => Date.parse(i.nextActionAt!) >= endOfToday);

  return (
    <div className="page follow-ups">
      <section>
        <h2>Due today <span className="count">{dueToday.length}</span></h2>
        {dueToday.length ? <ul className="fu-list">{dueToday.map((i) => <Entry key={i.id} item={i} />)}</ul> : <p className="empty">Nothing due today.</p>}
      </section>
      <section>
        <h2>Upcoming <span className="count">{upcoming.length}</span></h2>
        {upcoming.length ? <ul className="fu-list">{upcoming.map((i) => <Entry key={i.id} item={i} />)}</ul> : <p className="empty">No upcoming follow-ups.</p>}
      </section>
    </div>
  );
}
