import type { ReactNode } from "react";
import { Link } from "react-router";
import { isActive, isDue, startOfToday, useLeads } from "../lib/leads";
import { SIGNAL_TYPE, confidenceLabel } from "../lib/provenance";
import type { QueueItem } from "../lib/types";
import OutcomePanel from "../components/OutcomePanel";
import FunctionMatchTag from "../components/FunctionMatchTag";
import { Generated, Placeholder } from "../components/LeadDetail/LeadDetail";
// The plant archetype library and the spec's fixed objection set (pure data files, no deps), so My Day shows exactly
// what generation would be given, never a second copy of it.
import { ARCHETYPES, COMPANY_SOURCES } from "../../../../packages/pipeline/src/intelligence/sources";
import { SPEC_SET, fixedObjections } from "../../../../packages/pipeline/src/intelligence/objections";

// Zero-padded to the width of the total, so it reads "07 of 36" and never shifts as it counts up.
const pad = (n: number, width: number) => String(n).padStart(Math.max(2, width), "0");
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

/** The archetype only when this lead's company is one the library has verified; nothing is guessed from a name. */
const archetypeOf = (company: string) => Object.values(COMPANY_SOURCES).find((c) => c.company === company)?.archetype ?? null;

/** Leads without an archetype get only the pairs that have no {industry}/{applicants} slot to fill. */
function objectionsFor(item: QueueItem) {
  const archetype = archetypeOf(item.company);
  return archetype ? fixedObjections(archetype, item.roleTitle) : SPEC_SET.filter((o) => !/\{\w+\}/.test(o.response));
}

/** role_intelligence as generation writes it ({ questions: [...] }); anything else is shown raw. */
const questionsOf = (v: unknown) => {
  const q = (v as { questions?: unknown } | null)?.questions;
  return Array.isArray(q) && q.every((x) => typeof x === "string") && q.length ? (q as string[]) : null;
};

const tel = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

function Stat({ value, label, accent }: { value: string | null; label: string; accent?: boolean }) {
  return (
    <div className={accent ? "md-stat accent" : "md-stat"}>
      <div className="md-stat-value">{value ?? <span className="md-dash" aria-label="Not known">—</span>}</div>
      <div className="md-stat-label">{label}</div>
    </div>
  );
}

function Panel({ label, aside, className = "", children }: { label: ReactNode; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`md-panel ${className}`}>
      <div className="md-panel-head">
        <h3 className="md-label">{label}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

// My Day (spec Figure 8.2): the top of today's queue as the Intelligence Sheet. Left column is the call in order
// (who, the plant, the opener, show-your-work, log it); right column is what you glance at (numbers, the gap,
// objections, who else to try).
export default function MyDayPage() {
  const { items, worked, logged } = useLeads();

  const today = startOfToday();
  const queue = items!.filter((i) => isActive(i) && isDue(i) && !worked.has(i.id));
  const current = queue[0];

  // "Lead 07 of 36": leads already worked today that have left the queue count as behind the recruiter, the rest of
  // the queue is ahead, so the total holds steady as they advance.
  const inQueue = new Set(queue.map((i) => i.id));
  const doneToday = items!.filter((i) => i.lastEvent && Date.parse(i.lastEvent.occurredAt) >= today && !inQueue.has(i.id)).length;
  const total = doneToday + queue.length;
  const dateLine = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="my-day">
      <header className="md-header">
        <div>
          <h1 className="md-title">My Day</h1>
          <p className="md-sub">
            {dateLine}
            {current && ` · lead ${pad(doneToday + 1, String(total).length)} of ${pad(total, 2)} · Intelligence view`}
          </p>
        </div>
        <div className="md-header-right">
          {/* The same lead as a step-by-step call with the words written out (Guided Sheet). */}
          {current && <Link className="md-guided" to={`/leads/${current.id}/guided`}>Guided call</Link>}
          <span className="md-mode-label" id="mode-label">Mode</span>
          <div className="md-mode" role="group" aria-labelledby="mode-label">
            <button aria-pressed="true">Manual</button>
            <button disabled title="Autopilot isn't built yet">Autopilot <span className="soon">Soon</span></button>
          </div>
        </div>
      </header>
      {current ? <Sheet key={current.id} item={current} onLogged={(event) => logged(current, event)} /> : <p className="empty">Queue clear. Nothing left to call right now.</p>}
    </div>
  );
}

