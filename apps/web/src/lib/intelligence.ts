import type { QueueItem } from "./types";
// The plant archetype library and the spec's fixed objection set (pure data files, no deps), so the screens show exactly
// what generation would be given, never a second copy of it.
import { ARCHETYPES, archetypeForEmployer } from "../../../../packages/pipeline/src/intelligence/sources";
import { SPEC_SET, fixedObjections, type FixedObjection } from "../../../../packages/pipeline/src/intelligence/objections";
import { DESCRIPTORS, LIGHT_CLOSE, LIGHT_CLOSE_GUIDED, PLANT_LAYER, busyReply, gapLine, whoReply } from "../../../../packages/pipeline/src/intelligence/plant";

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

/**
 * The fixed plant layer (plant.ts) for the lead's operating employer's archetype, or null with no archetype (every
 * field then stays a placeholder). Plant-level lines (why-hard, show-your-work) only for a plant-floor role, as with
 * the equipment chips; the gap only for a maintenance posting; a field the archetype has no copy for is null.
 */
export function plantLayerFor(item: QueueItem) {
  const archetype = plantArchetypeOf(item);
  if (!archetype) return null;
  const layer = PLANT_LAYER[archetype];
  const floor = PLANT_FLOOR.test(item.roleTitle);
  return {
    descriptor: (item.employer && DESCRIPTORS[item.employer]?.text) || null,
    whyHard: (floor && layer?.whyHard) || null,
    showYourWork: (floor && layer?.showYourWork) || null,
    gap: gapLine(archetype, item.roleTitle, item.jobDescription?.map((l) => l.text).join(" ") ?? ""),
    lightClose: LIGHT_CLOSE,
    lightCloseGuided: LIGHT_CLOSE_GUIDED,
    busy: busyReply(item.openingCount),
    who: whoReply(item.roleTitle),
  };
}

/**
 * How much the lead has to show: 2 = a generated opening script, 1 = only stored questions/objections or equipment
 * chips, 0 = nothing but placeholders. My Day ranks by this first, then by the API's score order.
 */
export const contentTier = (item: QueueItem): number =>
  item.openingScript ? 2 : discoveryQuestionsOf(item) || isPairs(item.objections) || equipmentFor(item) ? 1 : 0;
