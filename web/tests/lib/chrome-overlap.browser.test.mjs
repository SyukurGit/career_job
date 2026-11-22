// Desktop chrome must stay in the sidebar column. At 1440x900 the version
// pill and the Ask button used to sit on the main column: the pill crossed
// out of the 240px sidebar, and Ask covered the bottom-right of the page.
// On short desktop windows the sidebar has no free space at its foot, so Ask
// must stay off its links and controls there.
// Set CHROME_OVERLAP_TEST_URL to a local server. npm test skips this.
import assert from "node:assert/strict";
import { test } from "node:test";
import { liveServerSkip } from "../helpers/live-server.mjs";

const url = process.env.CHROME_OVERLAP_TEST_URL;

function overlapSize(a, b) {
  if (!a || !b) return null;
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return null;
  return { w: Math.round(w), h: Math.round(h) };
}

test("clean shell layout keeps sidebar and BackToTop clear of main content", {
  skip: liveServerSkip("CHROME_OVERLAP_TEST_URL"),
  timeout: 120_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin.origin}/loker`, { waitUntil: "domcontentloaded" });
  const sidebar = page.getByRole("complementary").filter({ has: page.getByRole("navigation") });
  const themeBtn = sidebar.getByRole("button", { name: "Dark mode" });
  await themeBtn.waitFor();

  const main = await page.locator("main").boundingBox();
  const sidebarBox = await sidebar.boundingBox();
  const theme = await themeBtn.boundingBox();
  assert.ok(main && sidebarBox && theme);

  assert.equal(overlapSize(sidebarBox, main), null, "sidebar intersects main");
  assert.equal(overlapSize(theme, main), null, "theme toggle intersects main");
  assert.equal(
    await page.locator('button[aria-label="Ask the assistant"], aside[aria-label="Pre-release build"], button[aria-label="Search"]').count(),
    0,
    "leftover upstream floating chrome should be removed",
  );

  const hits = await page.evaluate(() => {
    const labelAt = (x, y) => {
      const el = document.elementFromPoint(x, y);
      const control = el?.closest("button, a");
      return control?.getAttribute("aria-label") || control?.textContent?.trim() || "";
    };
    return {
      left: labelAt(300, 870),
      right: labelAt(1400, 860),
    };
  });
  assert.equal(hits.left.includes("Report a bug"), false, `bottom of the main column hit ${hits.left}`);
  assert.equal(hits.right.includes("Ask the assistant"), false, `bottom-right of the viewport hit ${hits.right}`);
  assert.deepEqual(errors, []);
});

test("sidebar controls stay within sidebar bounds and remain visible across desktop heights", {
  skip: liveServerSkip("CHROME_OVERLAP_TEST_URL"),
  timeout: 120_000,
}, async (t) => {
  const origin = new URL(url);
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname));
  const { chromium } = await import("playwright-core");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  t.after(() => browser.close());
  for (const height of [480, 560, 720, 900]) {
    const page = await browser.newPage({ viewport: { width: 1280, height } });
    await page.goto(`${origin.origin}/loker`, { waitUntil: "domcontentloaded" });
    const sidebar = page.getByRole("complementary").filter({ has: page.getByRole("navigation") });
    await sidebar.getByRole("button", { name: "Dark mode" }).waitFor();
    const main = await page.locator("main").boundingBox();
    assert.ok(main);
    const controls = await sidebar.locator("a, button").all();
    assert.ok(controls.length >= 6, `expected brand + nav + theme controls, got ${controls.length}`);
    for (const control of controls) {
      const box = await control.boundingBox();
      const name = (await control.getAttribute("aria-label")) || (await control.innerText()).trim();
      assert.equal(overlapSize(box, main), null, `Sidebar control "${name}" intersects main at 1280x${height}`);
    }
    await page.close();
  }
});
