// Exercise the real app with synthetic auth, context and recording responses.
// Every API and off-origin request is intercepted; no database is contacted.
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
const id = "activity:fixture", date = "2026-10-06";
const workout = { id, activity_id: "fixture", workout_date: date, date, day: "Today", sport: "Run", title: "Deep link fixture", duration: "20m", goal: "Easy", status: "completed", workout_summary: { planned: null, completed: { duration_seconds: 1200, distance_meters: 3000 } } };
const training = (available) => ({ athlete: { name: "Fixture", time_zone: "America/Chicago", zones: {} }, metrics: {}, wellness: {}, wellness_history: [], history: available ? [workout] : [], planned: [], source: "intervals.icu", version: "isolated-deep-link", cache_scope: "isolated-deep-link" });

try {
  for (const mode of ["missing-retry", "error-retry", "missing-back", "corrupt-snapshot"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(({ mode, id }) => {
      localStorage.setItem("theme", "dark");
      if (mode === "corrupt-snapshot") sessionStorage.setItem("training-agent-open-workout-v1", JSON.stringify({ id, sport: {}, workout_summary: "broken" }));
      window.__deepLinkShifts = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput)
          window.__deepLinkShifts.push({ value: entry.value, sources: entry.sources.map((source) => source.node?.className) });
      }).observe({ type: "layout-shift", buffered: true });
    }, { mode, id });
    const calls = [], errors = [];
    let fullReads = 0;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/")) return route.continue();
      const api = url.searchParams.get("__api_route") || url.pathname.slice(5);
      calls.push(api);
      let body = {}, status = 200;
      if (api === "auth/session") {
        await new Promise((resolve) => setTimeout(resolve, 100));
        body = { configured: true, authenticated: true, hasPasskey: false, passkeysSupported: false };
      } else if (api === "training-context") {
        const full = url.searchParams.get("scope") === "full";
        if (full) fullReads++;
        await new Promise((resolve) => setTimeout(resolve, 400));
        if (full && fullReads === 1 && mode === "error-retry") { status = 503; body = { error: "Fixture temporarily unavailable" }; }
        else body = training(mode === "corrupt-snapshot" || (full && fullReads > 1));
      } else if (api.includes("/summary")) body = { duration_seconds: 1200, distance_meters: 3000 };
      else if (api.includes("/analysis")) body = { duration: 0, points: [], laps: [], intervals: [] };
      else if (api.includes("/route")) body = { points: [] };
      else if (api === "section11-sync") body = { status: "complete", version: "isolated-deep-link" };
      else if (api === "annual-plans") body = { plans: [] };
      return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/?workout=${encodeURIComponent(id)}`, { waitUntil: "domcontentloaded" });
    if (mode !== "corrupt-snapshot") {
      const unavailable = page.getByRole("alert").filter({ hasText: "Workout unavailable" });
      await unavailable.waitFor();
      assert.equal(new URL(page.url()).searchParams.get("workout"), id, "Unavailable workouts must preserve the deep link for retry");
      assert.equal(fullReads, 1, "Missing or failed data must not create an automatic request loop");
      if (mode === "missing-back") {
        await unavailable.getByRole("button", { name: "Back", exact: true }).click();
        await unavailable.waitFor({ state: "detached" });
        assert.equal(new URL(page.url()).searchParams.get("workout"), null, "Back must clear the pending workout URL");
      } else {
        await unavailable.getByRole("button", { name: "Try again", exact: true }).click();
        await page.locator(".workout-mobile-sheet").waitFor();
        assert.equal(fullReads, 2, "An explicit retry must make one fresh request");
        assert.equal(new URL(page.url()).searchParams.get("workout"), id);
      }
    } else {
      await page.locator(".workout-mobile-sheet").waitFor();
      assert.equal(fullReads, 1, "A corrupt saved snapshot must resolve from validated context");
    }
    if (mode !== "missing-back") {
      assert.ok((await page.locator(".workout-mobile-sheet").innerText()).includes(workout.title));
      await page.locator(".workout-mobile-map").getByText("No GPS route recorded.", { exact: true }).waitFor();
    }
    assert.equal(calls.filter((api) => api === "training-context").length, fullReads, "A resolved full context must also supply the current week and zones");
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    const shifts = await page.evaluate(() => window.__deepLinkShifts);
    assert.deepEqual(shifts, [], `${mode}: cold loading must retain its screen geometry`);
    await page.screenshot({ path: path.join(output, `deep-link-${mode}.png`), fullPage: true });
    results.push({ mode, fullReads, calls, errors, shifts });
    await context.close();
  }
  await fs.writeFile(path.join(output, "deep-link-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
