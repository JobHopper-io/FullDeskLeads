// My Day + shell check against the real app + API at 1440x900 (spec Figure 8.2). Needs `pnpm dev` (web :5173, api :3000),
// the repo .env and apps/web/.env.local (VITE_AUTO_LOGIN_*). Part 2 reorders /api/leads in the browser only, to put a lead
// with a plant archetype and alternates on top; no data changes. Part 4 logs one real outcome with "Save + next lead"
// and restores the database byte-identical.
// Run from apps/web: node e2e/my-day.mjs [screenshotDir]
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { archetypeForEmployer } from "../../../packages/pipeline/src/intelligence/sources.ts";

const kv = (f) => Object.fromEntries(readFileSync(f, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const env = kv("../../.env");
const SP = process.argv[2] ?? tmpdir();
const APP = process.env.APP ?? "http://localhost:5173";
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

// Same rules as the app, applied to the API's own response.
const ACTIVE = new Set(["new", "viewed", "contacted"]);
const active = (i) => ACTIVE.has(i.state);
const due = (i) => !i.nextActionAt || Date.parse(i.nextActionAt) <= Date.now();
const PLANT_FLOOR = /field service|test supervisor|quality control|production (controller|planner)|materials supervisor|site supervisor|manufacturing engineer|maintenance|technician|welder|machinist|fitter|operator/i;
// My Day ranks by content first (src/lib/intelligence.ts contentTier), then keeps the API's score order.
const tier = (i) =>
  i.openingScript ? 2
  : Array.isArray(i.roleIntelligence?.discoveryQuestions) || Array.isArray(i.objections) || (archetypeForEmployer(i.employer) && PLANT_FLOOR.test(i.roleTitle)) ? 1
  : 0;
const endOfToday = new Date().setHours(24, 0, 0, 0);
const startOfToday = new Date().setHours(0, 0, 0, 0);

const leadsResp = page.waitForResponse((r) => r.url().endsWith("/api/leads"));
await page.goto(`${APP}/my-day`, { waitUntil: "networkidle" });
const items = await (await leadsResp).json();
await page.waitForTimeout(300);
await page.screenshot({ path: `${SP}/my-day.png` });

console.log("1. Shell");
const navText = await page.$$eval(".app-nav a", (as) => as.map((a) => ({ label: a.childNodes[0].textContent.trim(), badge: a.querySelector(".nav-badge")?.textContent ?? null, soon: !!a.querySelector(".soon") })));
check(eq(navText.map((n) => n.label), ["My Day", "New Leads", "Follow-Ups", "Opportunities", "History", "Settings"]), `nav order: ${navText.map((n) => n.label).join(", ")}`);
check((await page.locator(".nav-label").innerText()) === "WORKSPACE", "WORKSPACE label above the nav");
const workable = items.filter((i) => active(i) && due(i)).length;
const unworked = items.filter((i) => active(i) && !i.lastEvent).length;
const dueFu = items.filter((i) => active(i) && i.nextActionAt && Date.parse(i.nextActionAt) < endOfToday).length;
check(navText[0].badge === String(workable), `My Day badge ${navText[0].badge} = workable leads ${workable}`);
check(navText[1].badge === String(unworked), `New Leads badge ${navText[1].badge} = unworked leads ${unworked}`);
check(navText[2].badge === String(dueFu), `Follow-Ups badge ${navText[2].badge} = due follow-ups ${dueFu}`);
check(navText[3].badge === null && navText[3].soon, "Opportunities has no count (Soon)");
check(navText[4].badge === null && navText[5].badge === null, "History and Settings have no count");
const activeNav = await page.$eval(".app-nav a.active", (a) => ({ text: a.childNodes[0].textContent.trim(), shadow: getComputedStyle(a).boxShadow, bg: getComputedStyle(a).backgroundColor }));
check(activeNav.text === "My Day" && activeNav.shadow.includes("rgb(232, 200, 122)") && activeNav.bg !== "rgba(0, 0, 0, 0)", `active item: gold left bar, darker background (${activeNav.bg})`);
check(await page.locator(".account-initials").isVisible() && /seat$/.test(await page.locator(".account-role").innerText()), `seat block: ${JSON.stringify(await page.locator(".account").innerText())}`);

console.log("2. Header");
const sub = await page.locator(".md-sub").innerText();
const queue = items.filter((i) => active(i) && due(i)).sort((a, b) => tier(b) - tier(a));
check(queue.every((i, n) => n === 0 || tier(queue[n - 1]) >= tier(i)), `queue ranked by content: ${[0, 1, 2].map((t) => `${queue.filter((i) => tier(i) === t).length} at tier ${t}`).join(", ")}`);
const doneToday = items.filter((i) => i.lastEvent && Date.parse(i.lastEvent.occurredAt) >= startOfToday && !queue.includes(i)).length;
const dateLine = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
const total = String(doneToday + queue.length).padStart(2, "0");
check(sub === `${dateLine} · lead ${String(doneToday + 1).padStart(Math.max(2, total.length), "0")} of ${total} · Intelligence view`, `subtitle: ${sub}`);
check(await page.getByRole("button", { name: "Manual" }).getAttribute("aria-pressed") === "true", "Mode: Manual pressed");
check(await page.getByRole("button", { name: /Autopilot/ }).isDisabled() && /soon/i.test(await page.getByRole("button", { name: /Autopilot/ }).innerText()), "Mode: Autopilot disabled, Soon");

console.log("3. Sheet, in the figure's order");
const labels = await page.$$eval(".md-body .md-label, .md-body .md-log .eyebrow", (els) => els.map((e) => e.textContent.trim().toUpperCase()));
const leftOrder = ["PRIMARY HIRING CONTACT", "THE PLANT", "SUGGESTED OPENING", "SHOW YOU KNOW THE FLOOR — ASK, DON'T TELL", "LOG THE RESULT"];
const rightOrder = ["THE GAP", "IF HE PUSHES BACK", "IF HE'S NOT THE ONE"];
check(eq(labels, [...leftOrder, ...rightOrder]), `section labels: ${labels.join(" | ")}`);
const top = queue[0];
const tiles = await page.$$eval(".md-stat", (ts) => ts.map((t) => [t.querySelector(".md-stat-value").textContent, t.querySelector(".md-stat-label").textContent]));
console.log(`   tiles: ${JSON.stringify(tiles)}`);
const days = top.postedDate ? Math.round((startOfToday - new Date(...top.postedDate.split("-").map((n, i) => Number(n) - (i === 1 ? 1 : 0)))) / 864e5) : null;
check(tiles[0][0] === (days === null ? "—" : days === 0 ? "Posted today" : `Posted ${days} day${days === 1 ? "" : "s"} ago`) && tiles[0][1] === "Public job posting", `days tile: ${tiles[0].join(" / ")}`);
check(tiles[1][0] === (top.openingCount === null ? "—" : String(top.openingCount)), "openings tile: real count or a dash");
check(tiles[2][0] === (top.pay ? tiles[2][0] : "—") && (top.pay ? tiles[2][0].startsWith("$") || /^[A-Z]{3} /.test(tiles[2][0]) : true), "pay tile: posted floor or a dash");
check(tiles[3][0] === String(1 + top.alternateContacts.length), "contacts on file = primary + alternates");
check((await page.locator(".disposition-grid [role=radio]").count()) === 11, "all eleven dispositions inline");
const save = page.getByRole("button", { name: "Save + next lead" });
check(await save.isVisible() && await save.isDisabled(), "Save + next lead visible, disabled until an outcome is chosen");
const box = await save.boundingBox(), panel = await page.locator(".md-log").boundingBox();
check(box.x + box.width > panel.x + panel.width - 40 && box.y + box.height > panel.y + panel.height - 40, "Save + next lead sits at the panel's bottom right");
check(await page.evaluate(() => document.documentElement.scrollHeight) <= 900, "fits 1440x900 without scrolling");

for (const [name, section] of [["Discovery questions", "role"], ["Full script", "script"], ["Objection handling", "objections"]]) {
  await page.getByRole("link", { name }).click();
  await page.waitForURL(`**/leads/${top.id}?section=${section}`);
  check(true, `${name} -> /leads/:id?section=${section}`);
  await page.goBack();
  await page.waitForURL("**/my-day");
}
const jd = page.getByRole("button", { name: "Job description" });
check(await jd.isDisabled() === !top.jobDescription, `Job description ${top.jobDescription ? "enabled" : "disabled"} (${top.jobDescription?.length ?? 0} lines stored)`);
if (top.jobDescription) {
  await jd.click();
  const shown = await page.$$eval("dialog.jd[open] .jd-body p", (ps) => ps.map((p) => p.textContent));
  check(eq(shown, top.jobDescription.map((l) => l.text)), `dialog shows the stored lines verbatim, in order (${shown.length})`);
  await page.screenshot({ path: `${SP}/my-day-jd.png` });
  await page.getByRole("button", { name: "Close" }).click();
  check(!(await page.locator("dialog.jd[open]").count()), "Close shuts the dialog");
}

console.log("4. A lead with a plant archetype and alternates (browser-only reorder)");
const pickIdx = items.findIndex((i) => active(i) && due(i) && tier(i) === 2 && i.company === "Industrial Electric Manufacturing" && i.alternateContacts.length);
const idx = pickIdx >= 0 ? pickIdx : items.findIndex((i) => active(i) && due(i) && tier(i) === 2 && i.company === "Industrial Electric Manufacturing");
const pick = items[idx];
await page.route("**/api/leads", async (route) => {
  const res = await route.fetch(); const body = await res.json();
  const i = body.findIndex((x) => x.id === pick.id); body.unshift(...body.splice(i, 1));
  await route.fulfill({ response: res, json: body });
});
await page.goto(`${APP}/my-day`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: `${SP}/my-day-archetype.png` });
check((await page.locator(".md-company").innerText()) === pick.company, `showing ${pick.company} · ${pick.roleTitle}`);
const plantFloor = /field service|test supervisor|quality control|production (controller|planner)|materials supervisor|site supervisor|manufacturing engineer|maintenance|technician|welder|machinist|fitter|operator/i.test(pick.roleTitle);
check((await page.locator(".md-chips li").count()) === (plantFloor ? 6 : 0), `equipment chips ${plantFloor ? "shown" : "hidden"} for ${pick.roleTitle}`);
check((await page.locator(".md-objections dt").count()) === 4, "all four objections for an archetype lead");
const others = await page.locator(".md-objections dd").allInnerTexts();
check(others[1].includes("switchgear people"), `industry slot filled: ${others[1]}`);
const alts = await page.locator(".md-alternates li").allInnerTexts();
check(alts.length === pick.alternateContacts.length, `alternates: ${alts.length ? alts.map((a) => a.replace(/\n/g, " ")).join(" | ") : "(none on this lead)"}`);
await page.unroute("**/api/leads");

// The tallest plant-floor sheet: every plant line on screen, plus the longest stored opening.
const floor = items.filter((i) => active(i) && due(i) && tier(i) === 2 && i.company === "Industrial Electric Manufacturing" && /field service|test supervisor|quality control|production (controller|planner)|materials supervisor|site supervisor|manufacturing engineer|maintenance|technician/i.test(i.roleTitle))
  .sort((a, b) => b.openingScript.length - a.openingScript.length)[0];
const fits = async () => (await page.evaluate(() => document.documentElement.scrollHeight)) <= 900 && (await save.boundingBox()).y + (await save.boundingBox()).height <= 900;
await page.route("**/api/leads", async (route) => {
  const res = await route.fetch(); const body = await res.json();
  const i = body.findIndex((x) => x.id === floor.id); body.unshift(...body.splice(i, 1));
  await route.fulfill({ response: res, json: body });
});
await page.goto(`${APP}/my-day`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: `${SP}/my-day-plant-floor.png` });
check((await page.locator(".md-chips li").count()) === 6, `equipment chips shown for plant-floor role ${floor.roleTitle}`);
check((await page.locator(".md-descriptor").count()) === 1 && (await page.locator(".md-floor blockquote").count()) === 2 && !(await page.locator(".md-hard .l2-placeholder").count()), "descriptor, why-hard and both show-your-work lines on screen");
check(await fits(), `fully populated plant-floor sheet fits 1440x900 with Save + next lead on screen (${floor.roleTitle.trim()}, ${floor.openingScript.length}-char opening)`);
await page.unroute("**/api/leads");

