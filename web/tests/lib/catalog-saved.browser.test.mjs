// Loopback server backed by tests/fixtures/catalog-saved.mjs. Bookmark/status
// writes use the real fixture APIs; only AI output is intercepted, never a model.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { persistEvaluation } from "../../src/lib/report-persist.mjs";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CATALOG_SAVED_TEST_URL;
const options = { skip: liveServerSkip("CATALOG_SAVED_TEST_URL", "CATALOG_SAVED_TEST_ROOT"), timeout: 120_000 };
function assertDisposableRoot() {
  const root = fs.realpathSync(process.env.CATALOG_SAVED_TEST_ROOT);
  const relative = path.relative(fs.realpathSync(os.tmpdir()), root);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  assert.equal(fs.readFileSync(path.join(root, ".catalog-saved-fixture"), "utf8"), "fictional-only\n");
}

test("catalogue separates uncertain location, applies salary notes without hiding jobs, and preserves detail-back filters", options, async (t) => {
  const origin = new URL(url);
  assertDisposableRoot();
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("career-ops:config", JSON.stringify({ onlyRemoteDefault: true, minSalary: 5_000_000, logos: false })));
  await page.goto(`${origin.origin}/loker`);
  const filters = page.getByRole("region", { name: "Filter katalog", exact: true });
  await page.getByRole("link", { name: "Jr. Fixture Engineer 01", exact: true }).waitFor();
  assert.equal(await filters.locator("details").getAttribute("open"), null);
  assert.equal(await page.getByRole("article").count(), 15);
  await page.getByRole("article").filter({ hasText: "Jr. Fixture Engineer 01" }).getByText(/Di bawah target gaji/).waitFor();
  assert.equal(await page.getByRole("link", { name: "Entry Unconfirmed Fixture", exact: true }).count(), 0);
  assert.equal(await page.getByRole("link", { name: "Jr Foreign Fixture", exact: true }).count(), 0);

  await filters.locator("summary").click();
  await filters.getByRole("checkbox", { name: "Hanya Remote", exact: true }).uncheck();
  await filters.getByRole("combobox", { name: "Lowongan per halaman", exact: true }).selectOption("30");
  await page.getByRole("link", { name: "Entry Office Fixture", exact: true }).waitFor();
  assert.equal(await page.getByRole("article").count(), 18);
  await filters.getByRole("button", { name: /Perlu cek lokasi/ }).click();
  await page.getByRole("link", { name: "Entry Unconfirmed Fixture", exact: true }).waitFor();
  assert.equal(await page.getByRole("article").count(), 1);
  assert.equal(await page.getByRole("link", { name: "Jr Foreign Fixture", exact: true }).count(), 0);

  await page.goto(`${origin.origin}/loker?q=Fixture&junior=1&remote=1&size=15&page=2&sort=company_asc`);
  const detail = page.getByRole("link", { name: "Jr. Fixture Engineer 16", exact: true });
  await detail.waitFor();
  await detail.click();
  await page.getByRole("heading", { name: "Jr. Fixture Engineer 16", exact: true }).waitFor();
  await page.getByText("Lokasi memenuhi kebijakan", { exact: true }).waitFor();
  await page.getByRole("link", { name: /Kembali ke Katalog/ }).click();
  await detail.waitFor();
  const query = new URL(page.url()).searchParams;
  assert.equal(query.get("q"), "Fixture");
  assert.equal(query.get("junior"), "1");
  assert.equal(query.get("remote"), "1");
  assert.equal(query.get("page"), "2");
  assert.equal(await page.getByRole("article").count(), 2);
  assert.deepEqual(errors, []);
});

