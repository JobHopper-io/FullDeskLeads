import type { SpecialtyPreferences } from "./types";

// The one filter taxonomy: Opportunities' filter bar and Settings' Specialty Filters both build on this, and the
// API (opportunities.routes.ts, preferences.routes.ts) accepts exactly these values.

export interface FilterState {
  industry: string[];
  roleFamily: string[];
  tier: string[];
  archetype: string[];
  freshness: string[];
}
export const EMPTY_FILTERS: FilterState = { industry: [], roleFamily: [], tier: [], archetype: [], freshness: [] };

export const TIER_OPTIONS = ["full", "partial", "bare"];
export const ARCHETYPE_OPTIONS = [{ value: "yes", label: "Has plant layer" }, { value: "no", label: "No plant layer" }];
export const FRESHNESS_OPTIONS = ["fresh", "recent", "ageing", "stale"];
// Mirrors packages/pipeline/src/enrich/roleFamily.ts's RoleFamily union; "none" stands for a role with no family.
export const ROLE_FAMILY_OPTIONS = ["sales", "finance", "production", "maintenance", "warehouse", "fleet", "construction", "machining", "engineering", "procurement", "hr", "none"];

export const toggle = (list: string[], value: string): string[] => (list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);

export function filterLabel(category: keyof FilterState, value: string): string {
  if (category === "roleFamily") return value === "none" ? "No family" : value === "hr" ? "HR" : value[0].toUpperCase() + value.slice(1);
  if (category === "archetype") return ARCHETYPE_OPTIONS.find((a) => a.value === value)?.label ?? value;
  if (category === "industry") return value;
  return value[0].toUpperCase() + value.slice(1);
}

export const activeFilterCount = (f: FilterState) => Object.values(f).reduce((n, list) => n + list.length, 0);

/** Query params for GET /opportunities and /opportunities/count. */
export function filterParams(f: FilterState): URLSearchParams {
  const params = new URLSearchParams();
  for (const key of Object.keys(f) as (keyof FilterState)[]) if (f[key].length) params.set(key, f[key].join(","));
  return params;
}

// A saved preference holds archetype as one of any/yes/no; the filter bar holds it as a yes/no multi-select
// (both ticked = no restriction = "any").
export const toFilterState = (p: SpecialtyPreferences): FilterState => ({
  industry: p.industry, roleFamily: p.roleFamily, tier: p.tier, freshness: p.freshness, archetype: p.archetype === "any" ? [] : [p.archetype],
});

export const toPreferences = (f: FilterState): SpecialtyPreferences => ({
  industry: f.industry, roleFamily: f.roleFamily, tier: f.tier, freshness: f.freshness,
  archetype: f.archetype.length === 1 ? (f.archetype[0] as "yes" | "no") : "any",
});
