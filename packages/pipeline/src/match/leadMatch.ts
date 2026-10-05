import { operatingEmployer } from "@fdl/sources";
import { freshnessBand, postingAgeDays, type FreshnessBand } from "@fdl/shared";
import { roleFamily, type RoleFamily } from "../enrich/roleFamily.js";
import { ARCHETYPES, NON_PLANT_INDUSTRY, archetypeForEmployer, industryWordFor } from "../intelligence/sources.js";

// The one definition of "which industry / role family / tier / freshness / plant layer is this lead", shared by
// Opportunities (filtering + the outside-your-filters badge), the Settings live count, and emit's assignment
// decision, so a saved Specialty Filter means exactly the same thing everywhere.

export type ContentTier = 0 | 1 | 2;
export const TIER_NAME: Record<ContentTier, "full" | "partial" | "bare"> = { 2: "full", 1: "partial", 0: "bare" };
export const TIER_OF_NAME: Record<string, ContentTier> = { full: 2, partial: 1, bare: 0 };

/** Every value industryWordFor() can return: each archetype's word, each NON_PLANT_INDUSTRY word, and the generic fallback. */
export const INDUSTRY_OPTIONS: string[] = [
  ...new Set([...Object.values(ARCHETYPES).map((a) => a.industry), ...Object.values(NON_PLANT_INDUSTRY), "the industry"]),
].sort((a, b) => (a === "the industry" ? 1 : b === "the industry" ? -1 : a.localeCompare(b)));

export interface LeadFacts {
  roleTitle: string;
  department: string | null;
  companyName: string;
  /** The stored raw_signals payload (operatingEmployer reads a Crest posting's department from it). */
  rawPayload: unknown;
  postedDate: string | null;
  detectedAt: string;
  openingScript: string | null;
  roleIntelligence: unknown;
  objections: unknown;
}

export interface LeadAttributes {
  industry: string;
  roleFamily: RoleFamily | null;
  hasArchetype: boolean;
  contentTier: ContentTier;
  freshnessBand: FreshnessBand;
}

/**
 * ponytail: opening_script / discoveryQuestions / objection-pairs only. The web's contentTier()
 * (apps/web/src/lib/intelligence.ts) also counts a plant-floor equipment chip (archetype + a per-archetype title
 * regex) toward tier 1; that table is presentation data, so it isn't duplicated here. A lead whose only content
 * is an equipment chip files as "bare" here but shows tier 1 on My Day. Promote PLANT_FLOOR here if that gap matters.
 */
export function contentTierOf(lead: Pick<LeadFacts, "openingScript" | "roleIntelligence" | "objections">): ContentTier {
  if (lead.openingScript) return 2;
  const dq = (lead.roleIntelligence as { discoveryQuestions?: unknown } | null)?.discoveryQuestions;
  const hasQuestions = Array.isArray(dq) && dq.length > 0;
  const obj = lead.objections;
  const hasObjectionPairs = Array.isArray(obj) && obj.length > 0 && obj.every((o) => typeof o?.objection === "string" && typeof o?.response === "string");
  return hasQuestions || hasObjectionPairs ? 1 : 0;
}

export function leadAttributes(f: LeadFacts): LeadAttributes {
  const employer = operatingEmployer(f.companyName, f.rawPayload ?? null);
  return {
    industry: industryWordFor(employer),
    roleFamily: roleFamily(f.roleTitle, f.department),
    hasArchetype: archetypeForEmployer(employer) !== null,
    contentTier: contentTierOf(f),
    freshnessBand: freshnessBand(postingAgeDays(f.postedDate ?? f.detectedAt)),
  };
}

/** null on an axis = no filter on it. AND across axes, OR within one. */
export interface FilterSet {
  industry: Set<string> | null;
  roleFamily: Set<string> | null; // RoleFamily values, "none" for no family
  tier: Set<ContentTier> | null;
  archetype: Set<"yes" | "no"> | null;
  freshness: Set<FreshnessBand> | null;
}

export const NO_FILTERS: FilterSet = { industry: null, roleFamily: null, tier: null, archetype: null, freshness: null };

/**
 * skipTier: emit assigns a lead before intelligence generation has run (a brand-new lead is always "bare" at that
 * moment), so applying a tier preference there would push every lead to the fallback. Everywhere the real tier
 * exists (Opportunities, the live count) it is applied.
 */
export function matchesFilters(a: LeadAttributes, f: FilterSet, opts: { skipTier?: boolean } = {}): boolean {
  if (f.industry && !f.industry.has(a.industry)) return false;
  if (f.roleFamily && !f.roleFamily.has(a.roleFamily ?? "none")) return false;
  if (!opts.skipTier && f.tier && !f.tier.has(a.contentTier)) return false;
  if (f.archetype && !f.archetype.has(a.hasArchetype ? "yes" : "no")) return false;
  if (f.freshness && !f.freshness.has(a.freshnessBand)) return false;
  return true;
}

/** A saved Specialty Filters value, in the API's shape. Empty list = no filter on that axis; archetype "any" = none. */
export interface SpecialtyPreferences {
  industry: string[];
  roleFamily: string[];
  freshness: string[];
  tier: string[];
  archetype: "any" | "yes" | "no";
}

export const EMPTY_PREFERENCES: SpecialtyPreferences = { industry: [], roleFamily: [], freshness: [], tier: [], archetype: "any" };

const setOrNull = <T>(list: T[]): Set<T> | null => (list.length ? new Set(list) : null);

export function preferencesToFilters(p: SpecialtyPreferences): FilterSet {
  return {
    industry: setOrNull(p.industry),
    roleFamily: setOrNull(p.roleFamily),
    tier: setOrNull(p.tier.map((t) => TIER_OF_NAME[t]).filter((t) => t !== undefined)),
    archetype: p.archetype === "any" ? null : new Set([p.archetype]),
    freshness: setOrNull(p.freshness as FreshnessBand[]),
  };
}
