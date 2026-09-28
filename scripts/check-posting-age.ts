// Run: npx tsx scripts/check-posting-age.ts — the posting-age rule, first-published extraction and the freshness band,
// on synthetic inputs. No network, no database.
import assert from "node:assert/strict";
import { freshnessBand, postingAgeDays } from "@fdl/shared";
import { firstPublishedDate } from "../packages/sources/src/jobDetails.js";
import { MAX_POSTING_AGE_DAYS, stalePostingReason } from "../packages/pipeline/src/filter/filter.js";

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
console.log("ok");
