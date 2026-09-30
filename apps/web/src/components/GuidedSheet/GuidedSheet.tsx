import { useRef, useState, type ReactNode, type Ref } from "react";
import type { InteractionEvent, QueueItem } from "../../lib/types";
import OutcomePanel from "../OutcomePanel";
import ViewToggle from "../ViewToggle";
import { DiscoveryQuestions, Placeholder } from "../IntelligenceSheet/IntelligenceSheet";
import { objectionsFor, plantLayerFor } from "../../lib/intelligence";

interface Props {
  item: QueueItem;
  onBack: () => void;
  onLogged: (event: InteractionEvent) => void;
}

type StepState = "done" | "live" | "later";

// The four call stages (spec 9.2). `cue` is the instruction to the caller, not words to say.
const STEPS: { label: string; cue: string; words: (item: QueueItem) => ReactNode }[] = [
  {
    label: "Open",
    cue: "Say",
    words: (i) => (i.openingScript ? <p className="guided-words">{i.openingScript}</p> : <Placeholder>Opening script isn't generated yet.</Placeholder>),
  },
  {
    label: "Show your work",
    cue: "Pick one, ask it as a question",
    words: (i) => {
      const plant = plantLayerFor(i);
      return plant?.showYourWork ? (
        <div className="guided-lines">{plant.showYourWork.map((q) => <p key={q} className="guided-words">“{q}”</p>)}</div>
      ) : (
        <Placeholder>{plant ? "Show-your-work questions are for plant-floor roles; this one isn't." : "Show-your-work questions aren't generated yet."}</Placeholder>
      );
    },
  },
  {
    label: "Stop and ask",
    cue: "Now stop talking. The job order is in their answers. Ask, then wait.",
    words: (i) => <DiscoveryQuestions item={i} />,
  },
  {
    label: "Light close",
    cue: "Don't leave without asking",
    words: (i) => {
      const close = plantLayerFor(i)?.lightCloseGuided;
      return close ? <p className="guided-words">“{close}”</p> : <Placeholder>The close isn't generated yet.</Placeholder>;
    },
  },
];

interface Tap { key: string; label: string; answer: ReactNode }

// A reply from plant.ts (fixed copy), or the placeholder for a lead with no archetype.
const reply = (words: string | undefined, what: string) =>
  words ? <p className="guided-response">“{words}”</p> : <Placeholder>{`The response to “${what}” isn't generated yet.`}</Placeholder>;

// Right rail (spec Figure 9.2): the fixed objection set from objections.ts, then "I'm busy" (plant.ts). "Email me
// something." stays on the Intelligence view only. "Who is this?" sits under the Open step.
const pushbacksFor = (item: QueueItem): Tap[] => [
  ...objectionsFor(item)
    .filter((o) => o.objection !== "Email me something.")
    .map((o, i) => ({ key: `o${i}`, label: `“${o.objection}”`, answer: <p className="guided-response">“{o.response}”</p> })),
  { key: "busy", label: "“I'm busy.”", answer: reply(plantLayerFor(item)?.busy, "I'm busy") },
];
const whoFor = (item: QueueItem): Tap => ({ key: "who", label: "“Who is this?”", answer: reply(plantLayerFor(item)?.who, "Who is this?") });

const stateOf = (index: number, live: number): StepState => (index < live ? "done" : index === live ? "live" : "later");

// Format 2 (spec 9): the same lead as Layer 2, rendered as a stepped call runner for a caller who needs the words.
// One stage is live at a time; earlier ones are dimmed, later ones greyed. Outcome logging is the same panel as Layer 2.
export default function GuidedSheet({ item, onBack, onLogged }: Props) {
  const [live, setLive] = useState(0);
  const [openAnswer, setOpenAnswer] = useState<string | null>(null);
  const cardRefs = useRef<(HTMLElement | null)[]>([]);
  const answerRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const firstObjection = useRef<HTMLButtonElement>(null);
  const outcomeRef = useRef<HTMLDivElement>(null);
  const { phone, name, title } = item.contact;
  const pushbacks = pushbacksFor(item);
  const plant = plantLayerFor(item);

  const goTo = (index: number) => {
    setLive(index);
    cardRefs.current[index]?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  // Tap an objection: its words open and take focus, without losing the caller's place in the steps.
  const jumpTo = (key: string) => {
    setOpenAnswer((open) => (open === key ? null : key));
    requestAnimationFrame(() => {
      const answer = answerRefs.current[key];
      answer?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      answer?.focus();
    });
  };
  // One tappable interruption: its words open beneath it and take focus.
  const tap = (o: Tap, ref?: Ref<HTMLButtonElement>) => (
    <div key={o.key}>
      <button ref={ref} className="guided-objection" aria-expanded={openAnswer === o.key} aria-controls={`answer-${o.key}`} onClick={() => jumpTo(o.key)}>
        {o.label}
      </button>
      {openAnswer === o.key && (
        <div id={`answer-${o.key}`} className="guided-answer" tabIndex={-1} ref={(el) => { answerRefs.current[o.key] = el; }}>
          {o.answer}
        </div>
      )}
    </div>
  );
  const logResult = () => {
    outcomeRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
    outcomeRef.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
  };

  return (
    <div className="l2 guided">
      <div className="l2-top">
        <div className="l2-top-row">
          <button className="link-button" onClick={onBack}>← Back</button>
          <ViewToggle id={item.id} current="guided" />
        </div>
        <div className="guided-head">
          <div>
            <h2 className="l2-company">{item.company}</h2>
            <div className="l2-role">
              {item.roleTitle}
              {item.location ? ` · ${item.location}` : ""}
            </div>
          </div>
          <div className="guided-call">
            <span className="guided-contact">{name}<span className="cell-sub">{title}</span></span>
            {phone ? <a className="l2-phone" href={`tel:${phone.replace(/[^\d+]/g, "")}`}>{phone}</a> : <span className="l2-phone missing">No phone on file</span>}
            <button className="outcome-button" onClick={logResult}>Log the result</button>
          </div>
        </div>
      </div>

      <div className="guided-cols">
        <div className="guided-left">
          <nav aria-label="Call stages">
            <h3 className="eyebrow">Call stages</h3>
            <ol className="guided-rail">
              {STEPS.map((step, i) => (
                <li key={step.label}>
                  <button className="guided-step-btn" data-state={stateOf(i, live)} aria-current={i === live ? "step" : undefined} onClick={() => goTo(i)}>
                    <span className="guided-num" aria-hidden>{i < live ? "✓" : i + 1}</span>
                    {step.label}
                    {i < live && <span className="guided-done">Done</span>}
                  </button>
                </li>
              ))}
            </ol>
          </nav>
          <section>
            <h3 className="eyebrow">The plant, in one line</h3>
            {plant?.descriptor ? <p className="guided-plant">{plant.descriptor}</p> : <Placeholder>Plant descriptor isn't generated yet.</Placeholder>}
          </section>
          <section className="guided-coach">
            <h3 className="eyebrow">Coach note</h3>
            <p>Ask it, don't state it. They've run this plant for years — you're checking your understanding, not telling them their business.</p>
          </section>
        </div>

        <div className="guided-steps">
          {STEPS.map((step, i) => {
            const state = stateOf(i, live);
            return (
              <section key={step.label} ref={(el) => { cardRefs.current[i] = el; }} className="guided-card" data-state={state} aria-current={state === "live" ? "step" : undefined}>
                <h3 className="guided-eyebrow">
                  {i + 1} · {step.label} — {step.cue}
                  {state === "live" && <span className="guided-count">Step {i + 1} of {STEPS.length}</span>}
                </h3>
                {step.words(item)}
                {i === 0 && <div className="guided-who"><h4 className="eyebrow">If they ask</h4>{tap(whoFor(item))}</div>}
                {state === "live" && (
                  <div className="guided-actions">
                    {i < STEPS.length - 1 ? (
                      <button className="guided-next" onClick={() => goTo(i + 1)}>They answered — next step</button>
                    ) : (
                      <button className="guided-next" onClick={logResult}>Log the result</button>
                    )}
                    <button className="guided-secondary" onClick={() => firstObjection.current?.focus()}>They pushed back</button>
                    {i > 0 && <button className="guided-secondary" onClick={() => goTo(i - 1)}>Back a step</button>}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="guided-right">
          <section>
            <h3 className="eyebrow">If they push back — tap to jump</h3>
            <div className="guided-objections">
              {pushbacks.map((o, idx) => tap(o, idx === 0 ? firstObjection : undefined))}
            </div>
          </section>
          <section>
            <h3 className="eyebrow">The gap</h3>
            {plant?.gap ? (
              <p className="guided-plant">{plant.gap}</p>
            ) : (
              <Placeholder>{plant ? "No gap line: it compares a maintenance posting with what the plant runs, and this isn't one." : "Gap analysis isn't generated yet."}</Placeholder>
            )}
          </section>
        </div>
      </div>

      <div ref={outcomeRef} className="guided-outcome">
        <OutcomePanel item={item} onLogged={onLogged} />
      </div>
    </div>
  );
}
