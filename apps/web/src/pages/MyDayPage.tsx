import { useEffect, useState } from "react";
import { apiGet } from "../lib/apiClient";
import { DISPOSITIONS } from "../lib/outcomes";
import type { InteractionEvent, QueueItem } from "../lib/types";
import QueueList from "../components/QueueList";
import LeadCard from "../components/LeadCard/LeadCard";
import LeadDetail, { type DetailSection } from "../components/LeadDetail/LeadDetail";

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Layer 2 open for the selected lead, scrolled to this section; null = the queue view.
  const [detailSection, setDetailSection] = useState<DetailSection | null>(null);

  useEffect(() => {
    // StrictMode (dev) runs this twice; without the flag the slower duplicate response would land after the
    // recruiter has started working and reset the selection and any local updates.
    let cancelled = false;
    apiGet<QueueItem[]>("/queue").then(
      (rows) => {
        if (cancelled) return;
        setItems(rows);
        setSelectedId(rows[0]?.id ?? null);
      },
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="error empty">Couldn't load the queue: {error}</p>;
  if (!items) return <p className="empty">Loading queue…</p>;
  if (!items.length) return <p className="empty">No leads in your queue yet.</p>;

  const selected = items.find((i) => i.id === selectedId) ?? null;

  const onLogged = (event: InteractionEvent) => {
    if (!selected) return;
    const label = DISPOSITIONS.find((d) => d.value === event.disposition)?.label ?? event.disposition;
    setNotice(
      `Logged “${label}” for ${selected.company}.` +
        (event.state === "expired" ? " Out of attempts, lead expired." : event.state === "suppressed" ? " Lead suppressed." : ""),
    );
    // A follow-up in the future takes the lead out of the queue until it's due (/queue does the same).
    const hidden = !!event.follow_up_at && (event.state === "contacted" || event.state === "viewed" || event.state === "new");
    const rest = items.filter((i) => i.id !== selected.id);
    if (hidden) {
      setItems(rest);
      setSelectedId(rest[0]?.id ?? null);
    } else {
      setItems(items.map((i) => (i.id === selected.id ? { ...i, state: event.state, noAnswerAttempts: i.noAnswerAttempts + (event.disposition === "no_answer" ? 1 : 0) } : i)));
    }
    // Back to the queue, where the confirmation notice shows (and the next lead is selected if this one left).
    setDetailSection(null);
  };

  if (selected && detailSection) {
    return (
      <LeadDetail
        item={selected} section={detailSection}
        onBack={() => setDetailSection(null)}
        onLogged={onLogged}
        onFlagged={(contactId, flaggedAt) => setItems(items.map((i) => (i.contactId === contactId ? { ...i, contactFlaggedAt: flaggedAt } : i)))}
      />
    );
  }

  return (
    <div className="queue-layout">
      <QueueList items={items} selectedId={selectedId} onSelect={setSelectedId} />
      <div className="queue-detail">
        {notice && <p className="outcome-logged">{notice}</p>}
        {selected && <LeadCard item={selected} onLogged={onLogged} onExpand={setDetailSection} />}
      </div>
    </div>
  );
}
