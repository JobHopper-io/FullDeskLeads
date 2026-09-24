import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { apiGet } from "./apiClient";
import { DISPOSITIONS } from "./outcomes";
import type { InteractionEvent, QueueItem } from "./types";

// One fetch of GET /leads (every assignment, best first) shared by all screens, so an outcome or a
// contact flag logged on one screen shows on every other without a refetch.

const ACTIVE_STATES = new Set(["new", "viewed", "contacted"]);
export const isActive = (i: QueueItem) => ACTIVE_STATES.has(i.state);
/** Due = no follow-up pending in the future (the same rule /queue applies server-side). */
export const isDue = (i: QueueItem) => !i.nextActionAt || Date.parse(i.nextActionAt) <= Date.now();
export const isOverdue = (i: QueueItem) => isActive(i) && !!i.nextActionAt && Date.parse(i.nextActionAt) < Date.now();
/** Local midnight today, in ms: "today" is the recruiter's own day. */
export const startOfToday = () => new Date().setHours(0, 0, 0, 0);
/** "no_answer" -> "No answer"; anything else (legacy event types like "contacted") is capitalized as-is. */
export const dispositionLabel = (d: string) => DISPOSITIONS.find((x) => x.value === d)?.label ?? d[0].toUpperCase() + d.slice(1).replace(/_/g, " ");

interface LeadsState {
  items: QueueItem[] | null;
  error: string | null;
  /** Assignments logged this session: My Day moves past them even when they stay due. */
  worked: Set<string>;
  notice: string | null;
  logged: (item: QueueItem, event: InteractionEvent) => void;
  flagged: (contactId: string, flaggedAt: string) => void;
}

const LeadsContext = createContext<LeadsState | null>(null);
export const useLeads = () => useContext(LeadsContext)!;

export function LeadsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [worked, setWorked] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    // StrictMode (dev) runs this twice; without the flag the slower duplicate response could land after
    // the recruiter has started working and wipe local updates.
    let cancelled = false;
    apiGet<QueueItem[]>("/leads").then(
      (rows) => !cancelled && setItems(rows),
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const logged = (item: QueueItem, event: InteractionEvent) => {
    setNotice(
      `Logged “${dispositionLabel(event.disposition)}” for ${item.company}.` +
        (event.state === "expired" ? " Out of attempts, lead expired." : event.state === "suppressed" ? " Lead suppressed." : ""),
    );
    // log_outcome sets next_action_at to exactly this event's follow_up_at (null clears it).
    setItems((prev) =>
      prev!.map((i) =>
        i.id !== item.id ? i : {
          ...i,
          state: event.state,
          nextActionAt: event.follow_up_at,
          noAnswerAttempts: i.noAnswerAttempts + (event.disposition === "no_answer" ? 1 : 0),
          notes: event.note ? [...i.notes, event.note] : i.notes,
          lastEvent: { disposition: event.disposition, note: event.note, followUpNote: event.follow_up_note, occurredAt: event.occurred_at },
        },
      ),
    );
    setWorked((prev) => new Set(prev).add(item.id));
  };

  const flagged = (contactId: string, flaggedAt: string) =>
    setItems((prev) => prev!.map((i) => (i.contactId === contactId ? { ...i, contactFlaggedAt: flaggedAt } : i)));

  return <LeadsContext.Provider value={{ items, error, worked, notice, logged, flagged }}>{children}</LeadsContext.Provider>;
}
