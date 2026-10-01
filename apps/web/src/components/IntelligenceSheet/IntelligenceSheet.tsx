import type { ReactNode } from "react";
import { startOfToday } from "../../lib/leads";
import { SIGNAL_TYPE, confidenceLabel } from "../../lib/provenance";
import type { QueueItem } from "../../lib/types";
import FunctionMatchTag from "../FunctionMatchTag";
import { discoveryQuestionsOf, equipmentFor, objectionsFor, plantArchetypeOf, plantLayerFor } from "../../lib/intelligence";

// The Intelligence Sheet's panels (spec Format 1), shared by My Day (Figure 8.2's layout) and the lead page (Figure 8.1's
// order). Each panel renders the same content and the same placeholder wording wherever it appears.

const DAY = 86_400_000;
/** Whole days from a date (YYYY-MM-DD or ISO) to today, in the recruiter's own day. */
const daysSince = (date: string) => {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return Math.max(0, Math.round((startOfToday() - new Date(y, m - 1, d).getTime()) / DAY));
};
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function money(n: number, currency: string | null) {
  const cents = Number.isInteger(n) ? 0 : 2;
  const amount = n.toLocaleString("en-US", { minimumFractionDigits: cents, maximumFractionDigits: 2 });
  return !currency || currency === "USD" ? `$${amount}` : `${currency} ${amount}`;
}
const PER = { hour: "/hr", year: "/yr" } as const;
const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
const postedAgo = (days: number) => (days === 0 ? "Posted today" : `Posted ${plural(days, "day")} ago`);
const seatsOf = (item: QueueItem) => [item.openingCount !== null && plural(item.openingCount, "seat"), item.shift].filter(Boolean).join(", ");

// Shown wherever intelligence generation hasn't produced anything yet.
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

