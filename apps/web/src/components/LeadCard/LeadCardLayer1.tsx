import type { QueueItem } from "../../lib/types";

// Placeholder until real why-now generation exists (deferred).
const WHY_NOW_PLACEHOLDER = "Why-now intelligence isn't generated yet.";

// Layer 1 only. Visual hierarchy is deliberate: phone (dominant) > company > everything else.
export default function LeadCardLayer1({ item }: { item: QueueItem }) {
  const { phone, name, title } = item.contact;
  return (
    <>
      {phone ? (
        <a className="phone" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a>
      ) : (
        <span className="phone missing">No phone on file</span>
      )}
      <div className="company">{item.company}</div>
      <div className="row small">
        <span>{name} · {title}</span>
        {item.freshnessBand && <span className={`tag ${item.freshnessBand}`}>{item.freshnessBand}</span>}
      </div>
      <div className="small">
        Hiring: {item.roleTitle}
        {item.location ? ` · ${item.location}` : ""}
      </div>
      <div className="why-now">{item.whyNow ?? WHY_NOW_PLACEHOLDER}</div>
    </>
  );
}
