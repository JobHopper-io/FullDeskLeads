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
  /** Parsed from the posting; each null when the posting did not clearly say (see apps/api's QueueItem). */
  openingCount: number | null;
  shift: string | null;
  pay: { min: number; max: number; interval: "hour" | "year" | null; currency: string | null } | null;
  payContext: string | null;
  /** The posting's own description, split at sentences and list items only; null when none is stored. */
  jobDescription: { text: string; item: boolean }[] | null;
  /** The posting's operating employer (a Crest posting's Lever department, else the company); see apps/api. */
  employer: string | null;
  whyNow: string | null;
  /** Assigned only to fill the day, outside this recruiter's saved Specialty Filters. */
  outsideFilters: boolean;
  // Layer 2 detail (see apps/api's QueueItem).
  contactId: string;
  contactFlaggedAt: string | null;
  /** The primary contact is function-tier (see apps/api's QueueItem); false for site/HR/untiered. */
  functionMatch: boolean;
  signalFirstSeen: string;
  /** The posting's own date, YYYY-MM-DD; null when the board gave none. */
  postedDate: string | null;
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

/** One row of GET /opportunities — a lead outside every recruiter's own My Day (apps/api's OpportunityItem). */
export interface OpportunityItem {
  leadId: string;
  company: string;
  roleTitle: string;
  location: string | null;
  industry: string;
  roleFamily: string | null;
  hasArchetype: boolean;
  contentTier: 0 | 1 | 2;
  contentTierName: "full" | "partial" | "bare";
  /** The recruiter has saved Specialty Filters and this lead doesn't match them. */
  outsideFilters: boolean;
  freshnessBand: "fresh" | "recent" | "ageing" | "stale";
  postedDate: string | null;
  signalFirstSeen: string;
  contactStatus: "verified" | "pending" | "none";
  whyNowPreview: string | null;
}

export interface OpportunitiesResponse {
  items: OpportunityItem[];
  nextCursor: string | null;
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

/** A recruiter's saved Specialty Filters (GET/PUT /me/preferences). Empty list = no filter on that axis. */
export interface SpecialtyPreferences {
  industry: string[];
  roleFamily: string[];
  freshness: string[];
  tier: string[];
  archetype: "any" | "yes" | "no";
}

export interface PreferencesResponse {
  /** False only for a seat that never saved anything; a saved "Clear filters" is configured with every list empty. */
  configured: boolean;
  preferences: SpecialtyPreferences;
  fallbackBehavior: "expand_to_general_pool";
  options: { industry: string[] };
}
