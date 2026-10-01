import type { QueueItem } from "./types";
// The plant archetype library and the spec's fixed objection set (pure data files, no deps), so the screens show exactly
// what generation would be given, never a second copy of it.
import { ARCHETYPES, archetypeForEmployer, industryWordFor } from "../../../../packages/pipeline/src/intelligence/sources";
import { fixedObjections, type FixedObjection } from "../../../../packages/pipeline/src/intelligence/objections";
import { DESCRIPTORS, LIGHT_CLOSE, LIGHT_CLOSE_GUIDED, PLANT_LAYER, busyReply, gapLine, whoReply } from "../../../../packages/pipeline/src/intelligence/plant";

type Archetype = keyof typeof ARCHETYPES;

// Roles whose daily work the archetype's equipment actually describes, keyed per archetype so a word that means
// "floor" at one archetype (e.g. "project manager" at a GC) can't leak into another's unrelated titles (IEM has its
// own "Senior Capital Project Manager", an office role there). Office roles (sales, finance, HR, IT, purchasing,
// preconstruction/estimating) never match.
const PLANT_FLOOR: Partial<Record<Archetype, RegExp>> = {
  SWITCHGEAR_ASSEMBLY: /field service|test supervisor|quality control|production (controller|planner)|materials supervisor|site supervisor|manufacturing engineer|maintenance|technician|welder|machinist|fitter|operator/i,
  STEEL_POLE_STRUCTURE_FAB: /field service|test supervisor|quality control|production (controller|planner)|materials supervisor|site supervisor|manufacturing engineer|maintenance|technician|welder|machinist|fitter|operator/i,
  // People actually on a jobsite (superintendent/foreman/carpenter/surveyor/MEP coordinator/safety/the PM chain that
  // runs it day to day), versus the back-office roles (Accounting, IT, Preconstruction/estimating) that never match.
  COMMERCIAL_CONSTRUCTION_GC: /superintendent|\bforeman\b|\bcarpenter\b|\bconcrete\b|surveyor|technician|m\.?e\.?p\.? coordinator|quality control|project (?:executive|manager)|owner.s representative|safety assistant|construction management intern/i,
};

/**
 * The plant archetype for the equipment chips: from the posting's operating employer (a Crest posting's Lever
 * department, so a DIS-TRAN Steel posting gets DIS-TRAN's plant), never from the parent company's name.
 */
export const plantArchetypeOf = (item: QueueItem): Archetype | null => archetypeForEmployer(item.employer);

/** The archetype's equipment set, only for a plant-floor role whose employer the library knows. */
export function equipmentFor(item: QueueItem): string[] | null {
  const archetype = plantArchetypeOf(item);
  return archetype && PLANT_FLOOR[archetype]?.test(item.roleTitle) ? ARCHETYPES[archetype].equipment : null;
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
 * The objections stored on the lead; without them, the set for the posting's operating employer (the plant
 * archetype's industry word when there is one, otherwise the company's own business — sources.ts's industryWordFor).
 * No archetype also means no trade applicant pool to guess at, so {applicants} is always "general applicants".
 */
export function objectionsFor(item: QueueItem): FixedObjection[] {
  if (isPairs(item.objections)) return item.objections;
  return fixedObjections(industryWordFor(item.employer), item.roleTitle, !!plantArchetypeOf(item));
}

/**
 * The fixed plant layer (plant.ts) for the lead's operating employer's archetype. who/busy/lightClose aren't
 * plant-specific, so they're always present (who is domain-neutral without an archetype, never claiming
 * "manufacturing"); descriptor/whyHard/showYourWork/gap are the plant-floor content and stay null with no archetype
 * (or, for why-hard/show-your-work/equipment, off a plant floor role) rather than force-fitting anything.
 */
export function plantLayerFor(item: QueueItem) {
  const archetype = plantArchetypeOf(item);
  const layer = archetype ? PLANT_LAYER[archetype] : undefined;
  const floor = !!archetype && !!PLANT_FLOOR[archetype]?.test(item.roleTitle);
  return {
    descriptor: (item.employer && DESCRIPTORS[item.employer]?.text) || null,
    whyHard: (floor && layer?.whyHard) || null,
    showYourWork: (floor && layer?.showYourWork) || null,
    gap: archetype ? gapLine(archetype, item.roleTitle, item.jobDescription?.map((l) => l.text).join(" ") ?? "") : null,
    lightClose: LIGHT_CLOSE,
    lightCloseGuided: LIGHT_CLOSE_GUIDED,
    busy: busyReply(item.openingCount),
    who: whoReply(item.roleTitle, archetype ? ARCHETYPES[archetype].domain : null),
  };
}

/**
 * How much the lead has to show: 2 = a generated opening script, 1 = only stored questions/objections or equipment
 * chips, 0 = nothing but placeholders. My Day ranks by this first, then by the API's score order.
 */
export const contentTier = (item: QueueItem): number =>
  item.openingScript ? 2 : discoveryQuestionsOf(item) || isPairs(item.objections) || equipmentFor(item) ? 1 : 0;
