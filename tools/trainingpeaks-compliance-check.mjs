// Independent rendered-card checks; synthetic localhost preview only.
// Run after the lead freezes the rebuilt UI: APP_TEST_ORIGIN=http://127.0.0.1:5218.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const origin = new URL(process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5218").origin;
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Synthetic localhost only");
const output = path.resolve("artifacts/trainingpeaks-compliance");
await fs.mkdir(output, { recursive: true });
const apiPath = value => {
  const url = new URL(value);
  return decodeURIComponent(url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, ""));
};
const cases = [
  { name: "authoritative-null-plan-overrides-stale-legacy", planned: null, completed: { duration_seconds: 3600, tss: 100, distance_meters: 1000 }, grade: "unknown", accent: "#dce0e8" },
  { name: "missing-duration-falls-back-to-tss-fifty-percent", planned: { duration_seconds: null, tss: 100, distance_meters: 1000 }, completed: { duration_seconds: 3600, tss: 150, distance_meters: 1000 }, grade: "medium", accent: "#ffd55b" },
  { name: "missing-duration-and-tss-fall-back-to-distance-sixty-percent", planned: { duration_seconds: null, tss: null, distance_meters: 1000 }, completed: { duration_seconds: 3600, tss: null, distance_meters: 1600 }, grade: "failed", accent: "#fe9301" },
  { name: "good-duration-takes-priority-over-bad-tss", planned: { duration_seconds: 3600, tss: 100, distance_meters: 1000 }, completed: { duration_seconds: 3600, tss: 200, distance_meters: 2000 }, grade: "good", accent: "#78cb28" },
];
const checks = [], errors = [], unexpectedWrites = [], externalRequests = [], httpErrors = [];
const browser = await playwright.chromium.launch({ headless: true, channel: "msedge" });
let activePage, targetId;
try {
  for (const scenario of cases) {
    // No storage/caches/remembered context can cross scenario boundaries.
    const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: "light", serviceWorkers: "block" });
    try {
      const page = await context.newPage();
      activePage = page;
      page.setDefaultTimeout(15000);
      page.on("pageerror", error => errors.push({ scenario: scenario.name, message: error.message }));
      page.on("console", message => { if (message.type() === "error") errors.push({ scenario: scenario.name, message: message.text() }); });
      page.on("response", response => { if (response.status() >= 400) httpErrors.push({ scenario: scenario.name, path: apiPath(response.url()), status: response.status() }); });
      let replacements = 0;
      await context.route("**/*", async route => {
        const request = route.request(), url = new URL(request.url()), api = apiPath(url.href);
        if (url.origin !== origin) {
          externalRequests.push({ scenario: scenario.name, origin: url.origin, method: request.method() });
          return route.abort();
        }
        // These existing POST endpoints only perform reads. All other mutation
        // attempts fail the verification and are blocked before reaching preview.
        if (!["GET", "HEAD"].includes(request.method()) && !(request.method() === "POST" && ["training-live", "coach/reports/catalog", "coach/reports/status"].includes(api))) {
          unexpectedWrites.push({ scenario: scenario.name, api, method: request.method() });
          return route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: "Compliance verification blocks mutations." }) });
        }
        if (request.method() !== "GET" || !["training-context", "training-updates", "workout-history"].includes(api)) return route.continue();
        const response = await route.fetch();
        assert.ok(response.ok(), `Context read failed: ${api}`);
        const source = await response.json(), training = source.context || source;
        const available = [...(training.history || []), ...(training.planned || []), ...(source.workouts || [])];
        const target = available.find(workout => workout.title === "Threshold intervals — recorded power and route" && workout.status === "completed");
        if (target) {
          targetId ??= target.id;
          assert.equal(target.id, targetId, "Every scenario must modify the same existing fixture record");
        }
        const replace = workout => {
          if (workout.id !== targetId) return workout;
          replacements++;
          return {
            ...workout,
            status: "completed",
            // Deliberately stale legacy fields conflict with modern values.
            // A modern null plan must never revive this legacy green target.
            planned: { duration_minutes: 60, tss: 100, distance_meters: 1000 },
            completed_data: { duration_minutes: 60, tss: 100, distance_meters: 1000 },
            plannedDurationMinutes: 60,
            actualDurationMinutes: 60,
            workout_summary: { ...workout.workout_summary, planned: scenario.planned, completed: scenario.completed },
          };
        };
        for (const key of ["history", "planned"]) if (Array.isArray(training[key])) training[key] = training[key].map(replace);
        if (Array.isArray(source.workouts)) source.workouts = source.workouts.map(replace);
        return route.fulfill({ response, json: source });
      });
      const beforeResponse = await context.request.get(`${origin}/api/preview/provider-records`);
      assert.ok(beforeResponse.ok(), "Requires isolated --calendar-edits synthetic preview");
      const before = await beforeResponse.json();
      assert.ok(Array.isArray(before.writes), "Synthetic provider write ledger required");
      await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
      assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true, "Synthetic preview marker required");
      assert.ok(targetId && replacements > 0, "Fixture context interception must change the existing completed record");
      const card = page.locator(`.calendar-workout-card[data-workout-id="${targetId}"]`);
      await card.waitFor({ state: "visible" });
      await page.waitForFunction(({ id, grade }) => document.querySelector(`.calendar-workout-card[data-workout-id="${id}"]`)?.getAttribute("data-completion-grade") === grade, { id: targetId, grade: scenario.grade });
      const rendered = await card.evaluate(node => {
        const style = getComputedStyle(node);
        return { grade: node.dataset.completionGrade, completed: node.dataset.calendarCompleted, accent: style.getPropertyValue("--calendar-status-accent").trim().toLowerCase(), backgroundImage: style.backgroundImage, backgroundColor: style.backgroundColor, text: node.textContent.replace(/\s+/g, " ").trim() };
      });
      assert.equal(rendered.grade, scenario.grade);
      assert.equal(rendered.completed, "true");
      assert.equal(rendered.accent, scenario.accent, "Actual computed card accent must match grade");
      const rgb = scenario.accent.slice(1).match(/../g).map(value => Number.parseInt(value, 16));
      assert.ok(rendered.backgroundImage.includes(`rgb(${rgb.join(", ")})`), "Rendered gradient must use the expected accent color");
      const after = await (await context.request.get(`${origin}/api/preview/provider-records`)).json();
      assert.deepEqual(after.writes, before.writes, "Provider ledger must remain unchanged");
      await page.screenshot({ path: path.join(output, `${scenario.name}.png`), animations: "disabled" });
      checks.push({ name: scenario.name, id: targetId, planned: scenario.planned, completed: scenario.completed, replacements, rendered, providerWrites: after.writes.length - before.writes.length });
    } catch (error) {
      await activePage?.screenshot({ path: path.join(output, `${scenario.name}-failure.png`), fullPage: true }).catch(() => {});
      throw error;
    } finally {
      await context.close();
      activePage = null;
    }
  }
  assert.deepEqual(unexpectedWrites, [], "No mutation attempts");
  assert.deepEqual(externalRequests, [], "No external requests");
  assert.deepEqual(httpErrors, [], "No HTTP errors");
  assert.deepEqual(errors, [], "No runtime or console errors");
  console.log(JSON.stringify({ passed: checks.length, checks, errors, unexpectedWrites, externalRequests, httpErrors }, null, 2));
} catch (error) {
  await activePage?.screenshot({ path: path.join(output, "failure.png"), fullPage: true }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ passed: checks.length, checks, errors, unexpectedWrites, externalRequests, httpErrors }, null, 2));
  await browser.close();
}
