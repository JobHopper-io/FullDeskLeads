// Run: npx tsx --env-file=.env scripts/check-lead-sweep.ts — the lead sweep's behaviour on TEMPORARY rows (deleted after),
// against the real DB and the real board APIs. It runs the real sweep, so it also re-checks every real workable lead
// (idempotent: anything already expired is not workable, and live leads are untouched).
// CAUTION: that includes every current filter rule, posting age (MAX_POSTING_AGE_DAYS) among them: running this applies
// them to real leads. Use scripts/run-lead-sweep.ts --plan to see what would change first.
import assert from "node:assert/strict";
import { createServiceClient, hiringSignalPostingRepository, tenantRepository } from "@fdl/db";
import { loadEnv } from "@fdl/shared";
import { sweepEmittedLeads } from "../packages/pipeline/src/index.js";

const db = createServiceClient(loadEnv());
const [t1, t2] = await tenantRepository(db).listAll();
const postings = hiringSignalPostingRepository(db);
const { data: anyContact } = await db.from("contacts").select("id").limit(1).single();
// Fetched before anything is inserted, so an unreachable board can't leave the temp company behind.
const [liveLever, liveLever2] = ((await (await fetch("https://api.lever.co/v0/postings/spawglass?mode=json")).json()) as { id: string }[]).map((p) => p.id); // two, since (company, source, posting id) is unique
const { data: company, error: companyErr } = await db.from("companies").insert({ name: "TEMP sweep co", domain: "temp-sweep.invalid" }).select("id").single();
if (companyErr) throw companyErr; // a leftover from an interrupted run: remove it (and its rows) first
const created = { signals: [] as string[], leads: [] as string[], assignments: [] as string[] };

async function make(title: string, copy: { source: string; token: string; id: string } | null, states: [string, string | null][]) {
  const { data: s, error: sErr } = await db.from("hiring_signals").insert({ company_id: company!.id, role_title: title, source: "lever", source_posting_id: copy?.id ?? `nocopy-${title}`, status: "active" }).select("id").single();
  if (sErr) throw sErr;
  created.signals.push(s!.id);
  if (copy) await postings.add({ hiringSignalId: s!.id, source: copy.source, sourceToken: copy.token, sourcePostingId: copy.id });
  const { data: l, error: lErr } = await db.from("leads").insert({ contract_version: "temp", hiring_signal_id: s!.id, primary_contact_id: anyContact!.id }).select("id").single();
  if (lErr) throw lErr;
  created.leads.push(l!.id);
  const ids: string[] = [];
  for (const [i, [state]] of states.entries()) {
    const { data: a, error: aErr } = await db.from("lead_assignments").insert({ tenant_id: [t1, t2][i].id, lead_id: l!.id, state }).select("id").single();
    if (aErr) throw aErr;
    created.assignments.push(a!.id); ids.push(a!.id);
  }
  return { signalId: s!.id, leadId: l!.id, assignmentIds: ids };
}
const state = async (id: string) => (await db.from("lead_assignments").select("state").eq("id", id).single()).data!.state;
const signal = async (id: string) => (await db.from("hiring_signals").select("status, status_reason, status_changed_at").eq("id", id).single()).data!;

// Cleanup runs however the check ends: normally, on a failed assertion, or when interrupted (Ctrl-C, a timeout's kill).
async function cleanup() {
  await db.from("interaction_events").delete().in("lead_assignment_id", created.assignments);
  await db.from("lead_assignments").delete().in("id", created.assignments);
  await db.from("leads").delete().in("id", created.leads);
  await db.from("hiring_signals").delete().in("id", created.signals);
  await db.from("companies").delete().eq("id", company!.id); // company is set: setup throws above before anything else is created
  const { count } = await db.from("hiring_signals").select("id", { count: "exact", head: true }).like("role_title", "TEMP%");
  console.log("cleaned up; leftover temp signals:", count);
}
for (const sig of ["SIGINT", "SIGTERM"] as const) process.once(sig, () => void cleanup().finally(() => process.exit(130)));

