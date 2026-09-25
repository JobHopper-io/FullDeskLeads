import type { InteractionEvent, QueueItem } from "../../lib/types";
import OutcomePanel from "../OutcomePanel";
import LeadCardLayer1 from "./LeadCardLayer1";
import type { DetailSection } from "../LeadDetail/LeadDetail";

interface Props {
  item: QueueItem;
  onLogged: (event: InteractionEvent) => void;
  onExpand: (section: DetailSection) => void;
  submitLabel?: string;
}

const EXPANDERS: { section: DetailSection; label: string }[] = [
  { section: "script", label: "Full script" },
  { section: "objections", label: "Objection handling" },
  { section: "role", label: "Role detail" },
];

export default function LeadCard({ item, onLogged, onExpand, submitLabel }: Props) {
  return (
    <article className="lead-card">
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