// A bare lead ranks last, so it's shown by making it the only workable lead (browser-only).
const bare = items.find((i) => !i.openingScript && !i.roleIntelligence && !i.alternateContacts.length);
await page.route("**/api/leads", async (route) => {
  const body = await (await route.fetch()).json();
  await route.fulfill({ json: body.map((x) => (x.id === bare.id ? { ...x, state: "new", nextActionAt: null } : { ...x, state: "expired" })) });
});
await page.goto(`${APP}/my-day`, { waitUntil: "networkidle" });
await page.waitForTimeout(300);
await page.screenshot({ path: `${SP}/my-day-bare.png` });
check((await page.locator(".md-role").innerText()).startsWith(bare.roleTitle.trim()) && (await page.locator(".md-descriptor").count()) === 0, `bare lead on screen with placeholders (${bare.company} · ${bare.roleTitle.trim()})`);
check(await fits(), "bare sheet fits 1440x900 with Save + next lead on screen");
await page.unroute("**/api/leads");

console.log("5. Save + next lead logs a real outcome and moves on (restored after)");
await page.goto(`${APP}/my-day`, { waitUntil: "networkidle" });
const A = top.id;
const snap = async () => ({ row: (await db.from("lead_assignments").select("*").eq("id", A).single()).data, events: (await db.from("interaction_events").select("*").eq("lead_assignment_id", A).order("id")).data });
const before = await snap();
await page.getByRole("radio", { name: "Left voicemail" }).click();
check(await save.isEnabled(), "choosing Left voicemail (3-day default) enables save");
const resp = page.waitForResponse((r) => r.url().endsWith("/api/outcomes") && r.request().method() === "POST");
await save.click();
const r = await resp; const ev = await r.json();
await page.waitForTimeout(300);
check(r.status() === 201 && ev.disposition === "left_voicemail", `POST /outcomes ${r.status()} ${ev.disposition} -> state ${ev.state}`);
check((await page.locator(".md-company").innerText()) !== top.company || queue[1]?.company === top.company, `next lead on screen: ${await page.locator(".md-company").innerText()}`);
check((await page.locator(".md-sub").innerText()).includes(`lead ${String(doneToday + 2).padStart(2, "0")} of`), `position advanced: ${await page.locator(".md-sub").innerText()}`);
check((await page.locator(".app-notice").innerText()).includes(top.company), `notice: ${await page.locator(".app-notice").innerText()}`);
await page.screenshot({ path: `${SP}/my-day-after-save.png` });
await db.from("interaction_events").delete().eq("id", ev.id);
const { id, ...rest } = before.row; await db.from("lead_assignments").update(rest).eq("id", A);
check(eq(await snap(), before), "database restored byte-identical");

console.log("6. Settings stub");
await page.getByRole("link", { name: "Settings" }).click();
check((await page.locator(".stub h2").innerText()).includes("not built yet"), `Settings: ${await page.locator(".stub h2").innerText()}`);

check(errors.length === 0, `no browser errors${errors.length ? " " + JSON.stringify(errors) : ""}`);
await browser.close();
console.log(failures ? `\n${failures} FAILED` : `\nall checks passed · screenshots in ${SP}`);
process.exit(failures ? 1 : 0);
