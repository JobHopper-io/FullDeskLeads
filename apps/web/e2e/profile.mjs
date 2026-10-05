// Settings → Profile on the real app: account details, a real display-name change (restored to the exact original
// user_metadata afterwards), and the password-change flow. The password flow is driven against intercepted Supabase
// Auth calls, so no real password is ever typed or changed: the seeded test account's password is what
// apps/web/.env.local auto-logs in with. Needs `pnpm dev`, the repo .env and apps/web/.env.local.
// Run from apps/web: node e2e/profile.mjs [screenshotDir]
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";

const kv = (f) => Object.fromEntries(readFileSync(f, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]));
const env = kv("../../.env");
const SP = process.argv[2] ?? tmpdir();
const APP = process.env.APP ?? "http://localhost:5173";
const svc = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const check = (ok, msg) => { if (!ok) failures++; console.log(`  ${ok ? "PASS" : "FAIL"}  ${msg}`); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto(`${APP}/settings`);
await page.getByRole("heading", { name: "Profile" }).waitFor({ timeout: 60000 });
await page.locator(".profile-facts").getByText("@").waitFor();
const userId = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.endsWith("-auth-token"))[1]).user.id);
const { data: { user: before } } = await svc.auth.admin.getUserById(userId);

try {
  console.log("1. Account details");
  const facts = await page.locator(".profile-facts").innerText();
  const { data: seat } = await svc.from("seats").select("role, tenants(name)").eq("user_id", userId).single();
  check(facts.includes(before.email) && facts.includes(seat.tenants.name) && facts.toLowerCase().includes(seat.role), `email, workspace and role shown: ${facts.replace(/\n/g, " ")}`);

  console.log("\n2. Display name (real change, restored after)");
  const newName = `Test Recruiter ${Date.now().toString(36)}`;
  const nameInput = page.getByLabel("Display name");
  await nameInput.fill(newName);
  await page.getByRole("button", { name: "Save name" }).click();
  await page.getByText("Name saved.").waitFor();
  check((await page.locator(".account-name").innerText()) === newName, `sidebar shows the new name at once: ${await page.locator(".account-name").innerText()}`);
  const { data: { user: afterName } } = await svc.auth.admin.getUserById(userId);
  check(afterName.user_metadata.full_name === newName, "stored in the user's Supabase profile (user_metadata.full_name)");
  await page.reload(); await page.getByLabel("Display name").waitFor();
  check((await page.getByLabel("Display name").inputValue()) === newName, "survives a reload");
  check(await page.getByRole("button", { name: "Save name" }).isDisabled(), "Save name is disabled until the name changes");
  await page.screenshot({ path: `${SP}/settings-profile.png`, fullPage: true });

  console.log("\n3. Password change (Supabase Auth intercepted: nothing real is sent)");
  const session = await page.evaluate(() => JSON.parse(Object.entries(localStorage).find(([k]) => k.endsWith("-auth-token"))[1]));
  let tokenCalls = 0, userUpdates = [];
  let currentIsRight = false;
  await page.route("**/auth/v1/token?grant_type=password", (route) => {
    tokenCalls++;
    return currentIsRight
      ? route.fulfill({ json: session }) // hands back the session already held, so nothing about the login changes
      : route.fulfill({ status: 400, json: { error: "invalid_grant", error_description: "Invalid login credentials" } });
  });
  await page.route("**/auth/v1/user", (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    userUpdates.push(route.request().postDataJSON());
    return route.fulfill({ json: session.user });
  });
  const button = page.getByRole("button", { name: "Change password" });
  await page.getByLabel("Current password").fill("placeholder-current");
  await page.getByLabel("New password", { exact: true }).fill("short");
  check(await button.isDisabled() && await page.getByText("at least 8 characters").isVisible(), "too short: button disabled, reason shown");
  await page.getByLabel("New password", { exact: true }).fill("placeholder-new-1");
  await page.getByLabel("Confirm new password").fill("placeholder-new-2");
  check(await button.isDisabled() && await page.getByText("don't match").isVisible(), "mismatch: button disabled, reason shown");
  await page.getByLabel("Confirm new password").fill("placeholder-new-1");
  check(await button.isEnabled(), "valid: button enabled");
  await button.click();
  await page.getByText("current password isn't right").waitFor();
  check(tokenCalls === 1 && userUpdates.length === 0, "wrong current password: refused, and no password update was attempted");
  currentIsRight = true;
  await button.click();
  await page.getByText("Password changed.").waitFor();
  // supabase-js adds null PKCE fields (code_challenge*) to the body; the password is the only value it sets.
  check(userUpdates.length === 1 && userUpdates[0].password === "placeholder-new-1" && Object.entries(userUpdates[0]).every(([k, v]) => k === "password" || v === null), `right current password: one update carrying the new password (${JSON.stringify(userUpdates)})`);
  check((await page.getByLabel("Current password").inputValue()) === "" && (await page.getByLabel("Confirm new password").inputValue()) === "", "fields cleared after success");
  await page.screenshot({ path: `${SP}/settings-profile-password.png`, fullPage: true });
  await page.unrouteAll({ behavior: "ignoreErrors" });
} finally {
  // The admin API merges user_metadata; a key set to null is removed, so null out anything this run added.
  const { data: { user: now } } = await svc.auth.admin.getUserById(userId);
  const added = Object.fromEntries(Object.keys(now.user_metadata).filter((k) => !(k in before.user_metadata)).map((k) => [k, null]));
  await svc.auth.admin.updateUserById(userId, { user_metadata: { ...before.user_metadata, ...added } });
  const { data: { user: restored } } = await svc.auth.admin.getUserById(userId);
  check(eq(restored.user_metadata, before.user_metadata), `user_metadata restored exactly (${JSON.stringify(restored.user_metadata)})`);
  await browser.close();
}
console.log(failures ? `\n${failures} FAILED` : `\nall checks passed · screenshots in ${SP}`);
process.exit(failures ? 1 : 0);
