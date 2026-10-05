import { WORKABLE_ASSIGNMENT_STATES, type LeadAssignmentRow, type RecruiterPreferencesRow } from "@fdl/db";
import { matchesFilters, preferencesToFilters, type LeadAttributes, type SpecialtyPreferences } from "../match/leadMatch.js";

/**
 * How many workable leads a recruiter's day is considered "full" at. Only matters for the fallback: matching
 * leads are always assigned; non-matching ones only top the day up to this.
 * ponytail: one global number; make it a per-seat/tenant setting when anyone needs a different day size.
 */
export const MY_DAY_TARGET = 50;

export type AssignmentDecision =
  | { assign: true; seatId: string | null; outsideFilters: boolean }
  | { assign: false; reason: string };

export const rowToPreferences = (r: RecruiterPreferencesRow): SpecialtyPreferences => ({
  industry: r.industry_filters,
  roleFamily: r.role_family_filters,
  freshness: r.freshness_filter,
  tier: r.content_tier_filter,
  archetype: r.archetype_filter,
});

const isWorkable = (a: LeadAssignmentRow) => (WORKABLE_ASSIGNMENT_STATES as readonly string[]).includes(a.state);

/**
 * Who gets a new lead for this tenant, and whether it is a fallback. Pure: emit supplies the facts.
 *
 *  - No seat has saved preferences: exactly the pre-Settings behaviour (assigned, tenant-wide, untagged).
 *  - A configured seat matches: routed to the matching seat with the fewest workable leads. Not a fallback.
 *  - Nobody matches: fallback_behavior 'expand_to_general_pool' (the only value so far) assigns it to the least-
 *    loaded configured seat, tagged outsideFilters, but only while that seat's day is below `target`; once the day
 *    is full the lead is left unassigned and stays in Opportunities (the general pool) for anyone to pull in.
 *
 * Tier preferences are not applied here (see matchesFilters' skipTier).
 */
export function decideAssignment(input: {
  seatIds: string[];
  preferences: RecruiterPreferencesRow[];
  existing: LeadAssignmentRow[];
  attributes: LeadAttributes;
  target?: number;
}): AssignmentDecision {
  const { attributes, existing, target = MY_DAY_TARGET } = input;
  const configured = input.preferences.filter((p) => p.seat_id && input.seatIds.includes(p.seat_id));
  if (!configured.length) return { assign: true, seatId: null, outsideFilters: false };

  const load = (seatId: string) => existing.filter((a) => a.seat_id === seatId && isWorkable(a)).length;
  const leastLoaded = (rows: RecruiterPreferencesRow[]) => rows.reduce((best, r) => (load(r.seat_id!) < load(best.seat_id!) ? r : best));

  const matching = configured.filter((p) => matchesFilters(attributes, preferencesToFilters(rowToPreferences(p)), { skipTier: true }));
  if (matching.length) return { assign: true, seatId: leastLoaded(matching).seat_id, outsideFilters: false };

  const fallbackSeat = leastLoaded(configured);
  if (load(fallbackSeat.seat_id!) < target) return { assign: true, seatId: fallbackSeat.seat_id, outsideFilters: true };
  return { assign: false, reason: "outside saved filters and the day is already full" };
}
