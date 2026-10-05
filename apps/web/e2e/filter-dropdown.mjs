// FilterDropdown (components/FilterDropdown.tsx) behaviour on the real app: popover anchoring, multi- vs single-select
// closing, the selection pill and its ×, only-one-open, and the keyboard path. Needs `pnpm dev` and
// apps/web/.env.local (VITE_AUTO_LOGIN_*). Read-only: it never saves, Settings is reloaded without saving.
// Run from apps/web: node e2e/filter-dropdown.mjs [screenshotDir]
import { chromium } from "@playwright/test";
import { tmpdir } from "node:os";
const SP = process.argv[2] ?? tmpdir();
const b = await chromium.launch(); const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
let fails = 0; const check = (ok, m) => { if (!ok) fails++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${m}`); };
const openLists = () => page.locator('[role="listbox"]').count();
await page.goto("http://localhost:5173/opportunities"); await page.locator(".leads-table, .empty p").first().waitFor({ timeout: 30000 });
const role = page.locator(".fd", { hasText: "Role family" });
// Opportunities opens with the account's saved Specialty Filters; start from none (session-only, nothing is saved).
const clear = page.locator(".filters").getByRole("button", { name: "Clear filters" });
if (await clear.count()) await clear.click();

console.log("mouse");
await role.locator(".fd-trigger").click();
check(await openLists() === 1, "click opens a popover listbox");
const pop = await role.locator(".fd-pop").boundingBox(), trg = await role.locator(".fd-trigger").boundingBox();
check(pop && Math.abs(pop.x - trg.x) < 2 && pop.y > trg.y + trg.height - 1, `anchored under its trigger (trigger x=${Math.round(trg.x)}, popover x=${Math.round(pop.x)})`);
await page.getByRole("option", { name: "Maintenance" }).click();
await page.getByRole("option", { name: "HR", exact: true }).click();
check(await openLists() === 1, "multi-select stays open while picking several");
await page.screenshot({ path: `${SP}/dropdown-open.png` });
await page.mouse.click(1200, 700);
check(await openLists() === 0, "click outside closes it");
const pill = await role.innerText();
check(/Role family:\s*Maintenance, HR/.test(pill) && await role.evaluate((e) => e.classList.contains("fd--active")), `selection shows as a pill on the trigger: "${pill.replace(/\n/g, " ")}"`);
await page.screenshot({ path: `${SP}/dropdown-pill.png` });
await role.locator(".fd-trigger").click();
await page.keyboard.press("Escape");
check(await openLists() === 0 && await page.evaluate(() => document.activeElement?.classList.contains("fd-trigger")), "Escape closes and returns focus to the trigger");
await role.locator(".fd-trigger").click(); await page.getByRole("button", { name: "Done" }).click();
check(await openLists() === 0, "Done closes a multi-select");
await page.locator(".fd", { hasText: "Industry" }).locator(".fd-trigger").click();
await role.locator(".fd-trigger").click();
check(await openLists() === 1 && await page.getByRole("listbox", { name: "Role family" }).count() === 1, "opening another dropdown closes the first (only one open)");
await page.keyboard.press("Escape");
const sort = page.locator(".fd", { hasText: "Sort" });
await sort.locator(".fd-trigger").click(); await page.getByRole("option", { name: "Company name" }).click();
check(await openLists() === 0 && /Sort:\s*Company name/.test(await sort.innerText()), "single-select (Sort) closes on selection and shows the value");
await role.locator(".fd-clear").click();
check(!(await role.evaluate((e) => e.classList.contains("fd--active"))), "× on the pill clears that filter without opening it");

console.log("keyboard only");
await page.goto("http://localhost:5173/settings"); await page.locator(".settings-count").getByText(/currently match/).waitFor({ timeout: 30000 });
// Works whatever the account has saved: an active pill adds its × as an extra tab stop, and the list opens on the
// first selected value, so moves and picks are checked relative to where the list opened.
const roleTrigger = page.locator(".fd", { hasText: "Role family" }).locator(".fd-trigger");
await page.locator(".fd-trigger").first().focus();
for (let i = 0; i < 2 && !(await roleTrigger.evaluate((e) => e === document.activeElement)); i++) await page.keyboard.press("Tab");
check(await roleTrigger.evaluate((e) => e === document.activeElement), "Tab moves to the next dropdown trigger (past an active pill's ×)");
await page.keyboard.press("Enter");
check(await openLists() === 1 && await page.evaluate(() => document.activeElement?.getAttribute("role") === "listbox"), "Enter opens and focus moves into the list");
const optionsText = await page.getByRole("option").allInnerTexts();
const startIdx = optionsText.indexOf(await page.locator(".fd-option.is-active").innerText());
await page.keyboard.press("ArrowDown");
const target = await page.locator(".fd-option.is-active").innerText();
const wasSelected = await page.getByRole("option", { name: target, exact: true }).getAttribute("aria-selected");
await page.keyboard.press(" ");
const nowSelected = await page.getByRole("option", { name: target, exact: true }).getAttribute("aria-selected");
check(optionsText.indexOf(target) === startIdx + 1 && wasSelected !== nowSelected, `↓ moves one option (${optionsText[startIdx]} → ${target}), Space toggles it (${wasSelected} → ${nowSelected})`);
await page.keyboard.press(" ");
await page.keyboard.press("Escape");
check(await openLists() === 0 && await roleTrigger.evaluate((e) => e === document.activeElement), "Escape closes and returns focus to the trigger");
await page.keyboard.press("Space");
check(await openLists() === 1, "Space on the focused trigger opens it too");
await page.keyboard.press("Tab");
check(await openLists() === 0, "Tab out of an open list closes it");
await page.reload();
await b.close(); console.log(fails ? `${fails} FAILED` : "all dropdown checks passed"); process.exit(fails ? 1 : 0);
