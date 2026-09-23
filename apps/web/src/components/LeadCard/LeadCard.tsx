import type { InteractionEvent, QueueItem } from "../../lib/types";
import OutcomeButton from "../OutcomeButton";
import LeadCardLayer1 from "./LeadCardLayer1";

interface Props {
  item: QueueItem;
  logged: InteractionEvent | null;
  onLogged: (event: InteractionEvent) => void;
}

export default function LeadCard({ item, logged, onLogged }: Props) {
  return (
    <article className="lead-card">
      <LeadCardLayer1 item={item} />
      <OutcomeButton leadAssignmentId={item.id} logged={logged} onLogged={onLogged} />
    </article>
  );
}
