// Run: npx tsx --env-file=.env scripts/check-emit-liveness.ts — end-to-end against the real DB and real board APIs,
// using TEMPORARY throwaway rows (deleted afterward; real rows are not touched).
//   A. normalize: a cross-source duplicate is recorded as a second copy of ONE hiring_signal (migration 0030).
//   B. emit: live re-verification checks every copy — the retained copy dying while the other board's copy stays live
//      must NOT expire the signal; gone only when every copy is gone; can't-check is retryable, never expired.
import assert from "node:assert/strict";
import { createServiceClient, hiringSignalPostingRepository, scoreRecordRepository, tenantRepository } from "@fdl/db";
import { hiringSignalRepository } from "@fdl/db";
import { emitLead, normalizeRawSignal } from "../packages/pipeline/src/index.js";
import { loadEnv } from "@fdl/shared";

const db = createServiceClient(loadEnv());
const [tenant] = await tenantRepository(db).listAll();
const postings = hiringSignalPostingRepository(db);
const scores = scoreRecordRepository(db);
const DOMAIN = "temp-liveness.invalid";
const signalIds: string[] = [];
const rawIds: string[] = [];
let companyId: string | undefined;

// Real, currently-live postings to stand in for "the other board's copy".
const live = {
  lever: { token: "spawglass", id: ((await (await fetch("https://api.lever.co/v0/postings/spawglass?mode=json")).json()) as { id: string }[])[0].id },
  greenhouse: { token: "industrialelectricmanufacturing", id: String(((await (await fetch("https://boards-api.greenhouse.io/v1/boards/industrialelectricmanufacturing/jobs")).json()) as { jobs: { id: number }[] }).jobs[0].id) },
};
const dead = (n: number) => `00000000-0000-0000-0000-0000000000${n}d`; // distinct per scenario (unique index)

const status = async (id: string) => (await db.from("hiring_signals").select("status").eq("id", id).single()).data!.status;
const leadCount = async (id: string) => (await db.from("leads").select("id", { count: "exact", head: true }).eq("hiring_signal_id", id)).count;
async function tempSignal(copies: { source: string; token: string; id: string }[]): Promise<string> {
  const { data, error } = await db.from("hiring_signals").insert({ company_id: companyId, role_title: "TEMP liveness check", source: copies[0].source, source_posting_id: copies[0].id, status: "active" }).select("id").single();
  if (error) throw error;
  signalIds.push(data.id);
  for (const c of copies) await postings.add({ hiringSignalId: data.id, source: c.source, sourceToken: c.token, sourcePostingId: c.id });
  await scores.upsertForHiringSignal({ tenantId: tenant.id, hiringSignalId: data.id, fitScore: 1, freshnessScore: 1, confidenceScore: 1, eligible: true });
  return data.id;
}
const quiet = process.stdout.write.bind(process.stdout); // emit/normalize log JSON lines to stdout; keep the report readable
const silently = async <T>(fn: () => Promise<T>) => { process.stdout.write = (() => true) as typeof process.stdout.write; try { return await fn(); } finally { process.stdout.write = quiet; } };
const show = (label: string, ...a: unknown[]) => console.log(label.padEnd(58), ...a);

