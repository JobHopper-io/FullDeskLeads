import { useEffect, useState } from "react";
import { apiGet } from "../lib/apiClient";
import { DISPOSITIONS } from "../lib/outcomes";
import type { QueueItem } from "../lib/types";
import QueueList from "../components/QueueList";
import LeadCard from "../components/LeadCard/LeadCard";

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    apiGet<QueueItem[]>("/queue").then(
      (rows) => {
        setItems(rows);
        setSelectedId(rows[0]?.id ?? null);
      },
      (err: Error) => setError(err.message),
    );
  }, []);

  if (error) return <p className="error empty">Couldn't load the queue: {error}</p>;
  if (!items) return <p className="empty">Loading queue…</p>;
  if (!items.length) return <p className="empty">No leads in your queue yet.</p>;

  const selected = items.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="queue-layout">
      <QueueList items={items} selectedId={selectedId} onSelect={setSelectedId} />
      <div>
        {notice && <p className="outcome-logged">{notice}</p>}
        {selected && (
          <LeadCard
            item={selected}
            onLogged={(event) => {
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
            }}
          />
        )}
      </div>
    </div>
  );
}
