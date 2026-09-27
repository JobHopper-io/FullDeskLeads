// Run: npx tsx scripts/check-liveness.ts — "gone" only when the board is reachable and lacks the posting;
// every "couldn't check" outcome (network, 429, 5xx, dead board token) must be "unknown". Then hits the real APIs.
import assert from "node:assert/strict";
import { combineLiveness, getSource } from "../packages/sources/src/index.js";

const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
const gh = getSource("greenhouse");
const lever = getSource("lever");
// A scripted fetch: answers by URL suffix, records calls.
const fake = (routes: Record<string, () => Response | Promise<Response>>) => {
  const calls: string[] = [];
  const fn = (async (url: string) => { calls.push(url); for (const [k, v] of Object.entries(routes)) if (url.endsWith(k)) return v(); throw new Error("no route " + url); }) as unknown as typeof fetch;
  return { fn, calls };
};
const board = { jobs: [{ id: 111 }, { id: 222 }] };

assert.equal(await gh.checkPosting("b", "111", fake({ "/jobs/111": () => res(200) }).fn), "live");
assert.equal(await gh.checkPosting("b", "999", fake({ "/jobs/999": () => res(404), "/jobs": () => res(200, board) }).fn), "gone");
assert.equal(await lever.checkPosting("b", "zzz", fake({ "/b/zzz": () => res(404), "?mode=json": () => res(200, [{ id: "aaa" }]) }).fn), "gone");
// Job 404 but board list unreachable / dead board token: NOT gone.
assert.equal(await gh.checkPosting("b", "999", fake({ "/jobs/999": () => res(404), "/jobs": () => res(404) }).fn), "unknown");
assert.equal(await gh.checkPosting("b", "999", fake({ "/jobs/999": () => res(404), "/jobs": () => res(429) }).fn), "unknown");
// Source failures on the posting itself: NOT gone.
assert.equal(await gh.checkPosting("b", "1", fake({ "/jobs/1": () => res(500) }).fn), "unknown");
assert.equal(await gh.checkPosting("b", "1", fake({ "/jobs/1": () => res(403) }).fn), "unknown");
assert.equal(await gh.checkPosting("b", "1", fake({ "/jobs/1": () => { throw new Error("ECONNRESET"); } }).fn), "unknown");
// Transient 429 then success -> retried into live, no false expiry.
let n = 0; const flaky = fake({ "/jobs/1": () => (n++ === 0 ? res(429) : res(200)) });
assert.equal(await gh.checkPosting("b", "1", flaky.fn), "live"); assert.equal(flaky.calls.length, 2);
// Job 404 + board list says it's there (eventual consistency): live.
assert.equal(await gh.checkPosting("b", "111", fake({ "/jobs/111": () => res(404), "/jobs": () => res(200, board) }).fn), "live");
// One real job on several boards: live if any copy is; gone only if every copy is; any doubt without a live copy is unknown.
assert.equal(combineLiveness(["gone", "live"]), "live"); assert.equal(combineLiveness(["unknown", "live"]), "live");
assert.equal(combineLiveness(["gone", "gone"]), "gone"); assert.equal(combineLiveness(["gone", "unknown"]), "unknown"); assert.equal(combineLiveness([]), "unknown");
console.log("mocked cases ok");

// Real endpoints.
const ghId = ((await (await fetch("https://boards-api.greenhouse.io/v1/boards/industrialelectricmanufacturing/jobs")).json()) as typeof board).jobs[0].id;
const lvId = ((await (await fetch("https://api.lever.co/v0/postings/spawglass?mode=json")).json()) as { id: string }[])[0].id;
console.log("real greenhouse live:", await gh.checkPosting("industrialelectricmanufacturing", String(ghId)));
console.log("real greenhouse removed id:", await gh.checkPosting("industrialelectricmanufacturing", "1"));
console.log("real greenhouse dead board:", await gh.checkPosting("no-such-board-xyz", "1"));
console.log("real lever live:", await lever.checkPosting("spawglass", lvId));
console.log("real lever removed id:", await lever.checkPosting("spawglass", "00000000-0000-0000-0000-000000000000"));
console.log("real lever dead board:", await lever.checkPosting("no-such-board-xyz", "00000000-0000-0000-0000-000000000000"));
