import { useEffect, useRef, useState } from "react";
import { apiPost } from "../../lib/apiClient";
import { SIGNAL_TYPE, confidenceLabel, formatDate } from "../../lib/provenance";
import type { InteractionEvent, QueueItem } from "../../lib/types";
import OutcomePanel from "../OutcomePanel";
import StateTag from "../StateTag";
import ViewToggle from "../ViewToggle";
import JobDescription from "../JobDescription";
import {
  DiscoveryQuestions, EvidenceStrip, Flags, LeadCard, LightClose, NotTheOne, Opening, Panel, PlantBand, Pushback, ShowYourWork, TheOpening,
} from "../IntelligenceSheet/IntelligenceSheet";

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

// The lead page is the Intelligence Sheet (spec Format 1) in Figure 8.1's order, everything visible at once: the lead
// card pinned at the top so the phone is never lost, the evidence strip, the plant, then the call (open, show your work,
// then let him talk, light close) beside the opening, its gap and the pushback; routing, flags and provenance last. The
// outcome bar is pinned at the bottom so every disposition stays on screen (spec 15). Panels are shared with My Day.
export default function LeadDetail({ item, section, onBack, onLogged, onFlagged }: Props) {
  const [flagging, setFlagging] = useState(false);
  const [flagError, setFlagError] = useState<string | null>(null);
  const topRef = useRef<HTMLDivElement>(null);

  // One view, scrolled to whichever section's button opened it — below the pinned header, not under it.
  useEffect(() => {
    const top = topRef.current;
    if (top) document.documentElement.style.setProperty("--l2-top", `${top.offsetHeight + 12}px`);
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
    <div className="lead-sheet">
      <div className="ls-top" ref={topRef}>
        <div className="l2-top-row">
          <button className="link-button" onClick={onBack}>← Back</button>
          <div className="l2-top-actions">
            <JobDescription item={item} className="l2-jd-button" />
            <ViewToggle id={item.id} current="intelligence" />
          </div>
        </div>
        <LeadCard item={item} tags={<StateTag state={item.state} />} />
      </div>

      <EvidenceStrip item={item} className="md-stats ls-stats" />
      <PlantBand item={item} />

      <div className="ls-cols">
        <div className="md-col">
          <div id="script" className="ls-script">
            <Opening item={item} label="Open" />
            <ShowYourWork item={item} />
          </div>
          <Panel id="role" label="Then let him talk">
            <DiscoveryQuestions item={item} />
          </Panel>
          <LightClose item={item} />
        </div>
        <div className="md-col">
          <TheOpening item={item} />
          <Pushback id="objections" item={item} />
        </div>
      </div>

      <NotTheOne item={item} gatekeeper />
      <Flags item={item} />

      <Panel id="provenance" className="ls-provenance" label="Contact & source">
        <dl className="l2-facts">
          <dt>Signal</dt><dd>{SIGNAL_TYPE}</dd>
          <dt>First seen</dt><dd>{formatDate(item.signalFirstSeen)}</dd>
          <dt>Contact confidence</dt><dd>{confidenceLabel(item.contactConfidence)}</dd>
          <dt>Phone verified</dt><dd>{item.phoneVerifiedAt ? formatDate(item.phoneVerifiedAt) : "Not verified yet"}</dd>
          {item.contact.email && <><dt>Email</dt><dd><a href={`mailto:${item.contact.email}`}>{item.contact.email}</a></dd></>}
        </dl>
        {item.contactFlaggedAt ? (
          <p className="l2-flagged" role="status">Reported as bad contact info on {formatDate(item.contactFlaggedAt)}. Thanks, this contact is flagged for your team.</p>
        ) : (
          <div className="l2-flag">
            <button className="chip" onClick={reportBadContact} disabled={flagging}>{flagging ? "Reporting…" : "Report bad contact info"}</button>
            {flagError && <span className="error">{flagError}</span>}
          </div>
        )}
      </Panel>

      <div className="md-panel md-log ls-log">
        <OutcomePanel item={item} onLogged={onLogged} />
      </div>
    </div>
  );
}
