// Stored intelligence on every lead the seat can see, on all three screens: the lead page, Guided and My Day. Needs
// `pnpm dev` (web :5173, api :3000) and apps/web/.env.local (VITE_AUTO_LOGIN_*). Read-only: My Day is shown one lead at
// a time by putting it first (and workable) in /api/leads in the browser only; no data changes. /api/leads is fetched
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
  if (first) body.unshift({ ...body.splice(body.findIndex((x) => x.id === first), 1)[0], state: "new", nextActionAt: null });
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
const quoted = (os) => os.map((o) => [`“${o.objection}”`, `“${o.response}”`]);

for (const [n, i] of items.entries()) {
  const expectQ = questionsOf(i);
  const stored = objectionsOf(i);

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

  // Guided
  await page.goto(`${APP}/leads/${i.id}/guided`); await page.waitForSelector(".guided-card");
  await noRaw("guided", i);
  const card = (k) => page.locator(".guided-card").nth(k);
  check((await card(1).locator(".l2-placeholder").count()) === 1, `guided ${i.roleTitle}: Show your work is the placeholder`);
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
  check((await floor.locator(".l2-placeholder").innerText()) === "Show-your-work questions aren't generated yet." && (await floor.locator("blockquote, li").count()) === 0, `my day ${i.roleTitle}: floor panel is the placeholder`);
  const opening = page.locator(".md-opening");
  check(i.openingScript ? (await opening.locator("p").innerText()) === i.openingScript : (await opening.locator(".l2-placeholder").count()) === 1, `my day ${i.roleTitle}: suggested opening ${i.openingScript ? "stored text" : "placeholder"}`);
  const mo = await pairs(".md-objections");
  check(stored ? eq(mo, quoted(stored)) : eq(mo.map(([o]) => o), SLOTLESS.map((o) => `“${o}”`)), `my day ${i.roleTitle}: objections ${stored ? "match stored" : "slotless pair"}`);
  if (n === items.findIndex((x) => x.openingScript)) await page.screenshot({ path: `${process.env.SP ?? "/tmp"}/intel-my-day.png` });
  first = null;
}

check(errors.length === 0, `no browser errors${errors.length ? " " + JSON.stringify(errors.slice(0, 5)) : ""}`);
await browser.close();
console.log(failures ? `\n${failures} FAILED across ${items.length} leads` : `\nall checks passed on ${items.length} leads (lead page, Guided, My Day each)`);
process.exit(failures ? 1 : 0);
