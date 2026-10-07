// Browser checks use isolated API fixtures only, including the real startup UI.
// Start Vite with ui/tests/navigation.vite.config.ts before running this script.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    )
  );
}
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5177";
const browser = await playwright.chromium.launch({
  headless: true,
  channel: process.env.APP_TEST_BROWSER || "msedge",
});
const output = path.resolve("artifacts/reliability");
await fs.mkdir(output, { recursive: true });
const results = [];
try {
  for (const viewport of process.argv.includes("--startup-only")
    ? []
    : [
        { width: 390, height: 844 },
        { width: 1440, height: 1000 },
      ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await page.goto(`${origin}/tests/navigation.html`, { waitUntil: "networkidle" });
    await page.locator("#inspect").click();
    const initial = JSON.parse(await page.locator("#result").textContent());
    assert.deepEqual(initial.errors, [], JSON.stringify(initial));
    assert.equal(initial.horizontalOverflow, false, JSON.stringify(initial));
    if (viewport.width < 768) {
      await page.locator("#cold").click();
      await page.locator("textarea").first().waitFor();
      const quickAdd = JSON.parse(await page.locator("#result").textContent());
      assert.equal(
        quickAdd.logStillLoading,
        true,
        "Quick add must open during the delayed nutrition request"
      );
      assert.ok(quickAdd.focus, "The keyboard target must already be focused");
    }
    await page.locator("#stress").click();
    await page.waitForFunction(() => !document.querySelector("#stress").disabled, null, {
      timeout: 60_000,
    });
    const stress = JSON.parse(await page.locator("#result").textContent());
    assert.deepEqual(stress.errors, [], JSON.stringify(stress));
    assert.equal(stress.horizontalOverflow, false, JSON.stringify(stress));
    assert.ok(stress.transitions >= 100, JSON.stringify(stress));
    assert.ok(stress.screens <= 1, JSON.stringify(stress));
    assert.ok(!stress.inert, JSON.stringify(stress));
    await page.screenshot({
      path: path.join(output, `navigation-${viewport.width}.png`),
      fullPage: true,
    });
    results.push({ viewport, initial, stress });
    await context.close();
  }

  for (const viewport of process.argv.includes("--navigation-only")
    ? []
    : [
        { width: 390, height: 844 },
        { width: 1440, height: 1000 },
      ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    const errors = [],
      calls = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem("theme", "dark");
      window.__layoutShifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries())
          if (!entry.hadRecentInput)
            window.__layoutShifts.push({
              value: entry.value,
              sources: entry.sources?.map((source) => source.node?.className),
            });
      }).observe({ type: "layout-shift", buffered: true });
    });
    const date = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    const training = {
      athlete: { name: "Reliability fixture", time_zone: "America/Chicago", zones: {} },
      metrics: { fitness: 50, fatigue: 40, form: 10 },
      wellness: {},
      wellness_history: [],
      planned: [],
      history: [],
      source: "intervals.icu",
      version: "isolated-startup-v1",
      cache_scope: "isolated-startup",
    };
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const api = url.searchParams.get("__api_route") || url.pathname.slice(5);
      calls.push(api);
      let result = {};
      if (api === "auth/session") {
        await new Promise((resolve) => setTimeout(resolve, 400));
        result = {
          configured: true,
          authenticated: true,
          hasPasskey: false,
          passkeysSupported: false,
        };
      } else if (api.startsWith("training-context")) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        result = training;
      } else if (api === "annual-plans") {
        await new Promise((resolve) => setTimeout(resolve, 2200));
        result = {
          plans: [
            {
              id: "fixture-plan",
              events: [
                {
                  id: "fixture-race",
                  name: "Delayed race fixture",
                  date,
                  sport: "Run",
                  priority: "A",
                },
              ],
            },
          ],
        };
      } else if (api === "section11-sync")
        result = { status: "complete", version: training.version };
      else if (api === "config") result = { theme: "dark" };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(result),
      });
    });
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.waitForTimeout(3000);
    const state = await page.evaluate(() => ({
      shifts: window.__layoutShifts,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      dark: document.documentElement.classList.contains("dark"),
    }));
    assert.deepEqual(errors, []);
    assert.equal(state.horizontalOverflow, false);
    assert.deepEqual(state.shifts, [], "Delayed startup data must not move the page");
    assert.equal(state.dark, true, "The saved theme must be applied before startup");
    assert.equal(
      calls.filter((api) => api === "auth/session").length,
      1,
      "StrictMode must share the initial session read"
    );
    assert.equal(
      calls.filter((api) => api === "training-updates").length,
      0,
      "Initial data load must not race a duplicate background refresh"
    );
    assert.equal(
      calls.filter((api) => api.startsWith("activities/")).length,
      0,
      "Startup must not eagerly download recordings"
    );
    assert.ok(
      calls.filter((api) => api.startsWith("nutrition")).length <= 1,
      `Only the visible Home nutrition summary should fetch: ${calls}`
    );
    await page.screenshot({
      path: path.join(output, `startup-${viewport.width}.png`),
      fullPage: true,
    });
    results.push({ viewport, startup: state, calls });
    await context.close();
  }
  const resultName = process.argv.includes("--startup-only")
    ? "startup-results.json"
    : process.argv.includes("--navigation-only")
      ? "navigation-results.json"
      : "results.json";
  await fs.writeFile(path.join(output, resultName), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
}
