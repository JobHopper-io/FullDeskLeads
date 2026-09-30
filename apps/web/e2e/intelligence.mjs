// Stored intelligence on every lead the seat can see, on all three screens: the lead page, Guided and My Day. Needs
// `pnpm dev` (web :5173, api :3000) and apps/web/.env.local (VITE_AUTO_LOGIN_*). Read-only: My Day is shown one lead at
// a time by making it the only workable lead in /api/leads, in the browser only; no data changes. /api/leads is fetched
// from the real API once and that same response serves every later page load (it takes 5-20s a call).
// Run from apps/web: node e2e/intelligence.mjs [staging.json]
//   staging.json (scripts/generate-intelligence.ts --out): also checks every written lead is one the staging file says
//   passed, and every lead it says got fixed content has it.
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";

const APP = process.env.APP ?? "http://localhost:5173";
const staging = process.argv[2] ? JSON.parse(readFileSync(process.argv[2], "utf8")) : null;

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log(`  FAIL  ${msg}`); } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

let items = null;
let leadsP = null;
let first = null; // the lead My Day should show first, as workable
await page.route("**/api/leads", async (route) => {
  items = await (leadsP ??= route.fetch({ timeout: 90_000 }).then((r) => r.json())); // one real fetch; the app asks twice on start
  const body = [...items];
  // My Day ranks by content, so the lead under test is made the only workable one (browser-only).
  if (first) return route.fulfill({ json: body.map((x) => (x.id === first ? { ...x, state: "new", nextActionAt: null } : { ...x, state: "expired" })) });
  await route.fulfill({ json: body });
});
await page.goto(`${APP}/my-day`);
for (let t = 0; !items && t < 900; t++) await page.waitForTimeout(100);
if (!items) throw new Error("/api/leads never answered");

// What each screen must show, from the API's own response.
const questionsOf = (i) => i.roleIntelligence?.discoveryQuestions ?? null;
const SLOTLESS = ["We don't use agencies.", "Too expensive."];
const objectionsOf = (i) => i.objections?.map((o) => ({ objection: o.objection, response: o.response })) ?? null; // jsonb reorders keys
const withQuestions = items.filter(questionsOf), withScript = items.filter((i) => i.openingScript);
console.log(`leads visible to this seat: ${items.length} | with discovery questions + objections stored: ${withQuestions.length} | with a QA-only opening script: ${withScript.length}`);

if (staging) {
  const written = staging.results.filter((r) => r.ok && r.verification.pass && r.generation.why_now.text && r.generation.opening_script.text).map((r) => r.generation.opening_script.text);
  check(withScript.every((i) => written.includes(i.openingScript)), "every opening script on screen is a QA pass from the staging file");
  check(withQuestions.every((i) => staging.results.some((r) => eq(r.discoveryQuestions.questions, questionsOf(i)) && eq(r.objections.pairs, objectionsOf(i)))), "every stored question/objection set matches one the staging file wrote");
  const archetypeEmployers = new Set(staging.results.map((r) => r.employer));
  check(items.every((i) => !!questionsOf(i) === archetypeEmployers.has(i.employer)), "questions stored exactly on the leads whose operating employer has an archetype");
}

