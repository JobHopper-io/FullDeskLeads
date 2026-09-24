import { useState } from "react";
import type { InteractionEvent, QueueItem } from "../lib/types";
import OutcomeSheet from "./OutcomeSheet";

// The "Log outcome" button plus its sheet, shared by the lead card and the Layer 2 view.
export default function LogOutcome({ item, onLogged, submitLabel }: { item: QueueItem; onLogged: (event: InteractionEvent) => void; submitLabel?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="outcome-button" onClick={() => setOpen(true)}>Log outcome</button>
      {open && (
        <OutcomeSheet
          item={item}
          submitLabel={submitLabel}
          onClose={() => setOpen(false)}
          onLogged={(event) => {
            setOpen(false);
            onLogged(event);
          }}
        />
      )}
    </>
  );
}