try {
  const dead = await make("TEMP dead posting", { source: "lever", token: "spawglass", id: "00000000-0000-0000-0000-0000000sweep1" }, [["new", null], ["contacted", null]]);
  const rule = await make("TEMP Talent Community", { source: "lever", token: "spawglass", id: liveLever2 }, [["new", null]]); // live posting, but a filter rule now excludes the title
  const cantCheck = await make("TEMP unverifiable", { source: "greenhouse", token: "no-such-board-xyz", id: "1" }, [["new", null]]);
  const live = await make("TEMP live", { source: "lever", token: "spawglass", id: liveLever }, [["contacted", null]]);
  const terminal = await make("TEMP already suppressed", { source: "lever", token: "spawglass", id: "00000000-0000-0000-0000-0000000sweep2" }, [["suppressed", null]]); // dead posting, but a terminal state
  // A real-looking call history on the contacted assignment of the dead lead
  const { data: ev } = await db.from("interaction_events").insert({ tenant_id: t2.id, lead_assignment_id: dead.assignmentIds[1], event_type: "contacted", payload: {} }).select("*").single();

  const beforeEvents = JSON.stringify((await db.from("interaction_events").select("*").order("id")).data);
  const plan = await sweepEmittedLeads({ dryRun: true });
  assert.equal(await state(dead.assignmentIds[0]), "new", "dry run writes nothing");
  assert.equal((await signal(dead.signalId)).status, "active");
  const planned = plan.findings.find((f) => f.hiringSignalId === dead.signalId && f.outcome === "expired")!;
  assert.deepEqual([planned.expiredAssignmentIds, planned.protectedAssignmentIds], [[dead.assignmentIds[0]], [dead.assignmentIds[1]]], "the plan keeps the assignment with a logged call");

  const run = await sweepEmittedLeads();
  const outcome = (id: string) => run.findings.find((f) => f.hiringSignalId === id)?.outcome;
  console.log("outcomes:", JSON.stringify({ dead: outcome(dead.signalId), rule: outcome(rule.signalId), cantCheck: outcome(cantCheck.signalId), live: outcome(live.signalId), terminal: outcome(terminal.signalId) ?? "(not swept: not workable)" }));

  // dead posting: the signal is expired + stamped; the assignment without a call expires, and the one with a logged call
  // is never auto-expired: it stays contacted (in My Day and Follow-Ups), whatever the posting's status
  assert.equal(outcome(dead.signalId), "expired");
  assert.deepEqual([await state(dead.assignmentIds[0]), await state(dead.assignmentIds[1])], ["expired", "contacted"]);
  assert.deepEqual(run.findings.find((f) => f.hiringSignalId === dead.signalId)!.protectedAssignmentIds, [dead.assignmentIds[1]]);
  const d = await signal(dead.signalId); assert.equal(d.status, "expired"); assert.ok(d.status_changed_at); assert.match(d.status_reason!, /^posting-gone/);
  // filter rule: excluded, reason from the rule, stamped
  assert.equal(outcome(rule.signalId), "excluded"); assert.equal(await state(rule.assignmentIds[0]), "expired");
  const r = await signal(rule.signalId); assert.equal(r.status, "excluded"); assert.equal(r.status_reason, "talent-community"); assert.ok(r.status_changed_at);
  // can't check: nothing changes at all
  assert.equal(outcome(cantCheck.signalId), "unknown"); assert.equal(await state(cantCheck.assignmentIds[0]), "new");
  const c = await signal(cantCheck.signalId); assert.deepEqual([c.status, c.status_changed_at], ["active", null]);
  // live: untouched
  assert.equal(outcome(live.signalId), "live"); assert.equal(await state(live.assignmentIds[0]), "contacted");
  // terminal states are never revived or touched
  assert.equal(await state(terminal.assignmentIds[0]), "suppressed");
  // call history: the whole interaction_events table is byte-identical except our own temp row was already in "before"
  assert.equal(JSON.stringify((await db.from("interaction_events").select("*").order("id")).data), beforeEvents, "interaction_events untouched");
  assert.equal((await db.from("interaction_events").select("id").eq("id", ev!.id).single()).data!.id, ev!.id);

  // a second sweep changes nothing about these
  const stamp = (await signal(dead.signalId)).status_changed_at;
  const again = await sweepEmittedLeads();
  assert.equal(again.findings.filter((f) => f.expiredAssignmentIds.length).length, 0, "second run expires nothing more");
  assert.equal(await state(dead.assignmentIds[1]), "contacted", "the logged-call assignment stays protected on every later sweep");
  assert.equal((await signal(dead.signalId)).status_changed_at, stamp, "not restamped");
  console.log("ALL OK");
} finally {
  await cleanup();
}
