import { useState } from "react";
import { apiPost } from "../lib/apiClient";
import {
  DISPOSITIONS, MAX_NO_ANSWER_ATTEMPTS, NOT_A_FIT_REASONS, NO_INTEREST_DEFER_DAYS, SHORTCUTS,
  confirmationSentence, deferDate, nextBusinessDay, shortcutDate,
  type Disposition, type Shortcut,
} from "../lib/outcomes";
import type { InteractionEvent, QueueItem } from "../lib/types";

interface Props {
  item: QueueItem;
  onLogged: (event: InteractionEvent) => void;
  /** My Day says "Save and next": saving there moves straight on to the next lead. */
  submitLabel?: string;
}

// "default" = the disposition's built-in date (no_answer: next business day); "skip" = no follow-up.
type Choice = Shortcut | "default" | "skip" | null;

const INITIAL_CHOICE: Partial<Record<Disposition, Choice>> = { no_answer: "default", left_voicemail: "3d" };

// The always-visible outcome panel (spec: on desktop every disposition stays on screen, no modal). All the
// dispositions are one row of options; only what the chosen one needs (follow-up date, reason, alternates) opens
// inline beneath it. Mount it with key={item.id} so it starts fresh on each lead.
export default function OutcomePanel({ item, onLogged, submitLabel = "Save outcome" }: Props) {
  const [disposition, setDisposition] = useState<Disposition | null>(null);
  const [choice, setChoice] = useState<Choice>(null);
  const [custom, setCustom] = useState("");
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const spec = DISPOSITIONS.find((d) => d.value === disposition);
  const attempt = item.noAnswerAttempts + 1;
  const lastAttempt = disposition === "no_answer" && attempt >= MAX_NO_ANSWER_ATTEMPTS;
  // meeting_set has no shortcuts: it's a specific date and time, so the picker is always shown.
  const isMeeting = disposition === "meeting_set";
  const picksDate = (spec?.followUp === "default" || spec?.followUp === "suggested" || spec?.followUp === "required") && !lastAttempt;

  const customDate = custom ? new Date(custom) : null;
  let when: Date | null = null;
  if (spec?.followUp === "fixed") when = deferDate();
  else if (isMeeting || choice === "custom") when = customDate && customDate.getTime() > Date.now() ? customDate : null;
  else if (choice === "default") when = nextBusinessDay();
  else if (choice && choice !== "skip") when = shortcutDate(choice);

  const needsDate = spec?.followUp === "required" || (spec?.followUp === "suggested" && choice !== "skip") || choice === "custom";
  const valid =
    !!spec &&
    (!picksDate || choice !== null || isMeeting) &&
    (!needsDate || when !== null) &&
    (spec.value !== "not_a_fit" || reason !== "");

  function pick(d: Disposition) {
    setDisposition(d);
    setChoice(INITIAL_CHOICE[d] ?? null);
    setError(null);
  }

  async function submit() {
    if (!valid || !disposition) return;
    setBusy(true);
    setError(null);
    try {
      const event = await apiPost<InteractionEvent>("/outcomes", {
        leadAssignmentId: item.id,
        disposition,
        note: note.trim() || undefined,
        followUpAt: when?.toISOString(),
        notAFitReason: disposition === "not_a_fit" ? reason : undefined,
        // The server rolls weekend defaults to Monday 9:00 in this zone; a Custom pick is left as chosen.
        followUpIsCustom: choice === "custom" || isMeeting,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      // Clear the form first so a panel that stays mounted is ready for the next outcome.
      setDisposition(null);
      setChoice(null);
      setCustom("");
      setReason("");
      setNote("");
      setBusy(false);
      onLogged(event);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <section className="outcome-panel" aria-label={`Log the result for ${item.company}`}>
      <div className="eyebrow">Log the result</div>
      <div className="disposition-grid" role="radiogroup" aria-label="Outcome">
        {DISPOSITIONS.map((d) => (
          <button key={d.value} role="radio" aria-checked={d.value === disposition} className="chip" onClick={() => pick(d.value)}>
            {d.label}
          </button>
        ))}
      </div>

      {/* Opens inline under the options once one is chosen: only what that outcome needs, then note + save. */}
      {disposition && (
        <div className="outcome-detail">
          {disposition === "no_answer" && (
            <p className="sheet-hint">
              Attempt {Math.min(attempt, MAX_NO_ANSWER_ATTEMPTS)} of {MAX_NO_ANSWER_ATTEMPTS}.
              {lastAttempt && " This is the last attempt: logging it expires the lead."}
            </p>
          )}

          {disposition === "gatekeeper" &&
            (item.alternateContacts.length ? (
              <div className="sheet-alternates">
                <strong>Try instead</strong>
                {item.alternateContacts.map((c) => (
                  <div key={`${c.name}${c.phone}`}>{c.name} · {c.title} · {c.phone ?? "no phone"}</div>
                ))}
              </div>
            ) : (
              <p className="sheet-hint">No alternate contacts on this lead yet (alternate contact discovery isn't built).</p>
            ))}

          {disposition === "not_a_fit" && (
            <label className="sheet-field">
              Reason
              <select value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">Choose a reason…</option>
                {NOT_A_FIT_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            </label>
          )}

          {disposition === "do_not_contact" && <p className="sheet-hint">Adds {item.company} to your suppression list. Applies to the whole company, not just this contact.</p>}
          {disposition === "bad_contact_data" && <p className="sheet-hint">Flags {item.contact.name} as bad data for your team. There's no data-quality queue yet, so nothing reviews it.</p>}
          {(disposition === "job_order" || isMeeting) && <p className="sheet-hint">Logged only. It isn't promoted to an Opportunity yet, because Opportunities aren't built.</p>}
          {disposition === "no_interest" && <p className="sheet-hint">Deferred {NO_INTEREST_DEFER_DAYS} days. This is a placeholder until tenants can choose to close instead.</p>}
          {disposition === "connected" && <p className="sheet-hint">Set a follow-up, or skip it.</p>}
          {disposition === "follow_up_later" && <p className="sheet-hint">A follow-up date is required.</p>}

          {picksDate && !isMeeting && (
            <div className="shortcuts" role="radiogroup" aria-label="Follow-up">
              {SHORTCUTS.map((s) => (
                <button key={s.value} role="radio" aria-checked={choice === s.value} className="chip" onClick={() => setChoice(s.value)}>{s.label}</button>
              ))}
              {spec?.followUp === "suggested" && (
                <button role="radio" aria-checked={choice === "skip"} className="chip" onClick={() => setChoice("skip")}>Skip</button>
              )}
            </div>
          )}

          {(isMeeting || (picksDate && choice === "custom")) && (
            <label className="sheet-field">
              {isMeeting ? "Meeting date and time" : "Date and time"}
              <input type="datetime-local" value={custom} min={toLocalInput(new Date())} onChange={(e) => setCustom(e.target.value)} />
            </label>
          )}

          {when && !isMeeting && <p className="sheet-confirm">{confirmationSentence(when, choice === "custom")}</p>}
          {isMeeting && when && <p className="sheet-confirm">{confirmationSentence(when, true)}</p>}
          {choice === "skip" && <p className="sheet-hint">No follow-up set. The lead stays in your queue.</p>}

          <div className="outcome-save">
            <label className="sheet-field">
              Note (optional)
              <input
                type="text"
                maxLength={280}
                value={note}
                placeholder="Spoke to Dana, wants to revisit after Q3 budget sign-off"
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
            <button className="outcome-button" onClick={submit} disabled={!valid || busy}>{busy ? "Saving…" : submitLabel}</button>
          </div>
          {error && <span className="error">{error}</span>}
        </div>
      )}
    </section>
  );
}

// datetime-local wants "YYYY-MM-DDTHH:mm" in local time (toISOString would be UTC).
function toLocalInput(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
