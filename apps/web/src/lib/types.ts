// Mirrors apps/api's QueueItem / RequestSeat responses.
export interface Seat {
  id: string;
  tenantId: string;
  role: "owner" | "admin" | "recruiter";
}

export interface QueueItem {
  id: string;
  state: string;
  deliveredAt: string | null;
  company: string;
  roleTitle: string;
  location: string | null;
  contact: { name: string; title: string; phone: string | null; email: string | null };
  freshnessBand: string | null;
  whyNow: string | null;
  // Layer 2 detail (see apps/api's QueueItem).
  contactId: string;
  contactFlaggedAt: string | null;
  signalFirstSeen: string;
  contactConfidence: number;
  phoneVerifiedAt: string | null;
  openingScript: string | null;
  roleIntelligence: unknown;
  objections: unknown;
  noAnswerAttempts: number;
  alternateContacts: { name: string; title: string; phone: string | null }[];
  nextActionAt: string | null;
  notes: string[];
  lastEvent: { disposition: string; note: string | null; followUpNote: string | null; occurredAt: string } | null;
}

export interface InteractionEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  disposition: string;
  note: string | null;
  follow_up_at: string | null;
  follow_up_note: string | null;
  /** no_answer attempt number this event was (null for other dispositions). */
  attempts: number | null;
  /** The lead_assignment's state after this outcome (it only ever moves forward). */
  state: string;
}

/** One row of GET /lead-assignments/:id/events (History's timeline). */
export interface TimelineEvent {
  id: string;
  occurred_at: string;
  event_type: string;
  disposition: string | null;
  note: string | null;
  follow_up_at: string | null;
  follow_up_note: string | null;
  not_a_fit_reason: string | null;
}
