// Specialty Filters (Settings): saved preferences, Opportunities' default view, the live count, and emit's
// assignment fallback with its "Outside your filters" marker, against the real API + DB.
//
// Needs `pnpm dev` (web :5173, api :3000), migration 0038 applied, the repo .env and apps/web/.env.local
// (VITE_AUTO_LOGIN_*). Run from apps/web (tsx, because it calls the pipeline's TypeScript directly):
//   pnpm exec tsx --env-file=../../.env e2e/specialty-filters.ts [screenshotDir]
//
// It works as the seeded tenant-A user, with disposable tagged fixtures (company/signal/contact/lead per lead),
// and in `finally` deletes every fixture and restores that seat's original saved preferences.
//
// Assignment is exercised through assignLeadToTenant — the exact function emitLead calls to create an
// assignment — rather than emitLead itself, which first re-checks the posting is live on its real job board.
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { assignLeadToTenant } from "../../../packages/pipeline/src/assign/assignLead.ts";

const kv = (f: string) => Object.fromEntries(readFileSync(f, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const env = kv("../../.env");
const web = kv(".env.local");
const API = process.env.API ?? "http://localhost:3000";
const APP = process.env.APP ?? "http://localhost:5173";
const SP = process.argv[2] ?? tmpdir();

const anon = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (ok: boolean, msg: string) => { if (!ok) failures++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); };
const RUN = Date.now().toString(36);
const tag = (s: string) => `SPECTEST_${RUN}_${s}`;

let token = "";
async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const { data: signIn, error: signInError } = await anon.auth.signInWithPassword({ email: web.VITE_AUTO_LOGIN_EMAIL, password: web.VITE_AUTO_LOGIN_PASSWORD });
if (signInError) { console.error("sign-in failed", signInError); process.exit(1); }
token = signIn.session.access_token;
const me = (await api("GET", "/me")).json;
const { tenantId, id: seatId } = me;
console.log(`signed in as ${signIn.user.email}, tenant ${tenantId}, seat ${seatId}\n`);

const { data: originalPrefs } = await svc.from("recruiter_preferences").select("*").eq("seat_id", seatId).maybeSingle();
const created = { companies: [] as string[], signals: [] as string[], contacts: [] as string[], leads: [] as string[], assignments: [] as string[] };

async function makeLead(suffix: string, roleTitle: string) {
  const { data: company } = await svc.from("companies").insert({ name: tag(`Co_${suffix}`) }).select().single();
  created.companies.push(company.id);
  // The tag trails the title: roleFamily() matches on \b word boundaries and "_" is a word character.
  const { data: signal } = await svc.from("hiring_signals").insert({ company_id: company.id, role_title: `${roleTitle} ${tag(suffix)}`, source: "greenhouse", source_posting_id: tag(`p_${suffix}`), status: "active", detected_at: new Date().toISOString() }).select().single();
  created.signals.push(signal.id);
  const { data: contact } = await svc.from("contacts").insert({ company_id: company.id, name: tag(`C_${suffix}`), title: "Plant Manager", phone: "555-0100", confidence_score: 0.8, source: "test" }).select().single();
  created.contacts.push(contact.id);
  const { data: lead } = await svc.from("leads").insert({ contract_version: "test", hiring_signal_id: signal.id, primary_contact_id: contact.id, status: "ready" }).select().single();
  created.leads.push(lead.id);
  return { lead, signal };
}

const putPrefs = (p: object) => api("PUT", "/me/preferences", { industry: [], roleFamily: [], freshness: [], tier: [], archetype: "any", ...p });
const countOf = async (qs: string) => (await api("GET", `/opportunities/count?${qs}`)).json.count as number;

const browser = await chromium.launch();
try {
  console.log("1. Preferences: never-configured vs an explicit saved \"see everything\"");
  await svc.from("recruiter_preferences").delete().eq("seat_id", seatId);
  let got = (await api("GET", "/me/preferences")).json;
  check(got.configured === false && got.preferences.roleFamily.length === 0, "no row -> configured:false");
  let r = await putPrefs({});
  check(r.status === 200 && r.json.configured === true && r.json.preferences.archetype === "any" && Object.values(r.json.preferences).every((v) => v === "any" || (Array.isArray(v) && v.length === 0)), "PUT all-empty (Clear filters) -> configured:true, every axis empty/any");
  const { data: clearedRow } = await svc.from("recruiter_preferences").select("*").eq("seat_id", seatId).maybeSingle();
  check(!!clearedRow && clearedRow.industry_filters.length === 0 && clearedRow.archetype_filter === "any" && clearedRow.fallback_behavior === "expand_to_general_pool", "a real row is stored for the cleared state (not null / not absent)");
  r = await putPrefs({ roleFamily: ["maintenance"], freshness: ["fresh", "recent"], archetype: "no" });
  got = (await api("GET", "/me/preferences")).json;
  check(r.status === 200 && JSON.stringify(got.preferences.roleFamily) === '["maintenance"]' && got.preferences.archetype === "no" && got.preferences.freshness.length === 2, "narrow preferences round-trip");
  check((await putPrefs({ roleFamily: ["bogus"] })).status === 400, "unknown role family rejected (400)");
  check(Array.isArray(got.options.industry) && got.options.industry.includes("the industry"), `industry options served (${got.options.industry.length})`);

  console.log("\n2. Opportunities opens with the saved filters (browser)");
  await putPrefs({ roleFamily: ["maintenance", "finance"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${APP}/opportunities`, { waitUntil: "networkidle" });
  await page.waitForSelector(".opp-active-chips");
  let chips = await page.locator(".opp-active-chips .chip").allInnerTexts();
  check(chips.length === 2 && chips.some((c) => c.startsWith("Maintenance")) && chips.some((c) => c.startsWith("Finance")), `default filter chips come from the table: ${chips.join(" | ")}`);
  await page.screenshot({ path: `${SP}/opportunities-saved-default.png` });
  await putPrefs({});
  await page.goto(`${APP}/opportunities`, { waitUntil: "networkidle" });
  check((await page.locator(".opp-active-chips").count()) === 0, "after saving \"see everything\", next load starts unfiltered");

  console.log("\n3. Live count and the outside-your-filters badge on Opportunities");
  const baseAll = await countOf("");
  const baseMaint = await countOf("roleFamily=maintenance");
  const m1 = await makeLead("m1", "Maintenance Technician");
  const m2 = await makeLead("m2", "Maintenance Supervisor");
  const f1 = await makeLead("f1", "Staff Accountant");
  check((await countOf("")) === baseAll + 3, `unfiltered count +3 with 3 new leads (${baseAll} -> ${baseAll + 3})`);
  check((await countOf("roleFamily=maintenance")) === baseMaint + 2, `roleFamily=maintenance count +2 (${baseMaint} -> ${baseMaint + 2})`);
  check((await countOf("roleFamily=maintenance&tier=full")) === baseMaint, "count composes with other filters (maintenance AND full tier excludes the new bare leads)");
  await putPrefs({ roleFamily: ["maintenance"] });
  const listed = (await api("GET", `/opportunities?q=${encodeURIComponent(tag(""))}&limit=50`)).json.items as any[];
  const flag = (id: string) => listed.find((i) => i.leadId === id)?.outsideFilters;
  check(flag(m1.lead.id) === false && flag(m2.lead.id) === false && flag(f1.lead.id) === true, `Opportunities tags only the non-matching lead (maint:${flag(m1.lead.id)}/${flag(m2.lead.id)} finance:${flag(f1.lead.id)})`);

  console.log("\n4. Settings page: statement, live count, save, clear (browser)");
  await putPrefs({});
  await page.goto(`${APP}/settings`, { waitUntil: "networkidle" });
  check(await page.getByText(/automatically assigned to you/).isVisible(), "the assignment-effect statement is on the page as plain text");
  await page.getByText("Role family").first().click();
  await page.getByRole("checkbox", { name: "Maintenance" }).click();
  await page.getByText(/currently match these filters/).waitFor();
  await page.waitForFunction(() => /currently match/.test(document.querySelector(".settings-count")?.textContent ?? ""));
  const liveText = await page.locator(".settings-count").innerText();
  check(new RegExp(`${baseMaint + 2}\\+? leads? currently match`).test(liveText), `live count updates before saving: "${liveText}"`);
  await page.screenshot({ path: `${SP}/settings-specialty-filters.png` });
  await page.getByRole("button", { name: "Save filters" }).click();
  await page.getByText("Saved.", { exact: true }).waitFor();
  check(JSON.stringify((await api("GET", "/me/preferences")).json.preferences.roleFamily) === '["maintenance"]', "Save persists via PUT (success state shown)");
  await page.getByRole("button", { name: "Clear filters" }).last().click();
  await page.getByText(/Cleared and saved/).waitFor();
  got = (await api("GET", "/me/preferences")).json;
  check(got.configured === true && got.preferences.roleFamily.length === 0, "Clear filters saves an explicit all-leads state (configured:true, empty)");

  console.log("\n5. Assignment: matching routed, fallback tagged, stops when the day is full");
  // Seat load starts at 0 for this seat (older assignments have no seat_id), so target 2 = one matching + one fallback.
  await putPrefs({ roleFamily: ["maintenance"] });
  const assign = async (l: { lead: any; signal: any }, target: number) => {
    const out = await assignLeadToTenant(svc as any, { tenantId, lead: l.lead, hiringSignal: l.signal, target });
    if ("assignment" in out) created.assignments.push(out.assignment.id);
    return out;
  };
  const a1 = await makeLead("a_match", "Maintenance Technician");
  const a2 = await makeLead("a_fb1", "Staff Accountant");
  const a3 = await makeLead("a_fb2", "Staff Accountant");
  const o1: any = await assign(a1, 2), o2: any = await assign(a2, 2), o3: any = await assign(a3, 2);
  check(o1.assignment?.outside_filters === false && o1.assignment?.seat_id === seatId, "matching lead: assigned to the seat, not tagged");
  check(o2.assignment?.outside_filters === true && o2.assignment?.seat_id === seatId, "non-matching lead with room in the day: assigned via fallback, tagged outside_filters");
  check("skipped" in o3, `non-matching lead once the day is full: left in the general pool (${o3.reason ?? "assigned?!"})`);
  const { data: noRow } = await svc.from("lead_assignments").select("id").eq("tenant_id", tenantId).eq("lead_id", a3.lead.id);
  check(noRow!.length === 0, "…and no lead_assignments row exists for it");
  const myDay = (await api("GET", "/leads")).json as any[];
  const tagged = (assignmentId: string) => myDay.find((i) => i.id === assignmentId)?.outsideFilters;
  check(tagged(o1.assignment.id) === false && tagged(o2.assignment.id) === true, "GET /leads (My Day) carries outsideFilters: false for the match, true for the fallback");

  console.log("\n6. A narrow filter that matches nothing: the day still fills, every lead tagged");
  await svc.from("lead_assignments").delete().in("id", created.assignments);
  created.assignments.length = 0;
  await putPrefs({ roleFamily: ["fleet"] });
  const bs = [await makeLead("b1", "Staff Accountant"), await makeLead("b2", "Staff Accountant"), await makeLead("b3", "Staff Accountant"), await makeLead("b4", "Staff Accountant")];
  const outs: any[] = [];
  for (const b of bs) outs.push(await assign(b, 3));
  check(outs.slice(0, 3).every((o) => o.assignment?.outside_filters === true), "three fallback leads fill the day, each tagged outside_filters");
  check("skipped" in outs[3], "the fourth is not added: the day is full");
  const myDay2 = (await api("GET", "/leads")).json as any[];
  check(outs.slice(0, 3).every((o) => myDay2.find((i) => i.id === o.assignment.id)?.outsideFilters === true), "all three show outsideFilters:true on My Day");

  console.log("\n7. Pulling a fallback lead in by hand from Opportunities clears the tag");
  const fbId = outs[0].assignment.id;
  check((await api("POST", `/lead-assignments/${fbId}/release`, {})).status === 200, "release the fallback assignment");
  const claim = await api("POST", "/opportunities/claim", { leadIds: [bs[0].lead.id] });
  check(claim.json?.results?.[0]?.status === "claimed", "claim it again from Opportunities");
  const { data: reclaimed } = await svc.from("lead_assignments").select("outside_filters,state").eq("id", fbId).single();
  check(reclaimed!.state === "new" && reclaimed!.outside_filters === false, "a deliberate claim is not a fallback: outside_filters reset to false");
} finally {
  await browser.close();
  if (created.assignments.length) await svc.from("lead_assignments").delete().in("id", created.assignments);
  await svc.from("lead_assignments").delete().eq("tenant_id", tenantId).in("lead_id", created.leads);
  if (created.leads.length) await svc.from("leads").delete().in("id", created.leads);
  if (created.contacts.length) await svc.from("contacts").delete().in("id", created.contacts);
  if (created.signals.length) await svc.from("hiring_signals").delete().in("id", created.signals);
  if (created.companies.length) await svc.from("companies").delete().in("id", created.companies);
  await svc.from("recruiter_preferences").delete().eq("seat_id", seatId);
  if (originalPrefs) { const { id, ...rest } = originalPrefs; await svc.from("recruiter_preferences").insert(rest); }
  console.log("\nfixtures cleaned up, original preferences restored");
}
console.log(failures ? `\n${failures} FAILED` : `\nall checks passed · screenshots in ${SP}`);
process.exit(failures ? 1 : 0);
