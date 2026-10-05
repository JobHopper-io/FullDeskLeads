import FilterDropdown from "./FilterDropdown";
import { ARCHETYPE_OPTIONS, FRESHNESS_OPTIONS, ROLE_FAMILY_OPTIONS, TIER_OPTIONS, filterLabel, type FilterState } from "../lib/specialtyFilters";

const opts = (category: keyof FilterState, values: string[]) => values.map((v) => ({ value: v, label: filterLabel(category, v) }));

/**
 * The five Specialty Filter dropdowns, shared by Opportunities' filter bar and Settings. Multi-select, AND across
 * categories, OR within one; each shows its selection on its own trigger.
 */
export function SpecialtyFilterControls({ filters, onChange, industryOptions }: { filters: FilterState; onChange: (next: FilterState) => void; industryOptions: string[] }) {
  const set = (category: keyof FilterState) => (next: string[]) => onChange({ ...filters, [category]: next });
  return (
    <>
      <FilterDropdown multiple label="Industry" options={opts("industry", industryOptions)} value={filters.industry} onChange={set("industry")} />
      <FilterDropdown multiple label="Role family" options={opts("roleFamily", ROLE_FAMILY_OPTIONS)} value={filters.roleFamily} onChange={set("roleFamily")} />
      <FilterDropdown multiple label="Tier" options={opts("tier", TIER_OPTIONS)} value={filters.tier} onChange={set("tier")} />
      <FilterDropdown multiple label="Plant layer" options={ARCHETYPE_OPTIONS} value={filters.archetype} onChange={set("archetype")} />
      <FilterDropdown multiple label="Freshness" options={opts("freshness", FRESHNESS_OPTIONS)} value={filters.freshness} onChange={set("freshness")} />
    </>
  );
}
