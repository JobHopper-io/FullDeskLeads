import type { InteractionEvent, QueueItem } from "../../lib/types";
import LogOutcome from "../LogOutcome";
import LeadCardLayer1 from "./LeadCardLayer1";
import type { DetailSection } from "../LeadDetail/LeadDetail";

interface Props {
  item: QueueItem;
  onLogged: (event: InteractionEvent) => void;
  onExpand: (section: DetailSection) => void;
}

const EXPANDERS: { section: DetailSection; label: string }[] = [
  { section: "script", label: "Full script" },
  { section: "objections", label: "Objection handling" },
  { section: "role", label: "Role detail" },
];

export default function LeadCard({ item, onLogged, onExpand }: Props) {
  return (
    <article className="lead-card">
      <LeadCardLayer1 item={item} />
      <div className="card-actions">
        <LogOutcome item={item} onLogged={onLogged} />
        {EXPANDERS.map((e) => (
          <button key={e.section} className="chip" onClick={() => onExpand(e.section)}>{e.label}</button>
        ))}
      </div>
    </article>
  );
}
