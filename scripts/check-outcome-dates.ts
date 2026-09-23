// Run: npx tsx scripts/check-outcome-dates.ts — asserts the weekday roll-forward for shortcuts and the no_answer "next business day" rule.
import assert from "node:assert/strict";
import { nextBusinessDay, shortcutDate } from "../apps/web/src/lib/outcomes.js";

const iso = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:00`;
assert.equal(iso(nextBusinessDay(new Date(2026, 8, 23))), "2026-9-24 9:00"); // Wed -> Thu
assert.equal(iso(nextBusinessDay(new Date(2026, 8, 25))), "2026-9-28 9:00"); // Fri -> Mon
assert.equal(iso(nextBusinessDay(new Date(2026, 8, 26))), "2026-9-28 9:00"); // Sat -> Mon
const wed = new Date(2026, 8, 23);
assert.equal(iso(shortcutDate("3d", wed)), "2026-9-28 9:00"); // Wed+3 = Sat -> Mon
assert.equal(iso(shortcutDate("1w", wed)), "2026-9-30 9:00"); // Wed+7 = Wed, untouched
assert.equal(iso(shortcutDate("tomorrow", new Date(2026, 8, 25))), "2026-9-28 9:00"); // Fri -> Mon
assert.equal(iso(shortcutDate("3d", new Date(2026, 8, 24))), "2026-9-28 9:00"); // Thu+3 = Sun -> Mon
console.log("ok");
