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
}

export interface InteractionEvent {
  id: string;
  event_type: string;
  occurred_at: string;
  disposition: string;
  follow_up_at: string | null;
  /** no_answer attempt number this event was (null for other dispositions). */
  attempts: number | null;
  /** The lead_assignment's state after this outcome (it only ever moves forward). */
  state: string;
}
