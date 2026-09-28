import type { QueueItem } from "./types";
// The plant archetype library and the spec's fixed objection set (pure data files, no deps), so the screens show exactly
// what generation would be given, never a second copy of it.
import { ARCHETYPES, COMPANY_SOURCES, archetypeForEmployer } from "../../../../packages/pipeline/src/intelligence/sources";
import { SPEC_SET, fixedObjections } from "../../../../packages/pipeline/src/intelligence/objections";

type Archetype = keyof typeof ARCHETYPES;

/** The archetype only when this lead's company is one the library has verified; nothing is guessed from a name. */
export const archetypeOf = (company: string): Archetype | null =>
  Object.values(COMPANY_SOURCES).find((c) => c.company === company)?.archetype ?? null;

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

/** Leads without an archetype get only the pairs that have no {industry}/{applicants} slot to fill. */
export function objectionsFor(item: QueueItem) {
  const archetype = archetypeOf(item.company);
  return archetype ? fixedObjections(archetype, item.roleTitle) : SPEC_SET.filter((o) => !/\{\w+\}/.test(o.response));
}
