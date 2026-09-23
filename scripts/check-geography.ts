import assert from "node:assert/strict";
import { locationMatchesTarget as m } from "../packages/pipeline/src/score/geography.js";

// Run: tsx scripts/check-geography.ts
assert(m("San Antonio, TX", "Texas"));                          // the confirmed SpawGlass bug
assert(m("San Antonio, TX", "TX"));
assert(m("Fremont, California, United States", "CA"));          // full name vs abbreviated target
assert(m("Houston Texas", "Texas"));                            // old literal behavior preserved
assert(m("Charleston, WV 25301", "West Virginia"));             // zip after the abbreviation
assert(m("Texas; US - Remote", "TX"));
assert(!m("Austin, TX", "Indiana"));                            // no substring accidents
assert(!m("Bloomington, IN", "Texas"));
assert(m("Indianapolis, Indiana", "IN"));              // full name hits its abbreviation target
assert(!m("Rochester Hills, MI", "Texas"));
assert(!m("Surrey, British Columbia, Canada", "OR"));
console.log("geography checks passed");
