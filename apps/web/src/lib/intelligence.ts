import type { QueueItem } from "./types";
// The plant archetype library and the spec's fixed objection set (pure data files, no deps), so the screens show exactly
// what generation would be given, never a second copy of it.
import { ARCHETYPES, archetypeForEmployer } from "../../../../packages/pipeline/src/intelligence/sources";
import { SPEC_SET, fixedObjections, type FixedObjection } from "../../../../packages/pipeline/src/intelligence/objections";

type Archetype = keyof typeof ARCHETYPES;

// Roles whose daily work the archetype's equipment actually describes: the same list generate-intelligence.ts uses to
// decide which leads get plant intelligence. Office roles (sales, finance, HR, IT, purchasing) never match.
const PLANT_FLOOR = /field service|test supervisor|quality control|production (controller|planner)|materials supervisor|site supervisor|manufacturing engineer|maintenance|technician|welder|machinist|fitter|operator/i;

/**
 * The plant archetype for the equipment chips: from the posting's operating employer (a Crest posting's Lever
 * department, so a DIS-TRAN Steel posting gets DIS-TRAN's plant), never from the parent company's name.
 */
export const plantArchetypeOf = (item: QueueItem): Archetype | null => archetypeForEmployer(item.employer);

/** The archetype's equipment set, only for a plant-floor role whose employer the library knows. */
export function equipmentFor(item: QueueItem): string[] | null {
  const archetype = plantArchetypeOf(item);
  return archetype && PLANT_FLOOR.test(item.roleTitle) ? ARCHETYPES[archetype].equipment : null;
}

/**
 * role_intelligence holds the spec's fixed discovery questions ({ discoveryQuestions }, written by
 * scripts/generate-intelligence.ts) until real role intelligence is generated; null when the lead has none.
 */
export function discoveryQuestionsOf(item: QueueItem): string[] | null {
  const q = (item.roleIntelligence as { discoveryQuestions?: unknown } | null)?.discoveryQuestions;
  return Array.isArray(q) && q.length && q.every((x) => typeof x === "string") ? q : null;
}

const isPairs = (v: unknown): v is FixedObjection[] =>
  Array.isArray(v) && v.length > 0 && v.every((o) => typeof o?.objection === "string" && typeof o?.response === "string");

/**
 * The objections stored on the lead; without them, the set for the posting's operating employer's archetype (as the
 * pipeline resolves it), and a lead with no archetype gets only the pairs with no {industry}/{applicants} slot to fill.
 */
export function objectionsFor(item: QueueItem): FixedObjection[] {
  if (isPairs(item.objections)) return item.objections;
  const archetype = plantArchetypeOf(item);
  return archetype ? fixedObjections(archetype, item.roleTitle) : SPEC_SET.filter((o) => !/\{\w+\}/.test(o.response));
}
