// Run: npx tsx --env-file=.env scripts/check-posting-age.ts — the posting-age rule, its POSTING_AGE_FILTER_ENABLED flag
// (off by default), first-published extraction and the freshness band. Synthetic inputs, then a READ-ONLY database part:
// the real filter decision on a real old posting with the flag off and on. Writes nothing.
import assert from "node:assert/strict";
import { freshnessBand, postingAgeDays } from "@fdl/shared";
import { firstPublishedDate } from "../packages/sources/src/jobDetails.js";
import { MAX_POSTING_AGE_DAYS, filterReasonFor, postingAgeFilterEnabled, stalePostingReason } from "../packages/pipeline/src/filter/filter.js";

const now = new Date("2026-09-28T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * 864e5).toISOString();

assert.equal(MAX_POSTING_AGE_DAYS, 14);
// Older than the limit is stale; exactly at the limit is not.
assert.equal(stalePostingReason(daysAgo(14), null, now), null);
assert.equal(stalePostingReason(daysAgo(15), null, now), "stale-posting: 15 days old, limit 14");
assert.equal(stalePostingReason("2026-09-01", null, now), "stale-posting: 27 days old, limit 14", "a bare date counts from midnight UTC");
// First-published wins over detected_at; detected_at is the fallback; with neither the signal is kept.
assert.equal(stalePostingReason(daysAgo(3), daysAgo(40), now), null, "a fresh first-published date is not overridden by an old detection");
assert.equal(stalePostingReason(null, daysAgo(20), now), "stale-posting: 20 days old, limit 14");
assert.equal(stalePostingReason(null, daysAgo(2), now), null);
assert.equal(stalePostingReason(null, null, now), null);

// First-published comes from the source's own field, never Greenhouse's updated_at.
assert.equal(firstPublishedDate("greenhouse", { first_published: "2026-08-01T10:00:00-04:00", updated_at: "2026-09-27T10:00:00-04:00" }), "2026-08-01T10:00:00-04:00");
assert.equal(firstPublishedDate("greenhouse", { updated_at: "2026-09-27T10:00:00-04:00" }), null, "no first_published: unknown, not updated_at");
assert.equal(firstPublishedDate("lever", { createdAt: Date.parse("2026-05-14T00:00:00Z") }), "2026-05-14T00:00:00.000Z");
assert.equal(firstPublishedDate("lever", {}), null);

// Freshness band, computed on read from the age.
assert.deepEqual([0, 2, 3, 7, 8, 14, 15].map(freshnessBand), ["fresh", "fresh", "recent", "recent", "ageing", "ageing", "stale"]);
assert.equal(postingAgeDays("2026-09-14", now), 14);

// The flag: off unless the variable is exactly "true".
const setFlag = (v: string | undefined) => (v === undefined ? delete process.env.POSTING_AGE_FILTER_ENABLED : (process.env.POSTING_AGE_FILTER_ENABLED = v));
for (const [v, on] of [[undefined, false], ["false", false], ["", false], ["1", false], ["TRUE", false], ["true", true]] as const) {
  setFlag(v); assert.equal(postingAgeFilterEnabled(), on, `POSTING_AGE_FILTER_ENABLED=${JSON.stringify(v)}`);
}
console.log("ok: synthetic");

// Both states through the real filter decision (read-only): DIS-TRAN's Equipment Operator, first published 2026-03-02,
// active, and caught by no other rule. Off: kept. On: excluded as stale.
if (process.env.SUPABASE_URL) {
  const oldSignal = "f22c5242-53e8-4512-8477-208106aa6356";
  setFlag(undefined);
  assert.equal(await filterReasonFor(oldSignal), null, "flag off (default): an old posting is not excluded for age");
  setFlag("true");
  assert.match((await filterReasonFor(oldSignal))!, /^stale-posting: \d+ days old, limit 14$/, "flag on: the same posting is excluded as stale");
  setFlag(undefined);
  console.log("ok: filter decision, flag off and on");
} else console.log("skipped the database part (no SUPABASE_URL; run with --env-file=.env)");
