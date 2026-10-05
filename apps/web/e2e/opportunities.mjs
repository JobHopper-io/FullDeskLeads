// Opportunities: exclusion, claim-race, filter composition and pagination, against the real API + DB
// (spec Figure — the Opportunities list). Needs `pnpm dev` (web :5173, api :3000), the repo .env, and
// apps/web/.env.local (VITE_AUTO_LOGIN_*), same as my-day.mjs. Also needs migrations 0035-0037 applied
// (lead_assignments.state 'released', claim_lead_assignment(), the search trigram indexes) — without
// them the claim/release checks 404/500 rather than silently passing.
//
// Builds its own disposable fixtures (a throwaway company + hiring_signals + contacts + leads, every
// name tagged with this run's id) rather than depending on whatever the shared dev DB currently holds,
// so the checks are deterministic regardless of how much of the seeded pool other sessions have already
// claimed. Deletes every fixture row in `finally`, in FK-safe order, whether checks pass or fail.
//
// Run from apps/web: node e2e/opportunities.mjs
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const kv = (f) => Object.fromEntries(readFileSync(f, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const env = kv("../../.env");
const web = kv(".env.local");
const API = process.env.API ?? "http://localhost:3000";

const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); };

const RUN = Date.now().toString(36);
const tag = (s) => `OPPTEST_${RUN}_${s}`;

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// ── Sign in as the seeded tenant-A test user (same account my-day.mjs drives through the browser). ──
const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: web.VITE_AUTO_LOGIN_EMAIL, password: web.VITE_AUTO_LOGIN_PASSWORD });
if (signInError) { console.error("sign-in failed", signInError); process.exit(1); }
const token = signIn.session.access_token;
const me = await api("GET", "/me");
const tenantId = me.json.tenantId;
console.log(`signed in as ${signIn.user.email}, tenant ${tenantId}\n`);

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────────
const created = { companies: [], hiringSignals: [], contacts: [], leads: [], assignments: [] };

async function makeLead({ suffix, roleTitle, openingScript = null, roleIntelligence = null, objections = null, detectedAt, phone = "555-0100", phoneVerified = false }) {
  const { data: company, error: companyError } = await svc.from("companies").insert({ name: tag(`Co_${suffix}`) }).select().single();
  if (companyError) throw companyError;
  created.companies.push(company.id);

  const { data: signal, error: signalError } = await svc
    .from("hiring_signals")
    .insert({
      // The tag trails the real title (not a prefix): roleFamily()'s regexes match on \b word
      // boundaries, and "_" is a word character, so a leading "OPPTEST_..._" prefix glued directly
      // onto the title would swallow the boundary before it and silently defeat every match.
      company_id: company.id, role_title: `${roleTitle} ${tag(`posting_${suffix}`)}`, source: "greenhouse", source_posting_id: tag(`posting_${suffix}`),
      status: "active", detected_at: detectedAt ?? new Date().toISOString(), posted_date: null,
    })
    .select().single();
  if (signalError) throw signalError;
  created.hiringSignals.push(signal.id);

  const { data: contact, error: contactError } = await svc
    .from("contacts")
    .insert({ company_id: company.id, name: tag(`Contact_${suffix}`), title: "Plant Manager", phone, phone_verified: phoneVerified, confidence_score: 0.8, source: "test" })
    .select().single();
  if (contactError) throw contactError;
  created.contacts.push(contact.id);

  const { data: lead, error: leadError } = await svc
    .from("leads")
    .insert({ contract_version: "test", hiring_signal_id: signal.id, primary_contact_id: contact.id, status: "ready", opening_script: openingScript, role_intelligence: roleIntelligence, objections })
    .select().single();
  if (leadError) throw leadError;
  created.leads.push(lead.id);

  return { leadId: lead.id, roleTitle: signal.role_title, company: company.name };
}

async function cleanup() {
  if (created.assignments.length) await svc.from("lead_assignments").delete().in("id", created.assignments);
  if (created.leads.length) await svc.from("leads").delete().in("id", created.leads);
  if (created.contacts.length) await svc.from("contacts").delete().in("id", created.contacts);
  if (created.hiringSignals.length) await svc.from("hiring_signals").delete().in("id", created.hiringSignals);
  if (created.companies.length) await svc.from("companies").delete().in("id", created.companies);
}

