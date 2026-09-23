import type { QueueItem } from "../lib/types";

interface Props {
  items: QueueItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function QueueList({ items, selectedId, onSelect }: Props) {
  return (
    <ul className="queue-list">
      {items.map((item) => (
        <li key={item.id}>
          <button className="queue-row" aria-current={item.id === selectedId} onClick={() => onSelect(item.id)}>
            <span className="top">
              <span className="company">{item.company}</span>
              {item.freshnessBand && <span className={`tag ${item.freshnessBand}`}>{item.freshnessBand}</span>}
            </span>
            <span className="meta">
              {item.roleTitle}
              {item.location ? ` · ${item.location}` : ""}
            </span>
            <span className="foot">
              <span>{item.contact.name}</span>
              <span>{item.contact.phone ?? "no phone"}</span>
              <span>{item.confidenceScore !== null ? `confidence ${item.confidenceScore.toFixed(2)}` : "no score"}</span>
              <span>{item.state}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