const noRaw = async (where, i) => {
  check((await page.locator("pre").count()) === 0, `${where} ${i.roleTitle}: no <pre>`);
  const text = await page.locator("main, #root").first().innerText();
  check(!/"discoveryQuestions"|"objection"\s*:|"response"\s*:|\[\s*\{/.test(text), `${where} ${i.roleTitle}: no JSON text on screen`);
};
const pairs = async (sel) => page.$$eval(`${sel} > div`, (ds) => ds.map((d) => [d.querySelector("dt").textContent, d.querySelector("dd").textContent]));
// The plant layer (plant.ts) is fixed copy per archetype: a lead with an archetype stores discovery questions, so that
// marks it; plant-floor lines follow the same role list as the equipment chips, the gap only a maintenance posting.
const PLANT_FLOOR = /field service|test supervisor|quality control|production (controller|planner)|materials supervisor|site supervisor|manufacturing engineer|maintenance|technician|welder|machinist|fitter|operator/i;
const live = {};
const tally = (field, on) => { live[field] ??= 0; if (on) live[field]++; };
const quoted = (os) => os.map((o) => [`“${o.objection}”`, `“${o.response}”`]);

for (const [n, i] of items.entries()) {
  const expectQ = questionsOf(i);
  const stored = objectionsOf(i);
  const arch = !!expectQ, floorRole = arch && PLANT_FLOOR.test(i.roleTitle), maint = arch && /maintenance/i.test(i.roleTitle);

  // Lead page
  await page.goto(`${APP}/leads/${i.id}`); await page.waitForSelector("#objections dl");
  await noRaw("lead page", i);
  check((await page.locator("#role h3").innerText()) === "Discovery questions", `lead page ${i.roleTitle}: section is titled Discovery questions`);
  const shownQ = await page.locator("#role li").allInnerTexts();
  check(expectQ ? eq(shownQ, expectQ) : shownQ.length === 0 && (await page.locator("#role .l2-placeholder").count()) === 1, `lead page ${i.roleTitle}: questions ${expectQ ? "match stored" : "placeholder"}`);
  const shownO = await pairs("#objections dl");
  check(stored ? eq(shownO, quoted(stored)) : eq(shownO.map(([o]) => o), SLOTLESS.map((o) => `“${o}”`)), `lead page ${i.roleTitle}: objections ${stored ? "match stored" : "are the slotless pair (no archetype)"}`);
  const script = page.locator("#script");
  check(i.openingScript ? (await script.locator(".l2-script").innerText()) === i.openingScript : (await script.locator(".l2-placeholder").count()) === 1, `lead page ${i.roleTitle}: opening ${i.openingScript ? "stored text" : "placeholder"}`);
  const leadClose = await script.locator(".l2-close").count();
  check(leadClose === (arch ? 1 : 0), `lead page ${i.roleTitle}: light close ${arch ? "shown" : "absent"}`);

  // Guided
  await page.goto(`${APP}/leads/${i.id}/guided`); await page.waitForSelector(".guided-card");
  await noRaw("guided", i);
  const card = (k) => page.locator(".guided-card").nth(k);
  const gsw = await card(1).locator(".guided-words").count();
  check(floorRole ? gsw === 2 : gsw === 0 && (await card(1).locator(".l2-placeholder").count()) === 1, `guided ${i.roleTitle}: Show your work ${floorRole ? "has the two lines" : "placeholder"}`);
  const gclose = await card(3).locator(".guided-words").count();
  check(gclose === (arch ? 1 : 0), `guided ${i.roleTitle}: light close ${arch ? "shown" : "placeholder"}`);
  check((await page.locator(".guided-left .guided-plant").count()) === (arch ? 1 : 0), `guided ${i.roleTitle}: plant in one line ${arch ? "shown" : "placeholder"}`);
  for (const [label, key] of [["“I'm busy.”", "busy"], ["“Who is this?”", "who"]]) {
    await page.getByRole("button", { name: label }).click();
    const answered = await page.locator(`#answer-${key} .guided-response`).count();
    check(answered === (arch ? 1 : 0), `guided ${i.roleTitle}: ${key} reply ${arch ? "shown" : "placeholder"}`);
    tally(`"${key}" reply`, answered);
    await page.getByRole("button", { name: label }).click();
  }
  tally("light close", gclose);
  const gq = await card(2).locator("li").allInnerTexts();
  check(expectQ ? eq(gq, expectQ) : gq.length === 0 && (await card(2).locator(".l2-placeholder").count()) === 1, `guided ${i.roleTitle}: Stop and ask ${expectQ ? "lists stored questions" : "placeholder"}`);
  const taps = await page.locator(".guided-objections .guided-objection").allInnerTexts();
  const expectTaps = [...(stored ?? []).filter((o) => o.objection !== "Email me something.").map((o) => `“${o.objection}”`), "“I'm busy.”"];
  check(!stored || eq(taps, expectTaps), `guided ${i.roleTitle}: pushback taps are the stored set`);

  // My Day, this lead first and workable (browser-only)
  first = i.id;
  await page.goto(`${APP}/my-day`); await page.waitForSelector(".md-role");
  check((await page.locator(".md-role").innerText()).startsWith(i.roleTitle.trim()), `my day ${n}: showing ${i.roleTitle}`);
  await noRaw("my day", i);
  const floor = page.locator(".md-floor");
  const sw = await floor.locator("blockquote").count();
  check(floorRole ? sw === 2 : sw === 0 && (await floor.locator(".l2-placeholder").count()) === 1, `my day ${i.roleTitle}: show-your-work ${floorRole ? "two lines" : "placeholder"}`);
  const desc = await page.locator(".md-descriptor").count();
  check(desc === (arch ? 1 : 0), `my day ${i.roleTitle}: descriptor ${arch ? "shown" : "placeholder"}`);
  const hardPh = await page.locator(".md-hard .l2-placeholder").count();
  check(hardPh === (floorRole ? 0 : 1), `my day ${i.roleTitle}: why-hard ${floorRole ? "shown" : "placeholder"}`);
  const gap = await page.locator(".md-gap .md-gap-line").count();
  check(maint || gap === 0, `my day ${i.roleTitle}: no gap line on a non-maintenance role`);
  tally("plant descriptor", desc); tally("why-hard", !hardPh); tally("show-your-work", sw); tally("the gap", gap);
  const opening = page.locator(".md-opening");
  check(i.openingScript ? (await opening.locator("p").innerText()) === i.openingScript : (await opening.locator(".l2-placeholder").count()) === 1, `my day ${i.roleTitle}: suggested opening ${i.openingScript ? "stored text" : "placeholder"}`);
  const mo = await pairs(".md-objections");
  check(stored ? eq(mo, quoted(stored)) : eq(mo.map(([o]) => o), SLOTLESS.map((o) => `“${o}”`)), `my day ${i.roleTitle}: objections ${stored ? "match stored" : "slotless pair"}`);
  if (n === items.findIndex((x) => x.openingScript)) await page.screenshot({ path: `${process.env.SP ?? "/tmp"}/intel-my-day.png` });
  first = null;
}

console.log(`plant layer live on My Day/Guided, of ${items.length} leads: ${JSON.stringify(live)}`);
check(errors.length === 0, `no browser errors${errors.length ? " " + JSON.stringify(errors.slice(0, 5)) : ""}`);
await browser.close();
console.log(failures ? `\n${failures} FAILED across ${items.length} leads` : `\nall checks passed on ${items.length} leads (lead page, Guided, My Day each)`);
process.exit(failures ? 1 : 0);