try {
  console.log("1. Exclusion: not in anyone's My Day -> visible; claimed -> gone; released -> visible again");
  const a = await makeLead({ suffix: "excl", roleTitle: "Maintenance Technician" });
  let res = await api("GET", `/opportunities?q=${encodeURIComponent(a.roleTitle)}`);
  check(res.status === 200 && res.json.items.some((i) => i.leadId === a.leadId), `fresh lead appears in Opportunities (found ${res.json.items?.length} rows)`);

  const claim = await api("POST", "/opportunities/claim", { leadIds: [a.leadId] });
  check(claim.status === 207 && claim.json.results[0].status === "claimed", `claim: ${JSON.stringify(claim.json)}`);
  const { data: assignmentRow } = await svc.from("lead_assignments").select("id, state").eq("tenant_id", tenantId).eq("lead_id", a.leadId).single();
  created.assignments.push(assignmentRow.id);
  check(assignmentRow.state === "new", `lead_assignments row created in state 'new' (got ${assignmentRow.state})`);

  res = await api("GET", `/opportunities?q=${encodeURIComponent(a.roleTitle)}`);
  check(res.status === 200 && !res.json.items.some((i) => i.leadId === a.leadId), "claimed lead no longer appears in Opportunities");

  const release = await api("POST", `/lead-assignments/${assignmentRow.id}/release`, {});
  check(release.status === 200 && release.json.state === "released", `release: ${JSON.stringify(release.json)}`);
  res = await api("GET", `/opportunities?q=${encodeURIComponent(a.roleTitle)}`);
  check(res.status === 200 && res.json.items.some((i) => i.leadId === a.leadId), "released lead reappears in Opportunities");

  // A second release attempt on the same (now-released, non-workable) assignment must 404, not no-op silently.
  const doubleRelease = await api("POST", `/lead-assignments/${assignmentRow.id}/release`, {});
  check(doubleRelease.status === 404, `re-releasing an already-released assignment 404s (got ${doubleRelease.status})`);

  console.log("\n2. Claim race: two concurrent claims on the same lead -> exactly one claimed, one already_claimed");
  const b = await makeLead({ suffix: "race", roleTitle: "Warehouse Supervisor" });
  const [r1, r2] = await Promise.all([
    api("POST", "/opportunities/claim", { leadIds: [b.leadId] }),
    api("POST", "/opportunities/claim", { leadIds: [b.leadId] }),
  ]);
  const statuses = [r1.json.results[0].status, r2.json.results[0].status].sort();
  check(JSON.stringify(statuses) === JSON.stringify(["already_claimed", "claimed"]), `race outcome: ${statuses.join(" / ")}`);
  const { data: raceAssignments } = await svc.from("lead_assignments").select("id").eq("tenant_id", tenantId).eq("lead_id", b.leadId);
  created.assignments.push(...raceAssignments.map((r) => r.id));
  check(raceAssignments.length === 1, `exactly one lead_assignments row exists for the raced lead (found ${raceAssignments.length})`);

  console.log("\n3. Filter composition: tier=full AND roleFamily=maintenance returns only the matching fixture");
  const full = await makeLead({ suffix: "full", roleTitle: "Maintenance Lead Filtertest", openingScript: "Hi, this is a recruiter calling about..." });
  const bare = await makeLead({ suffix: "bare", roleTitle: "Maintenance Lead Filtertest" }); // same family, no content -> tier bare
  const otherFamily = await makeLead({ suffix: "finance", roleTitle: "Staff Accountant Filtertest", openingScript: "Hi, this is a recruiter calling about..." }); // full tier, wrong family
  res = await api("GET", "/opportunities?q=Filtertest&tier=full&roleFamily=maintenance");
  const ids = (res.json.items ?? []).map((i) => i.leadId);
  check(ids.includes(full.leadId) && !ids.includes(bare.leadId) && !ids.includes(otherFamily.leadId), `tier+roleFamily AND filter: got ${JSON.stringify(ids)}, expected only [${full.leadId}]`);
  // OR within a category: tier=full,bare should bring both tier variants of the maintenance role back.
  res = await api("GET", "/opportunities?q=Filtertest&tier=full,bare&roleFamily=maintenance");
  const ids2 = (res.json.items ?? []).map((i) => i.leadId);
  check(ids2.includes(full.leadId) && ids2.includes(bare.leadId) && !ids2.includes(otherFamily.leadId), `OR within tier, AND across categories: got ${JSON.stringify(ids2)}`);

  console.log("\n4. Pagination: limit=2 across several fixtures sharing one search tag, no skip or duplicate");
  const pageTag = tag("Page");
  const pageFixtures = [];
  for (let i = 0; i < 5; i++) {
    pageFixtures.push(await makeLead({ suffix: `page${i}`, roleTitle: pageTag, detectedAt: new Date(Date.now() - i * 60_000).toISOString() }));
  }
  const seen = [];
  let cursor = null;
  for (let page = 0; page < 10; page++) {
    const qs = new URLSearchParams({ q: pageTag, limit: "2" });
    if (cursor) qs.set("cursor", cursor);
    const pageRes = await api("GET", `/opportunities?${qs}`);
    seen.push(...pageRes.json.items.map((i) => i.leadId));
    cursor = pageRes.json.nextCursor;
    if (!cursor) break;
  }
  const uniqueSeen = new Set(seen);
  check(seen.length === uniqueSeen.size, `no duplicates across pages (scanned ${seen.length}, unique ${uniqueSeen.size})`);
  check(pageFixtures.every((f) => uniqueSeen.has(f.leadId)), `all ${pageFixtures.length} fixtures reached across pages (got ${uniqueSeen.size})`);
} finally {
  await cleanup();
  console.log("\nfixtures cleaned up");
}

console.log(failures ? `\n${failures} FAILED` : "\nall checks passed");
process.exit(failures ? 1 : 0);
