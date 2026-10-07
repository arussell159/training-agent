// Real dashboard with synthetic events; exercise keyboard access inside fixed cards.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5177";
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.APP_TEST_BROWSER || "msedge" });
const output = path.resolve("artifacts/reliability");
await fs.mkdir(output, { recursive: true });
const results = [];
const date = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(new Date());
const title = "Delayed race fixture with an exceptionally long championship title";
const events = [0, 14, 30].map((offset, index) => ({ id: `fixture-event-${index}`, name: index ? `Reachable event ${index}` : title, date: new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10), priority: ["A", "B", "C"][index], sport: "Run" }));
const training = { athlete: { name: "Fixture", time_zone: "America/Chicago", zones: {} }, metrics: {}, wellness: {}, history: [], planned: [], version: "events-fixture", cache_scope: "events-fixture" };

try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    const errors = [];
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const api = url.searchParams.get("__api_route") || url.pathname.slice(5);
      let body = {};
      if (api === "auth/session") body = { configured: true, authenticated: true, hasPasskey: false, passkeysSupported: false };
      else if (api === "training-context") body = training;
      else if (api === "annual-plans") body = { plans: [{ id: "fixture-plan", events }], activeId: "fixture-plan" };
      else if (api === "section11-sync") body = { status: "complete", version: training.version };
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const card = page.getByRole("region", { name: "Upcoming race events", exact: true });
    await card.getByText("Reachable event 2", { exact: true }).waitFor({ state: "attached" });
    const before = await card.evaluate((element) => ({ height: element.getBoundingClientRect().height, maxScroll: element.scrollHeight - element.clientHeight, overflow: getComputedStyle(element).overflowY }));
    assert.equal(before.height, width >= 1024 ? 195 : 160);
    assert.equal(before.overflow, "auto");
    assert.equal(await card.locator("p[title]").first().getAttribute("title"), title);
    await page.screenshot({ path: path.join(output, `events-initial-${width}.png`), fullPage: true });
    if (before.maxScroll > 0) {
      await card.focus();
      await card.press("End");
      await page.waitForFunction(() => { const card = document.querySelector(".dashboard-events-card"); return card.scrollTop >= card.scrollHeight - card.clientHeight - 1; });
    }
    const after = await card.evaluate((element) => ({ height: element.getBoundingClientRect().height, scrollTop: element.scrollTop }));
    const bounds = await card.boundingBox();
    const row = await card.getByText("Reachable event 2", { exact: true }).boundingBox();
    assert.equal(after.height, before.height, "Scrolling must retain card geometry");
    assert.ok(row.y >= bounds.y && row.y + row.height <= bounds.y + bounds.height, "Final event must be reachable inside the scrollable card");
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    await page.screenshot({ path: path.join(output, `events-scrolled-${width}.png`), fullPage: true });
    results.push({ width, before, after, errors });
    await context.close();
  }
  await fs.writeFile(path.join(output, "events-layout-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
