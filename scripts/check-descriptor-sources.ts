import assert from "node:assert/strict";
import { DESCRIPTORS } from "../packages/pipeline/src/intelligence/plant.js";
import { COMPANY_SOURCES } from "../packages/pipeline/src/intelligence/sources.js";

// Run: npx tsx scripts/check-descriptor-sources.ts — fetches each company's own site and confirms DESCRIPTORS'
// `from` fragments (the sentences the one-line plant descriptor, plant.ts, is built from) really appear there, not
// just in our own copy of sources.ts's `facts[]`. A site that refuses the fetch is reported and skipped, not a
// failure of this check — see sources.ts's SpawGlass entry (2026-10-02): spawglass.com blocks every fetch attempt,
// so it has no DESCRIPTORS entry yet and this check has nothing of its to verify until one exists.
const norm = (s: string) => s.replace(/<[^>]+>/g, " ").replace(/&[a-z#0-9]+;/gi, " ").replace(/\s+/g, " ").trim().toLowerCase();

const urlsByEmployer = Object.fromEntries(Object.values(COMPANY_SOURCES).map((c) => [c.employer, c.sourceUrls]));

let failures = 0;
let skipped = 0;
for (const [employer, { from }] of Object.entries(DESCRIPTORS)) {
  const urls = urlsByEmployer[employer] ?? [];
  let text = "";
  let reachable = urls.length > 0;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 (compatible; FullDeskLeadsCheck/1.0)" } });
      text += ` ${norm(await res.text())}`;
    } catch (e) {
      console.log(`SKIP  ${employer}: could not fetch ${url} (${(e as Error).message})`);
      reachable = false;
    }
  }
  if (!reachable) {
    skipped++;
    continue;
  }
  for (const fragment of from) {
    const ok = text.includes(norm(fragment));
    console.log(`${ok ? "PASS" : "FAIL"}  ${employer}: "${fragment}"`);
    if (!ok) failures++;
  }
}
assert.equal(failures, 0, `${failures} descriptor fragment(s) not found on the company's own site`);
console.log(`descriptor source checks passed (${skipped} compan${skipped === 1 ? "y" : "ies"} unreachable, skipped)`);
