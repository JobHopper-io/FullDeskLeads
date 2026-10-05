import { useEffect } from "react";
import { ARCHETYPE_OPTIONS, FRESHNESS_OPTIONS, ROLE_FAMILY_OPTIONS, TIER_OPTIONS, filterLabel, toggle, type FilterState } from "../lib/specialtyFilters";

// A disclosure of toggle chips, same aria-checked pattern as OutcomePanel's disposition-grid. `name`
// groups every <details> here as mutually exclusive (a native HTML feature, like radio inputs) — opening
// one closes whichever other filter group was open, no JS state needed.
//
// `open` is deliberately never passed: an earlier version set `open={selected.length > 0}`, which looks
// like a reasonable "stay open while it has a selection" default but is a classic React/native-element
// trap — React re-applies that prop on every render, so the moment *any* chip anywhere changes `filters`
// (the one state object every category shares), every group with an existing selection snaps back open
// regardless of whether the user had just closed it. That's what broke "opening a new filter doesn't
// close the other one": it wasn't only a missing-sibling-exclusivity bug, this group was unclosable.
function FilterGroup({ title, category, options, selected, onToggle }: { title: string; category: keyof FilterState; options: string[]; selected: string[]; onToggle: (v: string) => void }) {
  return (
    <details className="filter-chip opp-filter-group" name="opp-filter-group">
      <summary>{title}{selected.length > 0 && ` (${selected.length})`}</summary>
      <div className="disposition-grid opp-chip-row" role="group" aria-label={title}>
        {options.map((o) => (
          <button key={o} type="button" role="checkbox" aria-checked={selected.includes(o)} className="chip" onClick={() => onToggle(o)}>
            {filterLabel(category, o)}
          </button>
        ))}
      </div>
    </details>
  );
}

/** The five filter groups, shared by Opportunities' filter bar and Settings' Specialty Filters. */
export function SpecialtyFilterControls({ filters, onChange, industryOptions }: { filters: FilterState; onChange: (next: FilterState) => void; industryOptions: string[] }) {
  // The panel floats over whatever sits below the filter bar (chips, count, Save/Clear), so it closes on a click
  // outside it or Escape. Picking several values in a row still works: clicks inside the panel don't close it.
  useEffect(() => {
    const open = () => document.querySelectorAll<HTMLDetailsElement>("details.opp-filter-group[open]");
    const onPointer = (e: PointerEvent) => open().forEach((d) => { if (!d.contains(e.target as Node)) d.open = false; });
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") open().forEach((d) => { d.open = false; }); };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, []);
  const flip = (category: keyof FilterState) => (value: string) => onChange({ ...filters, [category]: toggle(filters[category], value) });
  return (
    <>
      <FilterGroup title="Industry" category="industry" options={industryOptions} selected={filters.industry} onToggle={flip("industry")} />
      <FilterGroup title="Role family" category="roleFamily" options={ROLE_FAMILY_OPTIONS} selected={filters.roleFamily} onToggle={flip("roleFamily")} />
      <FilterGroup title="Tier" category="tier" options={TIER_OPTIONS} selected={filters.tier} onToggle={flip("tier")} />
      <FilterGroup title="Plant layer" category="archetype" options={ARCHETYPE_OPTIONS.map((a) => a.value)} selected={filters.archetype} onToggle={flip("archetype")} />
      <FilterGroup title="Freshness" category="freshness" options={FRESHNESS_OPTIONS} selected={filters.freshness} onToggle={flip("freshness")} />
    </>
  );
}

/** Every selected value as a removable chip (one click removes it without opening its group). */
export function ActiveFilterChips({ filters, onChange, onClear }: { filters: FilterState; onChange: (next: FilterState) => void; onClear: () => void }) {
  const chips = (Object.keys(filters) as (keyof FilterState)[]).flatMap((category) => filters[category].map((value) => ({ category, value })));
  if (!chips.length) return null;
  return (
    <div className="opp-active-chips">
      {chips.map(({ category, value }) => (
        <button key={`${category}:${value}`} className="chip" onClick={() => onChange({ ...filters, [category]: toggle(filters[category], value) })}>
          {filterLabel(category, value)} ×
        </button>
      ))}
      <button className="link-button" onClick={onClear}>Clear filters</button>
    </div>
  );
}
