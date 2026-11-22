// Loopback server on tests/fixtures/blank.mjs. No AI run or user data is touched.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CONFIG_PREFERENCES_TEST_URL;
const options = { skip: liveServerSkip("CONFIG_PREFERENCES_TEST_URL"), timeout: 120_000 };

test("saved preferences preserve other configuration and update an already-open catalogue", options, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const context = await browser.newContext();
  const config = await context.newPage();
  await config.addInitScript(() => {
    if (!localStorage.getItem("career-ops:config")) localStorage.setItem("career-ops:config", JSON.stringify({ onlyRemoteDefault: true, minSalary: 1_000_000, logos: true, retainedPreference: "keep" }));
  });
  await config.goto(`${origin.origin}/config`);
  const salary = config.getByRole("spinbutton", { name: /gaji.*IDR/i });
  await salary.waitFor();
  await config.waitForFunction(() => document.getElementById("min-salary")?.value === "1000000");
  const catalog = await context.newPage();
  await catalog.goto(`${origin.origin}/loker`);
  await catalog.locator("summary").filter({ hasText: /Filter/ }).click();
  const remote = catalog.getByRole("checkbox", { name: "Hanya Remote", exact: true });
  assert.equal(await remote.isChecked(), true);

  await salary.fill("7250000");
  await config.getByRole("checkbox", { name: /Hanya Remote/ }).uncheck();
  await config.getByRole("checkbox", { name: /logo asli/ }).uncheck();
  await config.getByRole("button", { name: /Simpan Pengaturan/ }).click();
  await config.waitForFunction(() => JSON.parse(localStorage.getItem("career-ops:config")).minSalary === "7250000");
  await catalog.waitForFunction(() => ![...document.querySelectorAll('input[type="checkbox"]')].find((el) => el.closest("label")?.textContent.includes("Hanya Remote"))?.checked);
  assert.equal(await remote.isChecked(), false);
  const stored = await config.evaluate(() => JSON.parse(localStorage.getItem("career-ops:config")));
  assert.deepEqual({ minSalary: stored.minSalary, logos: stored.logos, onlyRemoteDefault: stored.onlyRemoteDefault, retainedPreference: stored.retainedPreference }, { minSalary: "7250000", logos: false, onlyRemoteDefault: false, retainedPreference: "keep" });
  const runtime = await (await config.request.get(`${origin.origin}/api/runtime-policy`)).json();
  if (runtime.candidate.name) await config.getByText(runtime.candidate.name, { exact: true }).waitFor();
  await config.reload();
  await config.waitForFunction(() => document.getElementById("min-salary")?.value === "7250000");
  assert.equal(await config.getByRole("checkbox", { name: /Hanya Remote/ }).isChecked(), false);
  assert.equal(await config.getByRole("checkbox", { name: /logo asli/ }).isChecked(), false);
});

test("settings errors preserve entered values and explicit save can repair corrupt browser preferences", options, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.addInitScript(() => localStorage.setItem("career-ops:config", "broken-json"));
  await page.route("**/api/ai-tester", (route) => route.fulfill({ status: 503, json: { ok: false, error: "Fictional diagnostic unavailable" } }));
  await page.goto(`${origin.origin}/config`);
  await page.getByRole("alert").filter({ hasText: /Preferensi browser/ }).waitFor();
  await page.getByRole("alert").filter({ hasText: "Fictional diagnostic unavailable" }).waitFor();
  const salary = page.getByRole("spinbutton", { name: /gaji.*IDR/i });
  await salary.fill("-1");
  await page.getByRole("button", { name: /Simpan Pengaturan/ }).click();
  await page.getByRole("alert").filter({ hasText: /nol atau lebih/ }).waitFor();
  assert.equal(await salary.inputValue(), "-1");
  await salary.fill("8000000");
  await page.getByRole("button", { name: /Simpan Pengaturan/ }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("career-ops:config")).minSalary === "8000000");
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) { if (key === "career-ops:config") throw new Error("Fictional storage full"); return original.call(this, key, value); };
  });
  await salary.fill("9000000");
  await page.getByRole("button", { name: /Simpan Pengaturan/ }).click();
  await page.getByRole("alert").filter({ hasText: "Fictional storage full" }).waitFor();
  assert.equal(await salary.inputValue(), "9000000");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("career-ops:config")).minSalary), "8000000");
});
