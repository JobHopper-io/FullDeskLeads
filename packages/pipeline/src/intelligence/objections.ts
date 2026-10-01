/**
 * Objection handling is not generated. It is the build spec's fixed set, the four things that actually get said,
 * with Schepmont's reviewed responses copied verbatim from the Intelligence Sheet (spec Figure 8.1, v1.0 24 Sep 2026),
 * dashes included. Two slots are substituted: {industry}, where the spec's example says "foundry" (for a lead with no
 * plant archetype, sources.ts's industryWordFor gives the company's own business instead), and {applicants}, where it
 * says "general maintenance applicants" (written for a maintenance hire, so it follows the role's family — a lead with
 * no plant archetype has no trade applicant pool to guess at, so it's always "general applicants").
 */
export const SPEC_SET = [
  { objection: "We don't use agencies.", response: "Fair enough — not asking for anything today. Would twenty minutes be worth it so I know what to look for if one of these ever stalls?" },
  { objection: "We post our own.", response: "Makes sense. Are you getting {industry} people through it, or mostly {applicants}?" },
  { objection: "Too expensive.", response: "Understood. It's contingency — nothing until someone starts, 25% with a 60-day guarantee. Worth weighing against what the open seats cost in overtime." },
  { objection: "Email me something.", response: "Will do. What would you want in it — the rate, the shift, or the {industry} background?" },
];

/** Role family by title, first match wins: who a posting draws when it doesn't draw people from this industry. */
const APPLICANTS: [RegExp, string][] = [
  [/maintenance/i, "general maintenance applicants"],
  [/field service/i, "general field service applicants"],
  [/materials|warehouse|inventory/i, "general materials applicants"],
  [/planner|scheduler|production control/i, "general planning applicants"],
  [/machinist|cnc/i, "general machinist applicants"],
  [/fitter|welder/i, "general welding applicants"],
  [/equipment operator|forklift|material handl/i, "general material handling applicants"],
  [/operator/i, "general equipment operator applicants"],
];
const FALLBACK = "general applicants";
/** The trade applicant-pool guess only makes sense for a plant archetype's own trade; anything else is "general applicants". */
export const applicantsFor = (roleTitle: string, hasArchetype: boolean): string =>
  hasArchetype ? APPLICANTS.find(([rx]) => rx.test(roleTitle))?.[1] ?? FALLBACK : FALLBACK;

export interface FixedObjection { objection: string; response: string }

/** `industry` is the already-resolved word (sources.ts's industryWordFor): the archetype's for a plant lead, the company's own business otherwise. */
export function fixedObjections(industry: string, roleTitle: string, hasArchetype: boolean): FixedObjection[] {
  return SPEC_SET.map((o) => ({
    ...o,
    response: o.response.replaceAll("{industry}", industry).replaceAll("{applicants}", applicantsFor(roleTitle, hasArchetype)),
  }));
}