try {
  // ── A. normalize records both copies of a cross-source duplicate ──────────────────────────────────────────────
  await db.from("source_companies").insert([
    { company_name: "TEMP liveness co", source: "lever", source_token: "temp-lv-token", domain: DOMAIN },
    { company_name: "TEMP liveness co", source: "greenhouse", source_token: "temp-gh-token", domain: DOMAIN },
  ]);
  const payload = (id: string) => ({ sourceJobId: id, title: "TEMP Widget Engineer", location: "Austin, TX", department: null, postedDate: "2026-09-20", rawPayload: {} });
  for (const [source, token, id] of [["lever", "temp-lv-token", "lv-100"], ["greenhouse", "temp-gh-token", "gh-200"]] as const) {
    const { data } = await db.from("raw_signals").insert({ source, source_token: token, raw_payload: payload(id), fetched_at: new Date().toISOString() }).select("id").single();
    rawIds.push(data!.id);
  }
  const first = await silently(() => normalizeRawSignal(rawIds[0]));
  const second = await silently(() => normalizeRawSignal(rawIds[1]));
  const { data: hsRows } = await db.from("hiring_signals").select("id, company_id").in("id", [first.hiringSignalId, second.hiringSignalId]);
  companyId = hsRows![0].company_id;
  const copies = await postings.listByHiringSignalId(first.hiringSignalId);
  show("A. cross-source duplicate detected:", second.wasDuplicate, "| same hiring_signal:", first.hiringSignalId === second.hiringSignalId);
  show("A. copies recorded on that one signal:", JSON.stringify(copies.map((c) => `${c.source}:${c.source_posting_id}`)));
  assert.ok(second.wasDuplicate && first.hiringSignalId === second.hiringSignalId);
  assert.deepEqual(copies.map((c) => `${c.source}:${c.source_posting_id}`).sort(), ["greenhouse:gh-200", "lever:lv-100"]);
  await silently(() => normalizeRawSignal(rawIds[1])); // idempotent re-normalize
  assert.equal((await postings.listByHiringSignalId(first.hiringSignalId)).length, 2);

  // ── B. emit-time verification across copies ───────────────────────────────────────────────────────────────────
  const retainedDead = (n: number) => ({ source: "lever", token: live.lever.token, id: dead(n) });
  const otherLive = { source: "greenhouse", token: live.greenhouse.token, id: live.greenhouse.id };

  const before = await tempSignal([retainedDead(1)]); // the old model: only the retained copy is known
  const r1 = await silently(() => emitLead(before, tenant.id));
  show("B1 BEFORE  retained copy dead, other copy unknown to us:", JSON.stringify(r1), "status:", await status(before));
  assert.ok("skipped" in r1 && !r1.retryable); assert.equal(await status(before), "expired"); // the bug: live job wrongly expired

  // status_changed_at (migration 0033): stamped by the expiry write, and NOT restamped when the same status is written again.
  const stamped = async (id: string) => (await db.from("hiring_signals").select("status_changed_at, status_reason").eq("id", id).single()).data!;
  const t1 = (await stamped(before)).status_changed_at;
  assert.ok(t1, "expiry must stamp status_changed_at");
  await hiringSignalRepository(db).setStatus(before, "expired", "reason rewritten");
  const t2 = await stamped(before);
  assert.equal(t2.status_changed_at, t1, "same status again: not restamped"); assert.equal(t2.status_reason, "reason rewritten", "but the reason is updated");
  show("B1 status_changed_at stamped on expiry, kept on same-status rewrite:", t1);

  const after = await tempSignal([retainedDead(2), otherLive]);
  const r2 = await silently(() => emitLead(after, tenant.id).catch((e: Error) => ({ passed: e.message })));
  show("B2 AFTER   retained copy dead, other board's copy live:", JSON.stringify(r2).slice(0, 60) + "…", "status:", await status(after));
  assert.ok("passed" in r2 && /no contact/.test(r2.passed as string), "verification must pass and proceed to lead creation (temp signal has no contact)");
  assert.equal(await status(after), "active"); assert.equal((await stamped(after)).status_changed_at, null, "still active: never changed, so null");

  const bothGone = await tempSignal([retainedDead(3), { source: "greenhouse", token: live.greenhouse.token, id: "1" }]);
  const r3 = await silently(() => emitLead(bothGone, tenant.id));
  show("B3 every copy confirmed gone:", JSON.stringify(r3), "status:", await status(bothGone));
  assert.ok("skipped" in r3 && !r3.retryable); assert.equal(await status(bothGone), "expired"); assert.equal(await leadCount(bothGone), 0);

  const cantCheck = await tempSignal([retainedDead(4), { source: "greenhouse", token: "no-such-board-xyz", id: "1" }]);
  const r4 = await silently(() => emitLead(cantCheck, tenant.id));
  show("B4 one copy gone, other's board unreachable/dead token:", JSON.stringify(r4), "status:", await status(cantCheck));
  assert.ok("skipped" in r4 && r4.retryable); assert.equal(await status(cantCheck), "active");

  console.log("\nALL OK");
} finally {
  for (const id of signalIds) {
    const leadIds = ((await db.from("leads").select("id").eq("hiring_signal_id", id)).data ?? []).map((l) => l.id);
    if (leadIds.length) await db.from("lead_assignments").delete().in("lead_id", leadIds);
    await db.from("score_records").delete().eq("hiring_signal_id", id);
    await db.from("leads").delete().eq("hiring_signal_id", id);
  }
  // normalize-created signals aren't in signalIds; take everything at the temp company (cascade removes posting rows)
  if (companyId) {
    await db.from("score_records").delete().in("hiring_signal_id", ((await db.from("hiring_signals").select("id").eq("company_id", companyId)).data ?? []).map((h) => h.id));
    await db.from("hiring_signals").delete().eq("company_id", companyId);
  }
  if (rawIds.length) await db.from("raw_signals").delete().in("id", rawIds);
  await db.from("source_companies").delete().in("source_token", ["temp-lv-token", "temp-gh-token"]);
  await db.from("companies").delete().eq("domain", DOMAIN);
  const { count } = await db.from("hiring_signals").select("id", { count: "exact", head: true }).eq("role_title", "TEMP liveness check");
  console.log("cleaned up; leftover temp signals:", count);
}
