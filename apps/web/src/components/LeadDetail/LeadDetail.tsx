import { useEffect, useRef, useState } from "react";
import { apiPost } from "../../lib/apiClient";
import { SIGNAL_TYPE, confidenceLabel, formatDate } from "../../lib/provenance";
import type { InteractionEvent, QueueItem } from "../../lib/types";
import OutcomePanel from "../OutcomePanel";
import StateTag from "../StateTag";
import FunctionMatchTag from "../FunctionMatchTag";
import ViewToggle from "../ViewToggle";
import JobDescription from "../JobDescription";
import { discoveryQuestionsOf, objectionsFor, plantLayerFor } from "../../lib/intelligence";

export type DetailSection = "script" | "role" | "objections";

interface Props {
  item: QueueItem;
  /** Section to scroll to on open; none = top. */
  section: DetailSection | null;
  onBack: () => void;
  onLogged: (event: InteractionEvent) => void;
  /** Called after a successful flag so the queue can mark every lead sharing this contact. */
  onFlagged: (contactId: string, flaggedAt: string) => void;
}

// Shown wherever intelligence generation hasn't produced anything yet (same idea as the card's why-now line).
export function Placeholder({ children }: { children: string }) {
  return <p className="l2-placeholder">{children}</p>;
}

/** The spec's fixed discovery questions stored on the lead, or the placeholder when it has none. */
export function DiscoveryQuestions({ item }: { item: QueueItem }) {
  const questions = discoveryQuestionsOf(item);
  return questions ? (
    <ol className="l2-questions">{questions.map((q) => <li key={q}>{q}</li>)}</ol>
  ) : (
    <Placeholder>Discovery questions aren't generated yet.</Placeholder>
  );
}

// Layer 2 (spec 11.2): header + contact block pinned at the top so the phone number is never lost;
// contact/provenance left, script + role intelligence + alternates centre, objections right.
export default function LeadDetail({ item, section, onBack, onLogged, onFlagged }: Props) {
  const [flagging, setFlagging] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);
  const { phone, name, title, email } = item.contact;
  const close = plantLayerFor(item)?.lightClose;

  // One view, scrolled to whichever section's button opened it — below the pinned header, not under it.
  useEffect(() => {
    const top = topRef.current;
    if (top) document.documentElement.style.setProperty("--l2-top", `${top.offsetHeight + 16}px`);
    if (section) document.getElementById(section)?.scrollIntoView({ block: "start" });
    return () => {
      document.documentElement.style.removeProperty("--l2-top");
    };
  }, [section]);

  // Record-only: writes a contact flag, logs no outcome and doesn't touch the lead's state.
  async function reportBadContact() {
    setFlagging(true);
    setFlagError(null);
    try {
      const { contactId, flaggedAt } = await apiPost<{ contactId: string; flaggedAt: string }>(`/lead-assignments/${item.id}/contact-flag`, {});
      onFlagged(contactId, flaggedAt);
    } catch (err) {
      setFlagError((err as Error).message);
    } finally {
      setFlagging(false);
    }
  }

  return (
    <div className="l2">
      <div className="l2-top" ref={topRef}>
        <div className="l2-top-row">
          <button className="link-button" onClick={onBack}>← Back</button>
          <div className="l2-top-actions">
            <JobDescription item={item} className="l2-jd-button" />
            <ViewToggle id={item.id} current="intelligence" />
          </div>
        </div>
        <h2 className="l2-company">{item.company}</h2>
        <div className="l2-role">
          {item.roleTitle}
          {item.location ? ` · ${item.location}` : ""}
          <FunctionMatchTag item={item} />
          {item.freshnessBand && <span className={`tag ${item.freshnessBand}`}>{item.freshnessBand}</span>}
          <StateTag state={item.state} />
        </div>
        <div className="l2-contact">
          {phone ? <a className="l2-phone" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a> : <span className="l2-phone missing">No phone on file</span>}
          <span className="l2-contact-name">{name} · {title}</span>
          {email && <a className="l2-email" href={`mailto:${email}`}>{email}</a>}
        </div>
      </div>

      <OutcomePanel item={item} onLogged={onLogged} />

      <div className="l2-cols">
        <div className="l2-left">
          <section id="provenance">
            <h3>Contact &amp; source</h3>
            <dl className="l2-facts">
              <dt>Signal</dt><dd>{SIGNAL_TYPE}</dd>
              <dt>First seen</dt><dd>{formatDate(item.signalFirstSeen)}</dd>
              <dt>Contact confidence</dt><dd>{confidenceLabel(item.contactConfidence)}</dd>
              <dt>Phone verified</dt><dd>{item.phoneVerifiedAt ? formatDate(item.phoneVerifiedAt) : "Not verified yet"}</dd>
            </dl>
            {item.contactFlaggedAt ? (
              <p className="l2-flagged" role="status">Reported as bad contact info on {formatDate(item.contactFlaggedAt)}. Thanks, this contact is flagged for your team.</p>
            ) : (
              <div className="l2-flag">
                <button className="chip" onClick={reportBadContact} disabled={flagging}>{flagging ? "Reporting…" : "Report bad contact info"}</button>
                {flagError && <span className="error">{flagError}</span>}
              </div>
            )}
          </section>
        </div>

        <div className="l2-centre">
          <section id="script">
            <h3>Opening script</h3>
            {item.openingScript ? <p className="l2-script">{item.openingScript}</p> : <Placeholder>Opening script isn't generated yet.</Placeholder>}
            {close && <p className="l2-close"><strong>Light close:</strong> “{close}”</p>}
          </section>
          <section id="role">
            <h3>Discovery questions</h3>
            <DiscoveryQuestions item={item} />
          </section>
          <section id="alternates">
            <h3>Alternate contacts</h3>
            {item.alternateContacts.length ? (
              <ul className="l2-alternates">
                {item.alternateContacts.map((c) => (
                  <li key={`${c.name}${c.phone}`}><strong>{c.name}</strong> · {c.title} · {c.phone ?? "no phone"}</li>
                ))}
              </ul>
            ) : (
              <Placeholder>No alternate contacts identified yet.</Placeholder>
            )}
          </section>
        </div>

        <div className="l2-right">
          <section id="objections">
            <h3>Objection handling</h3>
            <dl className="l2-objections">
              {objectionsFor(item).map((o) => (
                <div key={o.objection}>
                  <dt>“{o.objection}”</dt>
                  <dd>“{o.response}”</dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