function Sheet({ item, onLogged }: { item: QueueItem; onLogged: Parameters<typeof OutcomePanel>[0]["onLogged"] }) {
  const { phone, name, title } = item.contact;
  const archetype = archetypeOf(item.company);
  const days = item.postedDate ? daysSince(item.postedDate) : null;
  const seats = [item.openingCount !== null && plural(item.openingCount, "seat"), item.shift].filter(Boolean).join(", ");
  const questions = questionsOf(item.roleIntelligence);
  const detail = (section: string) => `/leads/${item.id}?section=${section}`;

  return (
    <div className="md-body">
      <div className="md-col">
        <article className="md-panel md-lead">
          <div className="md-lead-main">
            <div className="md-tags">
              {item.freshnessBand && (
                <span className="md-tag">{item.freshnessBand}{days !== null && ` · ${plural(days, "day")}`}</span>
              )}
              <FunctionMatchTag item={item} />
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

        <Panel className="md-plant" label="The plant" aside={<span className="md-label-aside">What you know before he says a word</span>}>
          <Placeholder>Plant descriptor isn't generated yet.</Placeholder>
          {archetype ? (
            <ul className="md-chips" aria-label="Typical equipment">
              {ARCHETYPES[archetype].equipment.map((e) => <li key={e}>{e}</li>)}
            </ul>
          ) : (
            <Placeholder>No plant archetype on file for this company yet, so no equipment set.</Placeholder>
          )}
          <div className="md-hard">
            <strong>Why this one is hard:</strong> <Placeholder>Why this one is hard isn't generated yet.</Placeholder>
          </div>
        </Panel>

        <section className="md-opening">
          <h3 className="md-label">Suggested opening</h3>
          {item.openingScript ? <p>{item.openingScript}</p> : <Placeholder>Opening script isn't generated yet.</Placeholder>}
        </section>

        <Panel className="md-floor grow" label="Show you know the floor — ask, don't tell" aside={questions && <span className="md-label-aside">Pick one</span>}>
          {questions ? (
            questions.map((q) => <blockquote key={q}>{q}</blockquote>)
          ) : item.roleIntelligence != null ? (
            <Generated value={item.roleIntelligence} />
          ) : (
            <Placeholder>Show-your-work questions aren't generated yet.</Placeholder>
          )}
          <div className="md-buttons">
            <Link className="md-button" to={detail("role")}>Discovery questions</Link>
            <Link className="md-button" to={detail("script")}>Full script</Link>
            <Link className="md-button" to={detail("objections")}>Objection handling</Link>
            <button className="md-button" disabled title="The job description view isn't built yet">Job description</button>
          </div>
        </Panel>

        <div className="md-panel md-log">
          <OutcomePanel item={item} onLogged={onLogged} submitLabel="Save + next lead" pinnedSave />
        </div>
      </div>

      <div className="md-col">
        <div className="md-stats">
          <Stat accent value={days !== null ? plural(days, "day") : null} label={`posting live · ${SIGNAL_TYPE}`} />
          <Stat value={item.openingCount !== null ? String(item.openingCount) : null} label={item.shift ? `openings · ${item.shift}` : "openings"} />
          <Stat
            value={item.pay ? money(item.pay.min, item.pay.currency) : null}
            label={item.pay ? `floor · to ${money(item.pay.max, item.pay.currency)}${item.pay.interval ? PER[item.pay.interval] : ""}` : "pay floor"}
          />
          <Stat value={String(1 + item.alternateContacts.length)} label="contacts on file" />
        </div>

        <Panel className="md-gap" label="The gap">
          <Placeholder>Gap analysis isn't generated yet.</Placeholder>
        </Panel>

        <Panel className="md-pushback grow" label="If he pushes back">
          <dl className="md-objections">
            {objectionsFor(item).map((o) => (
              <div key={o.objection}>
                <dt>“{o.objection}”</dt>
                <dd>“{o.response}”</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel className="md-alternates" label="If he's not the one">
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
      </div>
    </div>
  );
}
