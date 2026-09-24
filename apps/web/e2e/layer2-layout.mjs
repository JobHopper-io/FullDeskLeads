import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";

// Layer 2 layout check against the real app + API. Needs `pnpm dev` running (web :5173, api :3000) and the
// repo .env. Logs in as the seeded tenant-A user, then patches /api/leads responses in the browser only (no data
// is changed) to inject the spec's long stress strings. Run from apps/web: node e2e/layer2-layout.mjs [screenshotDir]
// Needs Chromium: npx playwright install chromium
const env = Object.fromEntries(readFileSync("../../.env", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)]));
const SP = process.argv[2] ?? tmpdir();
// Real session for the seeded tenant-A user (admin magic link -> verified token), injected into the app's Supabase storage.
const gl = await (await fetch(`${env.SUPABASE_URL}/auth/v1/admin/generate_link`, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", email: "dummy-tenant-a@fulldeskleads.test" }) })).json();
const session = await (await fetch(`${env.SUPABASE_URL}/auth/v1/verify`, { method: "POST", headers: { apikey: env.SUPABASE_ANON_KEY, "content-type": "application/json" }, body: JSON.stringify({ type: "magiclink", token_hash: gl.hashed_token }) })).json();
const key = `sb-${new URL(env.SUPABASE_URL).hostname.split(".")[0]}-auth-token`;

const LONG = {
  company: "Owen-Ames-Kimball Co.",
  roleTitle: "Construction Projects Procurement and Operations Manager",
  contactName: "Alexandria Montgomery-Featherstonehaugh",
  contactTitle: "Senior Vice President of Strategic Procurement and Operations Management",
};
const LONG_REAL = { company: "Industrial Electric Manufacturing", roleTitle: "DIS-TRAN Steel Transfer Portal - Pole Plant 2 Production Welder - Night Shift Opportunity", contactName: "Michael Rapstine", contactTitle: "Senior Manager Infrastructure Operations" };

const browser = await chromium.launch();
let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); };

async function run(label, patch, vp, section, buttonText) {
  const ctx = await browser.newContext({ viewport: vp });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [key, JSON.stringify(session)]);
  const page = await ctx.newPage();
  await page.route("**/api/leads", async (route) => {
    const res = await route.fetch();
    const rows = await res.json();
    // Every row, so whichever lead My Day puts on the card carries the stress strings.
    if (patch) for (const r of rows) Object.assign(r, { company: patch.company, roleTitle: patch.roleTitle, contact: { ...r.contact, name: patch.contactName, title: patch.contactTitle } });
    await route.fulfill({ response: res, json: rows });
  });
  await page.goto("http://localhost:5173/");
  await page.getByRole("button", { name: buttonText }).first().waitFor();
  await page.getByRole("button", { name: buttonText }).first().click();
  await page.waitForSelector(".l2");
  await page.waitForTimeout(300);
  const r = await page.evaluate((section) => {
    const box = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right }; };
    const clipped = [...document.querySelectorAll(".l2-company,.l2-role,.l2-contact-name,.l2-email,.l2-facts dd,.l2 h3,.l2-placeholder")].filter((e) => e.scrollWidth > e.clientWidth + 1 || getComputedStyle(e).textOverflow === "ellipsis").map((e) => e.className || e.tagName);
    return {
      hScroll: document.documentElement.scrollWidth > window.innerWidth,
      clipped,
      phone: box(".l2-phone"), top: box(".l2-top"), target: box(`#${section}`),
      left: box(".l2-left"), centre: box(".l2-centre"), right: box(".l2-right"),
      company: document.querySelector(".l2-company").textContent, role: document.querySelector(".l2-role").firstChild.textContent,
      leaked: /seamless|apollo|lever|greenhouse|priority|fit score|stage/i.test(document.querySelector('.l2').innerText),
      texts: [...document.querySelectorAll(".l2-placeholder")].map((e) => e.textContent), facts: [...document.querySelectorAll(".l2-facts dt,.l2-facts dd")].map((e) => e.textContent),
    };
  }, section);
  console.log(`\n[${label}] ${vp.width}x${vp.height}, "${buttonText}" -> #${section}`);
  check(!r.hScroll, "no horizontal page scroll");
  check(!r.leaked, "no vendor names, internal scores or pipeline detail in Layer 2");
  check(r.clipped.length === 0, `no truncated/clipped text (${r.clipped.join(",") || "none"})`);
  check(r.phone && r.phone.top >= 0 && r.phone.bottom <= vp.height, "phone number visible in the pinned header");
  check(r.target && r.target.top >= r.top.bottom - 1 && r.target.top < vp.height, "target section visible below the pinned header, not under it");
  if (vp.width >= 1200) check(Math.abs(r.left.top - r.centre.top) < 2 && Math.abs(r.centre.top - r.right.top) < 2 && r.left.right <= r.centre.left && r.centre.right <= r.right.left, "three columns side by side");
  else if (vp.width >= 800) check(r.right.top >= Math.max(r.left.bottom, r.centre.bottom) - 1 && r.left.right <= r.centre.left, "left+centre side by side, right column collapsed beneath");
  else check(r.centre.top >= r.left.bottom - 1 && r.right.top >= r.centre.bottom - 1, "single stacked column on a phone");
  if (patch) check(r.company === patch.company && r.role.startsWith(patch.roleTitle), "full company and role text rendered");
  await page.screenshot({ path: `${SP}/l2-${label}-${vp.width}.png`, fullPage: true });
  if (label === "real") console.log("  provenance:", r.facts.join(" | "), "\n  placeholders:", r.texts);
  // StrictMode (dev) fires a second /api/leads that can still be in the route handler when the test finishes.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await ctx.close();
}
for (const vp of [{ width: 1440, height: 900 }, { width: 1100, height: 800 }, { width: 390, height: 800 }]) {
  await run("spec-long", LONG, vp, "objections", "Objection handling");
  await run("real-long", LONG_REAL, vp, "role", "Role detail");
}
await run("real", null, { width: 1440, height: 900 }, "script", "Full script");
await browser.close();
console.log(failures ? `\n${failures} FAILURES` : "\nALL PASS");
