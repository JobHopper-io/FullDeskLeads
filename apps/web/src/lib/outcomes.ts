// Outcome dispositions and follow-up date math for the outcome sheet. Mirrors the enums in
// migration 0022 and apps/api's POST /outcomes.

export type Disposition =
  | "no_answer" | "left_voicemail" | "gatekeeper" | "connected" | "no_interest" | "follow_up_later"
  | "job_order" | "bad_contact_data" | "not_a_fit" | "do_not_contact" | "meeting_set";

/**
 * How a disposition treats the follow-up:
 *  default   — pre-filled, changeable (no_answer: next business day)
 *  suggested — pre-filled or offered, may be skipped
 *  required  — a date must be chosen, no skipping
 *  fixed     — set by the system, not chosen (no_interest)
 *  none      — no follow-up
 */
export type FollowUpMode = "default" | "suggested" | "required" | "fixed" | "none";

export const DISPOSITIONS: { value: Disposition; label: string; followUp: FollowUpMode }[] = [
  { value: "no_answer", label: "No answer", followUp: "default" },
  { value: "left_voicemail", label: "Left voicemail", followUp: "suggested" },
  { value: "gatekeeper", label: "Gatekeeper", followUp: "none" },
  { value: "connected", label: "Connected", followUp: "suggested" },
  { value: "no_interest", label: "No interest", followUp: "fixed" },
  { value: "follow_up_later", label: "Follow up later", followUp: "required" },
  { value: "job_order", label: "Job order", followUp: "none" },
  { value: "meeting_set", label: "Meeting set", followUp: "required" },
  { value: "bad_contact_data", label: "Bad contact data", followUp: "none" },
  { value: "not_a_fit", label: "Not a fit", followUp: "none" },
  { value: "do_not_contact", label: "Do not contact", followUp: "none" },
];

export const NOT_A_FIT_REASONS = [
  { value: "wrong_size", label: "Wrong size" },
  { value: "wrong_industry", label: "Wrong industry" },
  { value: "self_performs", label: "Self-performs" },
  { value: "existing_client", label: "Existing client" },
  { value: "too_far", label: "Too far" },
  { value: "other", label: "Other" },
] as const;

export const MAX_NO_ANSWER_ATTEMPTS = 4;
// Placeholder: the tenant-level "close vs defer on no interest" rule doesn't exist yet.
export const NO_INTEREST_DEFER_DAYS = 30;

export type Shortcut = "tomorrow" | "3d" | "1w" | "custom";
export const SHORTCUTS: { value: Shortcut; label: string }[] = [
  { value: "tomorrow", label: "Tomorrow" },
  { value: "3d", label: "In 3 days" },
  { value: "1w", label: "1 week" },
  { value: "custom", label: "Custom" },
];

// Computed follow-up dates land at 9:00 local; a Saturday or Sunday rolls forward to Monday.
// Custom dates never go through here — they stay exactly as picked. log_outcome (0023) enforces the
// same roll server-side, so this is what the sheet previews, not the only line of defence.
const at9 = (d: Date) => (d.setHours(9, 0, 0, 0), d);
const inDays = (days: number, from = new Date()) => at9(new Date(from.getFullYear(), from.getMonth(), from.getDate() + days));

function rollToWeekday(d: Date): Date {
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

export const nextBusinessDay = (from = new Date()) => rollToWeekday(inDays(1, from));

export function shortcutDate(s: Exclude<Shortcut, "custom">, from = new Date()): Date {
  return rollToWeekday(inDays({ tomorrow: 1, "3d": 3, "1w": 7 }[s], from));
}

export const deferDate = () => rollToWeekday(inDays(NO_INTEREST_DEFER_DAYS));

/** "Returns to My Day on Thu, Sep 24, no manual reminder needed." — the date is the real computed one. */
export function confirmationSentence(when: Date, withTime: boolean): string {
  const day = when.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  const time = withTime ? ` at ${when.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : "";
  return `Returns to My Day on ${day}${time}, no manual reminder needed.`;
}
