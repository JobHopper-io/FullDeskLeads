import { Link } from "react-router";
import { isActive, isDue, startOfToday, useLeads } from "../lib/leads";
import type { QueueItem } from "../lib/types";
import OutcomePanel from "../components/OutcomePanel";
import JobDescription from "../components/JobDescription";
import { EvidenceStrip, GapText, LeadCard, NotTheOne, Opening, Panel, PlantBand, Pushback, ShowYourWork } from "../components/IntelligenceSheet/IntelligenceSheet";
import { contentTier } from "../lib/intelligence";

// Zero-padded to the width of the total, so it reads "07 of 36" and never shifts as it counts up.
const pad = (n: number, width: number) => String(n).padStart(Math.max(2, width), "0");

// My Day (spec Figure 8.2): the top of today's queue as the Intelligence Sheet. Left column is the call in order
// (who, the plant, the opener, show-your-work, log it); right column is what you glance at (numbers, the gap,
// objections, who else to try).
export default function MyDayPage() {
  const { items, worked, logged } = useLeads();

  const today = startOfToday();
  // A bare lead (placeholders only) never opens the day ahead of one with content; the sort is stable, so the API's
  // score order still decides within each tier.
  const queue = items!.filter((i) => isActive(i) && isDue(i) && !worked.has(i.id)).sort((a, b) => contentTier(b) - contentTier(a));
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
  const detail = (section: string) => `/leads/${item.id}?section=${section}`;

  return (
    <div className="md-body">
      <div className="md-col">
        <LeadCard item={item} />
        <PlantBand item={item} />
        <Opening item={item} label="Suggested opening" />
        <ShowYourWork item={item} className="grow">
          <div className="md-buttons">
            <Link className="md-button" to={detail("role")}>Discovery questions</Link>
            <Link className="md-button" to={detail("script")}>Full script</Link>
            <Link className="md-button" to={detail("objections")}>Objection handling</Link>
            <JobDescription item={item} className="md-button" />
          </div>
        </ShowYourWork>
        <div className="md-panel md-log">
          <OutcomePanel item={item} onLogged={onLogged} submitLabel="Save + next lead" pinnedSave />
        </div>
      </div>

      <div className="md-col">
        <EvidenceStrip item={item} />
        <Panel className="md-gap" label="The gap">
          <GapText item={item} />
        </Panel>
        <Pushback item={item} className="grow" />
        <NotTheOne item={item} />
      </div>
    </div>
  );
}
