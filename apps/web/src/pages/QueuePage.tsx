import { useEffect, useState } from "react";
import { apiGet } from "../lib/apiClient";
import type { InteractionEvent, QueueItem } from "../lib/types";
import QueueList from "../components/QueueList";
import LeadCard from "../components/LeadCard/LeadCard";

export default function QueuePage() {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Outcomes logged this session, by assignment id — the queue endpoint doesn't return events.
  const [logged, setLogged] = useState<Record<string, InteractionEvent>>({});

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
      {selected && (
        <LeadCard
          item={selected}
          logged={logged[selected.id] ?? null}
          onLogged={(event) => setLogged((prev) => ({ ...prev, [selected.id]: event }))}
        />
      )}
    </div>
  );
}
