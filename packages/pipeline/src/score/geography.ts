/** All 50 states + DC + inhabited territories: full name -> USPS abbreviation. */
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
  connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
  louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK", oregon: "OR",
  pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC", "south dakota": "SD",
  tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT", virginia: "VA", washington: "WA",
  "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "puerto rico": "PR", guam: "GU", "u.s. virgin islands": "VI", "american samoa": "AS",
  "northern mariana islands": "MP",
};
const ABBREVIATIONS = new Set(Object.values(US_STATES));

/** "Texas" / "tx" / "TX" -> "TX"; null when the text isn't a state at all (a city, a region...). */
export function stateAbbreviation(text: string): string | null {
  const t = text.trim().toLowerCase();
  if (US_STATES[t]) return US_STATES[t];
  const upper = t.toUpperCase();
  return ABBREVIATIONS.has(upper) ? upper : null;
}

/**
 * States named in a location string, normalized to abbreviations. Locations are split on , and ;
 * into parts and each part must be *exactly* a state name or abbreviation (optionally followed by a
 * zip) — never a substring, since "IN" is inside "Indiana", "Austin" and most words.
 * ponytail: "CA" also means Canada; a "…, ON, CA" style location would read as California.
 * Add a country guard if a Canadian source with that format shows up.
 */
export function statesInLocation(location: string): Set<string> {
  const found = new Set<string>();
  for (const part of location.split(/[,;]/)) {
    const cleaned = part.trim().replace(/\s+\d{5}(-\d{4})?$/, "");
    const abbr = stateAbbreviation(cleaned);
    if (abbr) found.add(abbr);
  }
  return found;
}

/**
 * Does a posting location satisfy a tenant target? A state target ("Texas" or "TX") matches by
 * abbreviation, so "San Antonio, TX" and "Houston, Texas" both hit it. Anything else (a city, a
 * region) and the literal case-insensitive substring check the scorer always did still apply, so
 * this is strictly a superset of the old behavior.
 */
export function locationMatchesTarget(location: string, target: string): boolean {
  if (location.toLowerCase().includes(target.toLowerCase())) return true;
  const abbr = stateAbbreviation(target);
  return abbr !== null && statesInLocation(location).has(abbr);
}
