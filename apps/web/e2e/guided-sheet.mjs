// Guided Sheet check against the real app + API at 1440x900. Needs `pnpm dev` (web :5173, api :3000), the repo .env and
// apps/web/.env.local (VITE_AUTO_LOGIN_*). Steps through all four stages, taps both interruptions, then logs the same
// outcome once from the Guided view and once from Layer 2 on one real lead, restoring the database after each.
// Run from apps/web: node e2e/guided-sheet.mjs <leadAssignmentId> [screenshotDir]
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const kv = (f) => Object.fromEntries(readFileSync(f, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const env = kv("../../.env");
const A = process.argv[2];
const SP = process.argv[3] ?? tmpdir();
const APP = "http://localhost:5173";
if (!A) throw new Error("usage: node e2e/guided-sheet.mjs <leadAssignmentId> [screenshotDir]");
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); };

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

const states = async (sel) => page.$$eval(sel, (els) => els.map((e) => e.getAttribute("data-state")));
const cardStyle = (i) => page.$eval(`.guided-card:nth-child(${i + 1})`, (e) => {
  const s = getComputedStyle(e); const w = e.querySelector(".l2-placeholder, .guided-words, .l2-raw");
  return { bg: s.backgroundColor, opacity: s.opacity, words: w ? getComputedStyle(w).fontSize : null };
});

console.log("1. Entry points");
// My Day: the header carries a "Guided call" link for the lead on screen.
await page.goto(`${APP}/my-day`, { waitUntil: "networkidle" });
const cardBtn = page.locator(".my-day .md-guided");
check(await cardBtn.isVisible(), `My Day header shows "${await cardBtn.innerText().catch(() => "")}" without opening the lead`);
await page.screenshot({ path: `${SP}/guided-myday.png` });
const cardHref = await cardBtn.getAttribute("href");
await cardBtn.click();
await page.waitForURL("**/guided");
check(new URL(page.url()).pathname === cardHref, `Guided link opens ${cardHref}`);
check(await page.locator(".view-toggle a[aria-current=page]").innerText() === "Guided", "header switch shows Guided as current");
await page.getByRole("button", { name: "← Back" }).click();
await page.waitForURL("**/my-day");
check(new URL(page.url()).pathname === "/my-day", "Back from the Guided view returns to My Day");

// Layer 2: the Intelligence | Guided switch; switching views replaces history, so Back still returns to the origin.
await page.goto(`${APP}/my-day`, { waitUntil: "networkidle" });
await page.goto(`${APP}/leads/${A}`, { waitUntil: "networkidle" });
check(await page.locator(".view-toggle a[aria-current=page]").innerText() === "Intelligence", "Layer 2 switch shows Intelligence as current");
await page.locator(".view-toggle").getByRole("link", { name: "Guided" }).click();
await page.waitForURL(`**/leads/${A}/guided`);
check(page.url().endsWith(`/leads/${A}/guided`), `switch -> ${new URL(page.url()).pathname}`);
await page.screenshot({ path: `${SP}/guided-header.png`, clip: { x: 232, y: 0, width: 1208, height: 130 } });
await page.locator(".view-toggle").getByRole("link", { name: "Intelligence" }).click();
await page.waitForURL(`**/leads/${A}`);
await page.locator(".view-toggle").getByRole("link", { name: "Guided" }).click();
await page.waitForURL(`**/leads/${A}/guided`);
await page.getByRole("button", { name: "← Back" }).click();
await page.waitForURL("**/my-day");
check(new URL(page.url()).pathname === "/my-day", "after switching views back and forth, Back still returns to My Day (no ping-pong)");
await page.goto(`${APP}/leads/${A}/guided`, { waitUntil: "networkidle" });

