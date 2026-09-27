import { Link } from "react-router";
import type { InteractionEvent, QueueItem } from "../../lib/types";
import OutcomePanel from "../OutcomePanel";
import LeadCardLayer1 from "./LeadCardLayer1";
import type { DetailSection } from "../LeadDetail/LeadDetail";

interface Props {
  item: QueueItem;
  onLogged: (event: InteractionEvent) => void;
  onExpand: (section: DetailSection) => void;
  submitLabel?: string;
  /** Place in today's queue, shown in the card header as "Lead 07 of 36". */
  position?: { n: number; total: number };
}

const EXPANDERS: { section: DetailSection; label: string }[] = [
  { section: "script", label: "Full script" },
  { section: "objections", label: "Objection handling" },
  { section: "role", label: "Role detail" },
];

// Zero-padded to the width of the total, so it reads "07 of 36" and never shifts as it counts up.
const pad = (n: number, width: number) => String(n).padStart(Math.max(2, width), "0");

export default function LeadCard({ item, onLogged, onExpand, submitLabel, position }: Props) {
  return (
    <article className="lead-card">
      <div className="card-top">
        {position && (
          <header className="card-position eyebrow" aria-label={`Lead ${position.n} of ${position.total} in today's queue`}>
            Lead {pad(position.n, String(position.total).length)} of {pad(position.total, 2)}
          </header>
        )}
        {/* The same lead as a step-by-step call with the words written out (Guided Sheet). */}
        <Link className="card-guided" to={`/leads/${item.id}/guided`}>Guided call</Link>
      </div>
      <LeadCardLayer1 item={item} />
      <OutcomePanel item={item} onLogged={onLogged} submitLabel={submitLabel} />
      <div className="card-actions">
        {EXPANDERS.map((e) => (
          <button key={e.section} className="chip" onClick={() => onExpand(e.section)}>{e.label}</button>
        ))}
      </div>
    </article>
  );
}
