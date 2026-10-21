// Verify real virtual-calendar anchoring against delayed, growing synthetic data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
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
const port = Number(process.env.CALENDAR_PREVIEW_PORT || 5270),
  origin = `http://127.0.0.1:${port}`,
  output = "artifacts/performance-2026-10-21/calendar-anchor.json";
const server = spawn(process.execPath, ["tools/calendar-performance-preview.mjs"], {
  env: { ...process.env, CALENDAR_PREVIEW_PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let browser;
const checks = [];
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(Error(`Fixture ${code}`)));
  });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  for (const viewport of [
    { width: 1280, height: 820 },
    { width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport, colorScheme: "light" }),
      page = await context.newPage();
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await page.request.get(`${origin}/_test/config?grow=0&slow=0`);
    await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
    await page.locator("[data-workout-id]").first().waitFor();
    const date = new Date(),
      today = date.toLocaleDateString("en-CA");
    date.setDate(date.getDate() - 1);
    const yesterday = date.toLocaleDateString("en-CA");
    if(viewport.width>=768)await page.getByRole("button", { name: "Today", exact: true }).click();
    else await page.evaluate(() => window.dispatchEvent(new Event("calendar-go-today")));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const top = () =>
      page.evaluate((today) => {
        const day = document.querySelector(`[data-calendar-date="${today}"]`);
        const heading = day?.querySelector(".mobile-calendar-day-heading");
        return (heading || day)?.getBoundingClientRect().top;
      }, today);
    const before = await top();
    assert.ok(Number.isFinite(before));
    await page.request.get(`${origin}/_test/config?grow=1&slow=700`);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(
      ({ yesterday }) =>
        document
          .querySelector(`[data-calendar-date="${yesterday}"]`)
          ?.querySelectorAll("[data-workout-id]").length === 9,
      { yesterday }
    );
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const after = await top();
    assert.ok(
      Math.abs(after - before) <= 2,
      `Visible date moved ${after - before}px after earlier cards grew (${viewport.width}px viewport)`
    );
    await page.mouse.wheel(0, -2400);
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    await page.evaluate(() => window.dispatchEvent(new Event("calendar-go-today")));
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const restored = await top();
    assert.ok(
      Math.abs(restored - before) <= 2,
      `Today navigation moved anchor ${restored - before}px`
    );
    checks.push({ viewport, before, after, restored, earlierDayWorkoutCount: 9, verified: true });
    console.log(JSON.stringify(checks.at(-1)));
    await context.close();
  }
} finally {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify({ checks }, null, 2) + "\n");
  await browser?.close();
  server.kill();
}
