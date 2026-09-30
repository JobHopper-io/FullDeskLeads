import { useRef } from "react";
import type { QueueItem } from "../lib/types";

// The posting's own words, exactly as posted: one line per sentence, list items marked. Disabled when nothing is stored.
export default function JobDescription({ item, className }: { item: QueueItem; className: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const lines = item.jobDescription;
  return (
    <>
      <button className={className} disabled={!lines} title={lines ? undefined : "No job description stored for this posting"} onClick={() => dialog.current?.showModal()}>
        Job description
      </button>
      {lines && (
        <dialog ref={dialog} className="jd" aria-labelledby={`jd-${item.id}`} onClick={(e) => e.target === dialog.current && dialog.current.close()}>
          <header className="jd-head">
            <div>
              <h2 id={`jd-${item.id}`}>{item.roleTitle}</h2>
              <p>{item.company} · the posting's own text, as posted</p>
            </div>
            <button className="link-button" onClick={() => dialog.current?.close()}>Close</button>
          </header>
          <div className="jd-body">
            {lines.map((l, i) => (
              <p key={i} className={l.item ? "jd-item" : undefined}>{l.text}</p>
            ))}
          </div>
        </dialog>
      )}
    </>
  );
}