export function Panel({ id, label, aside, className = "", children }: { id?: string; label: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section id={id} className={`md-panel ${className}`}>
      <div className="md-panel-head">
        <h3 className="md-label">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/** Company, role and the primary contact, with the phone as the largest element (spec 7.1). */
export function LeadCard({ item, tags }: { item: QueueItem; tags?: ReactNode }) {
  const { phone, name, title } = item.contact;
  const days = item.postedDate ? daysSince(item.postedDate) : null;
  const seats = seatsOf(item);
  return (
    <article className="md-panel md-lead">
      <div className="md-lead-main">
        <div className="md-tags">
          {item.freshnessBand && <span className="md-tag">{item.freshnessBand}{days !== null && ` · ${plural(days, "day")}`}</span>}
          <FunctionMatchTag item={item} />
          {tags}
        </div>
        <h2 className="md-company">{item.company}</h2>
        <div className="md-role">
          {item.roleTitle}
          {seats && <> <span aria-hidden="true">·</span> {seats}</>}
        </div>
        {item.location && <div className="md-meta">{item.location}</div>}
      </div>
      <div className="md-contact">
        <div className="md-label">Primary hiring contact</div>
        <div className="md-contact-name">{name}</div>
        <div className="md-contact-title">{title}</div>
        {phone ? <a className="md-phone" href={tel(phone)}>{phone}</a> : <span className="md-phone missing">No phone on file</span>}
        <div className="md-contact-meta">
          {item.phoneVerifiedAt ? `Verified ${daysSince(item.phoneVerifiedAt) === 0 ? "today" : `${plural(daysSince(item.phoneVerifiedAt), "day")} ago`}` : "Not verified yet"}
          {" · "}
          {confidenceLabel(item.contactConfidence)}
        </div>
      </div>
    </article>
  );
}

function Stat({ value, label, accent }: { value: string | null; label: string; accent?: boolean }) {
  return (
    <div className={accent ? "md-stat accent" : "md-stat"}>
      <div className="md-stat-value">{value ?? <span className="md-dash" aria-label="Not known">—</span>}</div>
      <div className="md-stat-label">{label}</div>
    </div>
  );
}

/** Req age, openings, posted pay, contacts on file: the four facts that shape the call. */
export function EvidenceStrip({ item, className = "md-stats" }: { item: QueueItem; className?: string }) {
  const days = item.postedDate ? daysSince(item.postedDate) : null;
  return (
    <div className={className}>
      <Stat accent value={days !== null ? postedAgo(days) : null} label={SIGNAL_TYPE} />
      <Stat value={item.openingCount !== null ? String(item.openingCount) : null} label={item.shift ? `openings · ${item.shift}` : "openings"} />
      <Stat
        value={item.pay ? money(item.pay.min, item.pay.currency) : null}
        label={item.pay ? `floor · to ${money(item.pay.max, item.pay.currency)}${item.pay.interval ? PER[item.pay.interval] : ""}` : "pay floor"}
      />
      <Stat value={String(1 + item.alternateContacts.length)} label="contacts on file" />
    </div>
  );
}

/** THE PLANT: descriptor, the archetype's equipment, why this seat is hard. */
export function PlantBand({ item }: { item: QueueItem }) {
  const equipment = equipmentFor(item);
  const plant = plantLayerFor(item);
  return (
    <Panel className="md-plant" label="The plant" aside={<span className="md-label-aside">What you know before he says a word</span>}>
      {plant?.descriptor ? <p className="md-descriptor">{plant.descriptor}</p> : <Placeholder>Plant descriptor isn't generated yet.</Placeholder>}
      {equipment ? (
        <ul className="md-chips" aria-label="Typical equipment">
          {equipment.map((e) => <li key={e}>{e}</li>)}
        </ul>
      ) : plantArchetypeOf(item) ? null : (
        <Placeholder>No plant archetype on file for this company yet, so no equipment set.</Placeholder>
      )}
      <div className="md-hard">
        <strong>Why this one is hard:</strong>{" "}
        {plant?.whyHard ?? (
          <Placeholder>{plantArchetypeOf(item) ? "Plant-floor roles only; this one isn't." : "No plant archetype on file for this company yet."}</Placeholder>
        )}
      </div>
    </Panel>
  );
}

export function Opening({ item, id, label }: { item: QueueItem; id?: string; label: string }) {
  return (
    <section id={id} className="md-opening">
      <h3 className="md-label">{label}</h3>
      {item.openingScript ? <p>{item.openingScript}</p> : <Placeholder>Opening script isn't generated yet.</Placeholder>}
    </section>
  );
}

/** Show you know the floor: pick one, asked as a question. `children` go under the lines (My Day's buttons). */
export function ShowYourWork({ item, className = "", children }: { item: QueueItem; className?: string; children?: ReactNode }) {
  const plant = plantLayerFor(item);
  return (
    <Panel className={`md-floor ${className}`} label="Show you know the floor — ask, don't tell" aside={plant?.showYourWork && <span className="md-label-aside">Pick one</span>}>
      {plant?.showYourWork ? (
        plant.showYourWork.map((q) => <blockquote key={q}>“{q}”</blockquote>)
      ) : (
        <Placeholder>
          {plantArchetypeOf(item) ? "Show-your-work questions are for plant-floor roles; this one isn't." : "No plant archetype on file for this company yet."}
        </Placeholder>
      )}
      {children}
    </Panel>
  );
}

/** The gap line and its follow-on, or why there isn't one. */
export function GapText({ item }: { item: QueueItem }) {
  const plant = plantLayerFor(item);
  return plant?.gap ? (
    <>
      <p className="md-gap-line">{plant.gap}</p>
      <p className="md-gap-line">That gap is your opening question.</p>
    </>
  ) : (
    <Placeholder>
      {plantArchetypeOf(item)
        ? "No gap line: it compares a maintenance posting with what the plant runs, and this isn't one."
        : "No plant archetype on file for this company yet."}
    </Placeholder>
  );
}

export function Pushback({ item, id, className = "" }: { item: QueueItem; id?: string; className?: string }) {
  return (
    <Panel id={id} className={`md-pushback ${className}`} label="If he pushes back">
      <dl className="md-objections">
        {objectionsFor(item).map((o) => (
          <div key={o.objection}>
            <dt>“{o.objection}”</dt>
            <dd>“{o.response}”</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

/** What to say to the front desk to get back to this contact (Figure 8.1's routing strip). */
function gatekeeperLine(item: QueueItem) {
  const first = item.contact.name.trim().split(/\s+/)[0];
  const several = item.openingCount !== null && item.openingCount > 1;
  return `Calling ${first} back about the ${item.roleTitle.trim()} opening${several ? "s" : ""}.`;
}

/** Who else to try. `gatekeeper` adds the front-desk line in the label row, as Figure 8.1 prints it. */
export function NotTheOne({ item, gatekeeper = false }: { item: QueueItem; gatekeeper?: boolean }) {
  return (
    <Panel
      className="md-alternates"
      label="If he's not the one"
      aside={gatekeeper && <span className="md-label-aside md-gatekeeper">Gatekeeper line: “{gatekeeperLine(item)}”</span>}
    >
      {item.alternateContacts.length ? (
        <ul>
          {item.alternateContacts.map((c) => (
            <li key={`${c.name}${c.phone}`}>
              <span><strong>{c.name}</strong> <span className="md-alt-title">{c.title}</span></span>
              {c.phone ? <a href={tel(c.phone)}>{c.phone}</a> : <span className="md-alt-title">no phone</span>}
            </li>
          ))}
        </ul>
      ) : (
        <Placeholder>No alternate contacts identified yet.</Placeholder>
      )}
    </Panel>
  );
}

/**
 * Risk flags (spec 7.1, Appendix C), only what the lead actually tells us: an unknown is shown as unknown, never guessed.
 * "Owns the req" stays "Function match" (the same claim as the tag, no stronger); site versus corporate isn't sent to
 * the client, so it is always unknown here.
 */
export function Flags({ item }: { item: QueueItem }) {
  const flags: { label: string; risk: boolean }[] = [
    ...(item.functionMatch ? [{ label: "Function match", risk: false }] : []),
    ...(item.freshnessBand === "stale" ? [{ label: "Req going cold", risk: true }] : []),
    { label: "Site or corporate unknown", risk: true },
    { label: "Union status unknown", risk: true },
  ];
  return (
    <ul className="ls-flags" aria-label="Flags">
      {flags.map((f) => <li key={f.label} className={f.risk ? "risk" : undefined}>{f.label}</li>)}
    </ul>
  );
}

/** The opening itself (Figure 8.1's right column): role, the posting's facts, then the gap. */
export function TheOpening({ item }: { item: QueueItem }) {
  const days = item.postedDate ? daysSince(item.postedDate) : null;
  const pay = item.pay && `${money(item.pay.min, item.pay.currency)}–${money(item.pay.max, item.pay.currency)}${item.pay.interval ? PER[item.pay.interval] : ""}`;
  const facts = [seatsOf(item), pay, days !== null && postedAgo(days), SIGNAL_TYPE].filter(Boolean).join(" · ");
  return (
    <Panel className="ls-opening md-gap" label="The opening">
      <div className="ls-role">{item.roleTitle}</div>
      <div className="md-meta">{facts}</div>
      <div className="ls-gap">
        <h4 className="md-label">The gap</h4>
        <GapText item={item} />
      </div>
    </Panel>
  );
}

/** Light close (Figure 8.1: last on the left, gold). */
export function LightClose({ item }: { item: QueueItem }) {
  const close = plantLayerFor(item)?.lightClose;
  return (
    <section className="ls-close">
      <h3 className="md-label">Light close</h3>
      {close ? <p>“{close}”</p> : <Placeholder>The close isn't generated yet.</Placeholder>}
    </section>
  );
}
