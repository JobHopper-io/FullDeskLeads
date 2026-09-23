import { useState } from "react";
import type { InteractionEvent, QueueItem } from "../../lib/types";
import OutcomeSheet from "../OutcomeSheet";
import LeadCardLayer1 from "./LeadCardLayer1";

interface Props {
  item: QueueItem;
  onLogged: (event: InteractionEvent) => void;
}

export default function LeadCard({ item, onLogged }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <article className="lead-card">
      <LeadCardLayer1 item={item} />
      <button className="outcome-button" onClick={() => setOpen(true)}>Log outcome</button>
      {open && (
        <OutcomeSheet
          item={item}
          onClose={() => setOpen(false)}
          onLogged={(event) => {
            setOpen(false);
            onLogged(event);
          }}
        />
      )}
    </article>
  );
}