test("manual drafts, canonical status failures, full-JD worker input, and durable cover provenance survive navigation", options, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  assertDisposableRoot();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const dialogs = [];
  page.on("dialog", async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  let failSave = true;
  let failStatus = false;
  const launches = [];
  await page.route("**/api/saved-jobs", (route) => {
    if (route.request().method() !== "POST") return route.continue();
    const body = route.request().postDataJSON();
    if (body.action === "manual" && failSave) { failSave = false; return route.fulfill({ status: 503, json: { ok: false, error: "Fictional save unavailable" } }); }
    if (body.action === "update_status" && failStatus) { failStatus = false; return route.fulfill({ status: 503, json: { ok: false, error: "Fictional tracker unavailable" } }); }
    return route.continue();
  });
  const provenance = { cliId: "omp", provider: "fixture-provider", model: "fixture-model", source: "fixture-output" };
  const cover = "Fictional persisted cover: full description considered; review before sending.";
  await page.route("**/api/run", (route) => {
    const body = route.request().postDataJSON();
    launches.push(body);
    const events = [{ type: "provenance", provenance }, ...(body.kind === "cover" ? [{ type: "text", text: cover }, { type: "done" }] : [{ type: "error", msg: "Fictional full-context extraction failed" }])];
    return route.fulfill({ contentType: "application/x-ndjson", body: events.map((event) => JSON.stringify(event)).join("\n") + "\n" });
  });
  await page.goto(`${origin.origin}/loker/tersimpan`);
  const toggle = page.getByRole("button", { name: /Tambah Loker Manual/ });
  await toggle.click();
  const role = page.getByRole("textbox", { name: "Posisi / Jabatan Lowongan", exact: true });
  const company = page.getByRole("textbox", { name: "Nama Perusahaan", exact: true });
  const description = page.getByRole("textbox", { name: "Teks Deskripsi / Kualifikasi Lowongan Lengkap", exact: true });
  const jd = "Fictional full job description. Build accessible interfaces, maintain TypeScript services, review database migrations, work remotely from Indonesia, and document production incidents. Experience with React, SQL, and ownership of release quality is required. This complete fixture text is not a real job.";
  await role.fill("Manual Fixture Developer");
  await company.fill("Manual Fixture Company");
  await description.fill(jd);
  await page.getByRole("button", { name: "Batal", exact: true }).click();
  await toggle.click();
  assert.equal(await description.inputValue(), jd);
  assert.equal(await role.inputValue(), "Manual Fixture Developer");
  await page.getByRole("button", { name: "Simpan ke Daftar", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fictional save unavailable" }).waitFor();
  assert.equal(await description.inputValue(), jd);
  await page.getByRole("button", { name: "Simpan ke Daftar", exact: true }).click();
  const savedLink = page.getByRole("link", { name: "Manual Fixture Developer", exact: true });
  await savedLink.waitFor();
  const storedJobs = await (await page.request.get(`${origin.origin}/api/saved-jobs`)).json();
  const saved = storedJobs.jobs.find((job) => job.role === "Manual Fixture Developer");
  assert.equal(saved.description, jd);
  assert.match(saved.url, /^local:manual/);
  assert.equal(saved.source, "Manual (Teks)");

  const search = page.getByRole("textbox", { name: "Cari lowongan tersimpan", exact: true });
  await search.fill("no-match-fictional");
  await page.getByRole("heading", { name: /sesuai filter/ }).waitFor();
  assert.equal(await page.getByRole("heading", { name: /Belum ada lowongan tersimpan/ }).count(), 0);
  await search.fill("");
  const status = page.getByRole("combobox", { name: /Status lamaran Manual Fixture Developer/ });
  await status.selectOption("Applied");
  await page.getByText(/Status tracker: Applied/).waitFor();
  failStatus = true;
  await status.selectOption("Interview");
  await page.getByRole("alert").filter({ hasText: "Fictional tracker unavailable" }).waitFor();
  assert.equal(await status.inputValue(), "Applied");
  await page.reload();
  await savedLink.waitFor();
  assert.equal(await status.inputValue(), "Applied");
  await page.getByRole("button", { name: "Analisis Terfokus", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Fictional full-context extraction failed" }).waitFor();
  assert.equal(launches.length, 1);
  assert.equal(launches[0].kind, "evaluate");
  assert.equal(launches[0].input, saved.url);
  assert.equal(launches[0].brief.jobDescription, jd);
  assert.deepEqual(launches[0].evaluationSections, ["summary"]);
  assert.equal(await page.getByText(/Skor Evaluasi:/).count(), 0);

  const persisted = page.waitForResponse((response) => new URL(response.url()).pathname === "/api/runs/save" && response.request().method() === "POST" && response.request().postDataJSON()?.kind === "cover");
  await page.getByRole("button", { name: "Draf Surat Lamaran", exact: true }).click();
  await page.getByText(cover, { exact: true }).waitFor();
  assert.equal((await persisted).ok(), true);
  assert.equal(launches.at(-1).brief.jobDescription, jd);
  await page.evaluate(() => localStorage.removeItem("career-ops:jobs"));
  await page.reload();
  await page.getByText(cover, { exact: true }).waitFor();
  await page.getByText(/Provider: fixture-provider.*Model: fixture-model/).waitFor();
  await page.route("**/api/runs/save", (route) => route.request().method() === "POST" ? route.fulfill({ status: 503, json: { ok: false } }) : route.continue());
  await page.getByRole("button", { name: "Draf Surat Lamaran", exact: true }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("career-ops:jobs") || "[]").some((job) => job.kind === "cover" && job.persistenceError));
  const persistenceError = await page.evaluate(() => JSON.parse(localStorage.getItem("career-ops:jobs")).find((job) => job.kind === "cover" && job.persistenceError).persistenceError);
  await page.getByRole("alert").filter({ hasText: persistenceError }).waitFor();
  assert.deepEqual(dialogs, []);
});

test("a completed evaluation refreshes and displays the persisted report, not stream narration", options, async (t) => {
  assertDisposableRoot();
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const root = process.env.CATALOG_SAVED_TEST_ROOT;
  const coreRoot = fileURLToPath(new URL("../../../", import.meta.url));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const posting = "https://example.test/fixture-01";
  const body = "Persisted report: fixture scheduling requirements are a strong fit.";
  await page.route("**/api/run", async (route) => {
    const request = route.request().postDataJSON();
    assert.equal(request.input, posting);
    const persisted = await persistEvaluation({
      spawnFn: (command, args, options) => spawn(command, args, {
        ...options, env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: coreRoot },
      }),
      execPath: process.execPath, root, coreRoot, url: posting, today: "2026-11-13",
      markdown: `# Evaluasi: Fixture Co 01 -- Jr. Fixture Engineer 01\n\n**URL:** ${posting}\n**Score:** 4.2/5\n**Keputusan:** Lamar\n\n## A) Ringkasan role\n\n${body}\n\n## Machine Summary\n\`\`\`yaml\ncompany: Fixture Co 01\nrole: Jr. Fixture Engineer 01\nscore: 4.2\n\`\`\`\n`,
    });
    assert.equal(persisted.ok, true, persisted.error);
    const events = [{ type: "text", text: "Worker narration only." }, { type: "done", reportN: Number(persisted.num) }];
    await route.fulfill({ contentType: "application/x-ndjson", body: events.map((event) => JSON.stringify(event)).join("\n") + "\n" });
  });
  await page.goto(`${origin.origin}/loker`);
  await page.getByRole("link", { name: "Jr. Fixture Engineer 01", exact: true }).click();
  await page.getByRole("button", { name: "Analisis Lengkap", exact: true }).click();
  await page.getByText(body, { exact: true }).waitFor();
  assert.equal(await page.getByText("Worker narration only.", { exact: true }).count(), 0);
  await page.reload();
  await page.getByText(body, { exact: true }).waitFor();
});
