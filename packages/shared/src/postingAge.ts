/** Whole days since a posting's reference date: its first-published date, else when it was first detected. */
export function postingAgeDays(referenceDate: string, now: Date = new Date()): number {
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(referenceDate) ? `${referenceDate}T00:00:00Z` : referenceDate;
  return Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 864e5));
}

export type FreshnessBand = "fresh" | "recent" | "ageing" | "stale";

/**
 * fresh: 0-2 days, recent: 3-7, ageing: 8-14, stale: 15+. Computed on read from the posting's age, never stored: a stored
 * band is only right on the day it was written, and nothing guarantees a job is running to refresh it.
 */
export function freshnessBand(ageDays: number): FreshnessBand {
  if (ageDays <= 2) return "fresh";
  if (ageDays <= 7) return "recent";
  if (ageDays <= 14) return "ageing";
  return "stale";
}
