import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url),
  { chromium } = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    )
  );
const origin = process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:5296";
const browser = await chromium.launch({ headless: true, channel: "msedge" }),
  checks = [];
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    timezoneId: "America/Chicago",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await context.route("**/*", (r) =>
    new URL(r.request().url()).origin === origin ? r.continue() : r.abort()
  );
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  await page.locator(".home-athlete-name").waitFor();
  await page.evaluate(() => window.scrollTo({ top: 640, behavior: "instant" }));
  await page.waitForFunction(() => Math.abs(scrollY - 640) < 2);
  await page.getByRole("tab", { name: "Calendar", exact: true }).click();
  await page.locator("[data-calendar-date]").first().waitFor();
  await page.goBack();
  await page.locator(".home-athlete-name").waitFor();
  await page.waitForFunction(() => Math.abs(scrollY - 640) < 2);
  checks.push("Home scroll restored after Calendar Back");
  await page.goForward();
  await page.locator("[data-calendar-date]").first().waitFor();
  checks.push("Calendar Forward opens without stale Home layout");
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const dateSelect = page.locator(`[data-calendar-date="${today}"] select`);
  await dateSelect.selectOption("add");
  await page.getByLabel("Workout name", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Save workout", exact: true }).count(), 1);
  checks.push("Date menu opens mobile workout creation");
  await page.getByRole("button", { name: "Cancel workout editing", exact: true }).click();
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.locator(".home-athlete-name").waitFor();
  await page.waitForFunction(() => scrollY === 0);
  checks.push("Fresh Home navigation starts at zero");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, passed: true }));
} finally {
  await fs.mkdir("artifacts/mobile-stability", { recursive: true });
  await fs.writeFile("artifacts/mobile-stability/navigation.json", JSON.stringify(checks, null, 2));
  await browser.close();
}
