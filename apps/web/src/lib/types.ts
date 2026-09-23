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
  contact: { name: string; title: string; phone: string | null };
  freshnessBand: string | null;
  confidenceScore: number | null;
  whyNow: string | null;
}

export interface InteractionEvent {
  id: string;
  event_type: string;
  occurred_at: string;
}
