import type { QueueItem } from "../lib/types";
import { confidenceLabel } from "../lib/provenance";
import StateTag from "./StateTag";
import ContactGlyph from "./ContactGlyph";

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
          <button className={`queue-row ${item.state}`} aria-current={item.id === selectedId} onClick={() => onSelect(item.id)}>
            <span className="top">
              <span className="company">{item.company}</span>
              <span className="tags">
                {item.freshnessBand && <span className={`tag ${item.freshnessBand}`}>{item.freshnessBand}</span>}
                <StateTag state={item.state} />
              </span>
            </span>
            <span className="meta">
              Hiring: {item.roleTitle}
              {item.location ? ` · ${item.location}` : ""}
            </span>
            <span className="foot">
              <span className="contact"><ContactGlyph />{item.contact.name}</span>
              <span>{item.contact.phone ?? "no phone"}</span>
              <span>Confidence: {confidenceLabel(item.contactConfidence)}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
