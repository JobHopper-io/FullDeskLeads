import { stateAbbreviation } from "../score/geography.js";
import { US_PLACES } from "./usPlaces.generated.js";

// Real distance for site_vs_corporate, from US Census place coordinates (usPlaces.generated.ts), so "same metro"
// is a measurement, not a list of city pairs: Alexandria and Pineville, Louisiana are ~5 miles apart.

/**
 * A contact within this many miles of the company HQ counts as at the HQ ("corporate"): roughly a commuting
 * radius, so a suburb or twin city is not "a different site". A product judgement, not a measured constant: the
 * confirmed case (Alexandria/Pineville) is ~5 miles, Minneapolis to Bayport ~25. Change it here only.
 */
export const METRO_RADIUS_MILES = 25;

let index: Map<string, [number, number]> | undefined;
function load(): Map<string, [number, number]> {
  if (index) return index;
  index = new Map();
  for (const line of US_PLACES.split("\n")) {
    const [name, st, lat, lon] = line.split("|");
    index.set(`${name}|${st}`, [Number(lat), Number(lon)]);
  }
  return index;
}

/** Same normalization the table was built with: lowercase, no periods, "St." is "Saint". */
const norm = (s: string) => s.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").replace(/^st /, "saint ");

/** Coordinates for a US city + state ("Pineville", "Louisiana" or "LA"); null for anything not in the table (non-US, unincorporated...). */
export function lookupPlace(city: string, state: string): { lat: number; lon: number } | null {
  const st = stateAbbreviation(state);
  if (!st) return null;
  const hit = load().get(`${norm(city)}|${st}`);
  return hit ? { lat: hit[0], lon: hit[1] } : null;
}

export function distanceMiles(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

const same = (a: string, b: string) => norm(a) === norm(b);

/**
 * 'corporate' when the contact is at the company HQ's city, or within METRO_RADIUS_MILES of it; 'site' when
 * farther; null when city or state is missing on either side (unknown, never guessed).
 *
 * When a place can't be located (outside the US, or unincorporated), it falls back to the old exact comparison:
 * same city and state is 'corporate', anything else 'site'. That fallback can over-report 'site' for an unlocatable
 * neighbor, and only for those.
 */
export function siteVsCorporate(
  contactCity: string | null,
  contactState: string | null,
  companyCity: string | null,
  companyState: string | null,
  radiusMiles = METRO_RADIUS_MILES,
): "site" | "corporate" | null {
  if (!contactCity?.trim() || !contactState?.trim() || !companyCity?.trim() || !companyState?.trim()) return null;
  if (same(contactCity, companyCity) && same(contactState, companyState)) return "corporate";
  const a = lookupPlace(contactCity, contactState);
  const b = lookupPlace(companyCity, companyState);
  if (!a || !b) return "site";
  return distanceMiles(a, b) <= radiusMiles ? "corporate" : "site";
}

// ── the opening's own location (hiring_signals.location), for choosing a primary near the job ─────────────────────

const COUNTRY_OR_REMOTE = /^(united states(?: of america)?|usa|us|u\.s\.a?\.?|canada|remote|us ?- ?remote)$/i;

/**
 * The cities in a posting's location string. Real shapes: "Port Lavaca, Texas", "Buffalo, NY", "Jacksonville,
 * Florida, United States", multi-city lists ("Dallas, Texas, United States; Plano, Texas, United States"), and
 * ones with no usable place ("United States", "US - Remote", a bare state, a city with no state). Only "city,
 * state" parts count; the rest yield nothing, which callers treat as "no location", never as a guess.
 */
export function parseLocation(location: string | null | undefined): { city: string; state: string }[] {
  if (!location) return [];
  return location.split(";").flatMap((part) => {
    const tokens = part
      .split(",")
      .map((t) => t.trim().replace(/\s+\d{5}(-\d{4})?$/, ""))
      .filter((t) => t && !COUNTRY_OR_REMOTE.test(t));
    return tokens.length >= 2 && stateAbbreviation(tokens[1]) ? [{ city: tokens[0], state: tokens[1] }] : [];
  });
}

/**
 * Miles from a contact to the opening: to the nearest place in the posting's location. 0 when the contact is in
 * one of those cities (compared by name, so it holds even where the place isn't in the coordinate table). Null
 * when there's nothing to measure: no contact city/state, an opening with no usable place, or a place the table
 * doesn't have and that isn't a name match.
 */
export function distanceToOpening(
  contactCity: string | null | undefined,
  contactState: string | null | undefined,
  openingLocation: string | null | undefined,
): number | null {
  if (!contactCity?.trim() || !contactState?.trim()) return null;
  const places = parseLocation(openingLocation);
  // Openings say "NY", Seamless says "New York": compare states by abbreviation when both are recognizable.
  const sameState = (x: string, y: string) => (stateAbbreviation(x) && stateAbbreviation(x) === stateAbbreviation(y)) || same(x, y);
  if (places.some((p) => same(p.city, contactCity) && sameState(p.state, contactState))) return 0;
  const here = lookupPlace(contactCity, contactState);
  if (!here) return null;
  const miles = places.flatMap((p) => {
    const there = lookupPlace(p.city, p.state);
    return there ? [distanceMiles(here, there)] : [];
  });
  return miles.length ? Math.min(...miles) : null;
}