console.log("2. Step through all four stages");
const expected = [
  ["live", "later", "later", "later"],
  ["done", "live", "later", "later"],
  ["done", "done", "live", "later"],
  ["done", "done", "done", "live"],
];
for (let step = 0; step < 4; step++) {
  await page.waitForTimeout(300); // let the 0.15s opacity transition settle before reading computed styles
  const rail = await states(".guided-step-btn"), cards = await states(".guided-card");
  check(JSON.stringify(rail) === JSON.stringify(expected[step]) && JSON.stringify(cards) === JSON.stringify(expected[step]), `step ${step + 1}: rail ${rail.join("/")} | cards ${cards.join("/")}`);
  const live = await cardStyle(step);
  check(live.bg === "rgb(22, 62, 51)" && live.opacity === "1" && live.words === "20px", `step ${step + 1} live card: green bg ${live.bg}, opacity ${live.opacity}, words ${live.words}`);
  if (step > 0) { const done = await cardStyle(step - 1); check(done.opacity === "0.5", `step ${step} now done: dimmed (opacity ${done.opacity})`); }
  if (step < 3) { const later = await cardStyle(3); check(later.opacity === "0.55", `step 4 still later: greyed (opacity ${later.opacity})`); }
  if (step === 1) await page.screenshot({ path: `${SP}/guided-step2.png` });
  if (step < 3) await page.getByRole("button", { name: "They answered — next step" }).click();
}
check(await page.locator(".guided-card[data-state=live]").getByRole("button", { name: "Log the result" }).isVisible(), "last stage offers \"Log the result\" instead of next step");
await page.getByRole("button", { name: "Back a step" }).click();
check((await states(".guided-card")).join("/") === "done/done/live/later", "\"Back a step\" returns to step 3");
await page.locator(".guided-step-btn", { hasText: "Show your work" }).click();
check((await states(".guided-card")).join("/") === "done/live/later/later", "clicking a rail stage jumps straight to it");

console.log("3. Objection taps");
await page.getByRole("button", { name: "They pushed back" }).click();
check(await page.evaluate(() => document.activeElement?.textContent) === "“I'm busy”", "\"They pushed back\" moves focus to the first objection");
await page.getByRole("button", { name: "“I'm busy”" }).click();
await page.waitForTimeout(300);
const busy = page.locator("#answer-busy");
check(await busy.isVisible() && (await busy.innerText()).includes("I'm busy"), `"I'm busy" opens its words: ${JSON.stringify(await busy.innerText())}`);
check(await page.evaluate(() => document.activeElement?.id) === "answer-busy", "focus jumps to the \"I'm busy\" words");
check((await states(".guided-card")).join("/") === "done/live/later/later", "a tap doesn't lose the caller's place in the steps");
await page.getByRole("button", { name: "“Who is this?”" }).click();
await page.waitForTimeout(300);
check(await page.locator("#answer-who").isVisible() && !(await busy.isVisible()), "\"Who is this?\" opens its own words and closes the other");
check(await page.evaluate(() => document.activeElement?.id) === "answer-who", "focus jumps to the \"Who is this?\" words");
await page.screenshot({ path: `${SP}/guided-objection.png` });

console.log("4. Outcome logging, Guided vs Layer 2 (same lead, restored after each)");
const snapshot = async () => ({ row: (await db.from("lead_assignments").select("*").eq("id", A).single()).data, events: (await db.from("interaction_events").select("*").order("id")).data });
async function logFrom(view) {
  const before = await snapshot();
  await page.goto(`${APP}/leads/${A}${view === "guided" ? "/guided" : ""}`, { waitUntil: "networkidle" });
  if (view === "guided") await page.getByRole("button", { name: "Log the result" }).first().click();
  await page.getByRole("radio", { name: "Left voicemail" }).click();
  const resp = page.waitForResponse((r) => r.url().endsWith("/api/outcomes") && r.request().method() === "POST");
  await page.getByRole("button", { name: "Save outcome" }).click();
  const r = await resp; const body = await r.json();
  await page.waitForLoadState("networkidle");
  const row = (await db.from("lead_assignments").select("state, next_action_at").eq("id", A).single()).data;
  // restore: delete this run's event, put the assignment row back exactly
  await db.from("interaction_events").delete().eq("id", body.id);
  const { id, ...rest } = before.row; await db.from("lead_assignments").update(rest).eq("id", A);
  const after = await snapshot();
  check(JSON.stringify(after) === JSON.stringify(before), `${view}: database restored byte-identical`);
  return { status: r.status(), disposition: body.disposition, state: row.state, followUpDays: Math.round((Date.parse(row.next_action_at) - Date.parse(body.occurred_at)) / 864e5), payload: JSON.stringify(body.payload), url: new URL(page.url()).pathname };
}
const g = await logFrom("guided"), l = await logFrom("layer2");
console.log(`   guided : ${JSON.stringify(g)}\n   layer 2: ${JSON.stringify(l)}`);
check(g.status === 201 && l.status === 201, "both views log with 201");
const same = (o) => JSON.stringify({ ...o, url: undefined });
check(same(g) === same(l), "same disposition, resulting state, follow-up offset and payload from both views");

check(errors.length === 0, `no browser errors${errors.length ? " " + JSON.stringify(errors) : ""}`);
await browser.close();
console.log(failures ? `\n${failures} FAILED` : `\nall checks passed · screenshots in ${SP}`);
process.exit(failures ? 1 : 0);
