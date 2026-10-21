// Real desktop aggregate-workflow regressions against isolated synthetic APIs.
// Build first; start desktop-preview --calendar-edits on a fresh local port.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5214";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname), "Use an isolated localhost preview only.");
const output = path.resolve("artifacts/trainingpeaks-analysis");
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: "light" });
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [], checks = [], rangeRequests = [];
page.on("pageerror", error => errors.push(error.message));
const apiPath = value => new URL(value).searchParams.get("__api_route") || new URL(value).pathname.replace(/^\/api\//, "");
const isRange = url => apiPath(url.href) === "training-context" && url.searchParams.get("scope") === "range";
page.on("request", request => { const url = new URL(request.url()); if (isRange(url)) rangeRequests.push(request.url()); });
const button = name => page.getByRole("button", { name, exact: true });
const workspace = () => page.getByRole("region", { name: "Training analysis", exact: true });
const shift = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const screenshot = name => page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
async function settled() { await page.waitForFunction(()=>!document.querySelector(".dta-status")&&![...document.querySelectorAll("[data-chart-instance] [role=status]")].some(node=>node.textContent.includes("Loading chart")),null,{timeout:30000}); }
async function preset(value) {
  await page.locator(".dta-date-button").click();
  await page.getByLabel("Dashboard range preset", { exact: true }).selectOption(value);
}
async function sourceRows(start, end) {
  const response = await page.request.get(`${origin}/api/training-context?scope=range&start=${start}&end=${end}`);
  assert.equal(response.ok(), true);
  const data = await response.json(), unique = new Map();
  for (const row of [...data.planned, ...data.history]) {
    if (row.status !== "completed" || row.workout_date < start || row.workout_date > end) continue;
    const key = row.activity_id || (row.id.startsWith("activity:") ? row.id.slice(9) : row.id);
    const previous = unique.get(key);
    if (!previous || row.id.startsWith("activity:")) unique.set(key, row);
  }
  return [...unique.values()];
}
try {
  await page.goto(`${origin}/?theme=light`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  const brand = await page.locator(".home-brand-title").allTextContents();
  await button("Analysis").click();
  await workspace().waitFor();
  await settled();
  assert.equal(await page.getByRole("tab", { name: "Legacy Dashboard", exact: true }).getAttribute("aria-selected"), "true");
  assert.equal(await page.getByRole("region", { name: "Total Duration", exact: true }).count(), 1);
  assert.equal(await page.getByRole("region", { name: "TSS by Week", exact: true }).count(), 1);
  assert.ok(await page.locator(".dta-chart svg").count() >= 3);
  const fixtureToday = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  const firstDay = shift(fixtureToday, -27);
  const untilSunday = (7 - new Date(`${firstDay}T12:00:00Z`).getUTCDay()) % 7;
  const firstWeek = await sourceRows(firstDay, shift(firstDay, untilSunday));
  const knownDurations = firstWeek.flatMap(row => typeof row.workout_summary?.completed?.duration_seconds === "number" ? [row.workout_summary.completed.duration_seconds] : []);
  assert.ok(knownDurations.length, "First-week fixture must have measured durations");
  const expectedSeconds = knownDurations.reduce((sum, value) => sum + value, 0);
  const clock = value => `${Math.floor(value / 3600)}:${String(Math.floor(value % 3600 / 60)).padStart(2, "0")}:${String(Math.round(value % 60)).padStart(2, "0")}`;
  const durationCard = page.getByRole("region", { name: "Total Duration", exact: true });
  await durationCard.locator(".recharts-bar-rectangle").first().hover();
  await page.waitForFunction(expected => document.querySelector('.dta-card[aria-label="Total Duration"] .recharts-tooltip-wrapper')?.textContent.includes(expected), clock(expectedSeconds));
  await page.mouse.move(5, 5);
  assert.deepEqual(await page.locator(".home-brand-title").allTextContents(), brand);
  checks.push("overview-preserved-and-real-aggregate-workspace-opens");
  await screenshot("legacy-dashboard");

  await button("Charts Library").click();
  assert.equal(await page.locator(".ddc-library-tile").count(),27);
  await button("Close charts library").click();
  await button("Remove Run Distance").click();
  await page.getByText("Dashboard saved to server.",{exact:true}).waitFor();
  assert.equal(await page.getByRole("region", { name: "Run Distance", exact: true }).count(), 0);
  await button("Overview").click();
  await button("Analysis").click();
  await settled();
  assert.equal(await page.getByRole("region", { name: "Run Distance", exact: true }).count(), 0, "Chart visibility must survive reopening");
  await button("Charts Library").click();
  await button("Reset chart layout").click();
  await page.getByText("Dashboard saved to server.",{exact:true}).waitFor();
  await button("Close charts library").click();
  assert.equal(await page.getByRole("region", { name: "Run Distance", exact: true }).count(), 1);
  checks.push("chart-library-visibility-persistence-reset-and-overview-return");

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  await page.locator(".dta-date-button").click();
  await page.getByLabel("Analysis start date", { exact: true }).fill(today);
  await page.getByLabel("Analysis end date", { exact: true }).fill(shift(today, -7));
  const beforeInvalid = rangeRequests.length;
  await button("Apply dates").click();
  await page.getByRole("alert").filter({ hasText: "The start date must be on or before the end date." }).waitFor();
  assert.equal(rangeRequests.length, beforeInvalid, "Invalid dates must not start a request");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByLabel("Analysis start date", { exact: true }).count(), 0);
  assert.equal(await page.locator(".dta-date-button").evaluate(node => node === document.activeElement), true);
  checks.push("invalid-custom-range-retains-data-without-request-and-escape-restores-focus");

  let releaseOld, arrived, completeOld;
  const oldWrite = new Promise(resolve => { releaseOld = resolve; });
  const started = new Promise(resolve => { arrived = resolve; });
  const completedOld = new Promise(resolve => { completeOld = resolve; });
  const oldestMonth = `${shift(today, -89).slice(0, 7)}-01`;
  const delayed = async route => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("start") !== oldestMonth) return route.continue();
    arrived(); await oldWrite;
    try { await route.continue(); }
    catch (error) { if (!/Route is already handled|Target.*closed/.test(error.message)) throw error; }
    finally { completeOld(); }
  };
  await page.route(isRange, delayed);
  await preset("90");
  await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(Error("The uncached historical request did not start")), 10000))]);
  try { await preset("7"); await settled(); }
  finally { releaseOld(); await completedOld; }
  await page.unroute(isRange, delayed);
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".dta-date-button").innerText(), `${new Date(`${shift(today, -6)}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })} - ${new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" })}`);
  checks.push("out-of-order-range-response-cannot-replace-current-selection");

  const chartPaths=()=>page.locator(".dta-chart-grid .recharts-bar-rectangle path").evaluateAll(nodes=>nodes.map(node=>[node.getAttribute("d"),node.getAttribute("fill")]));
  const previousCharts = await chartPaths();
  const rejectRange = route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic range refresh failure" }) });
  await page.route(isRange, rejectRange);
  await button("Refresh training analysis").click();
  await page.getByRole("alert").filter({ hasText: "Synthetic range refresh failure" }).first().waitFor();
  assert.deepEqual(await chartPaths(), previousCharts);
  await page.unroute(isRange, rejectRange);
  await button("Retry").click();
  await settled();
  assert.equal(await page.locator(".dta-error").count(), 0);
  checks.push("failed-refresh-preserves-results-and-retry-recovers");

  await page.getByRole("tab", { name: "Legacy Dashboard", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await settled();
  assert.equal(await page.getByRole("tab", { name: "Workout Comparison", exact: true }).getAttribute("aria-selected"), "true");
  const expected = await sourceRows(shift(today, -6), today);
  assert.ok(expected.length >= 2, "Comparison fixture requires multiple measured workouts");
  assert.equal(await page.locator(".dta-comparison tbody tr").count(), expected.length);
  const first = await page.locator(".dta-comparison tbody tr").first().innerText();
  assert.ok(expected.some(row => first.includes(row.title)));
  await page.getByLabel("Analysis activity type", { exact: true }).selectOption("bike");
  assert.equal(await page.locator(".dta-comparison tbody tr").count(), expected.filter(row => /bike|ride|cycl/i.test(row.sport)).length);
  await page.getByLabel("Analysis activity type", { exact: true }).selectOption("all");
  await button("Filters").click();
  await page.getByLabel("Filter comparison workouts", { exact: true }).fill("definitely-no-matching-workout-8f70");
  assert.equal(await page.locator(".dta-comparison tbody tr").count(), 0);
  await page.getByText("No completed workouts match this range and filter.", { exact: true }).waitFor();
  await page.getByLabel("Filter comparison workouts", { exact: true }).fill("");
  await button("Filters").click();
  checks.push("comparison-keyboard-tab-source-row-count-sport-and-text-filters");

  await button("Columns").click();
  await page.getByRole("group", { name: "Visible columns", exact: true }).getByLabel("Average HR", { exact: true }).check();
  await button("Columns").click();
  await page.getByRole("columnheader", { name: /Average HR/ }).waitFor();
  const downloadEvent = page.waitForEvent("download");
  await button("Export CSV").click();
  const download = await downloadEvent;
  assert.equal(await download.failure(), null);
  const csv = await fs.readFile(await download.path(), "utf8");
  assert.ok(csv.includes('"Date","Workout Name","Athlete","Type"'));
  assert.ok(csv.includes("Average HR"));
  for (const row of expected) assert.ok(csv.includes(row.title.replaceAll('"', '""')));
  await fs.writeFile(path.join(output, "comparison.csv"), csv);
  await page.locator(".dta-comparison tbody input[type=checkbox]").nth(0).check();
  await page.locator(".dta-comparison tbody input[type=checkbox]").nth(1).check();
  await button("Compare (2)").click();
  await button("Back to reports").waitFor();
  await button("Back to reports").click();
  assert.equal(await page.locator(".dta-comparison tbody input[type=checkbox]:checked").count(), 2);
  checks.push("comparison-columns-csv-and-real-selected-workout-comparison");
  const target = expected.find(row => typeof row.workout_summary?.completed?.duration_seconds === "number");
  assert.ok(target);
  const activityKey = row => row.activity_id || (row.id.startsWith("activity:") ? row.id.slice(9) : row.id);
  const updatedTitle = "Updated aggregate mutation fixture";
  const changedRange = async route => {
    const response = await route.fetch();
    const data = await response.json();
    for (const row of [...data.planned, ...data.history]) {
      if (activityKey(row) !== activityKey(target)) continue;
      row.title = updatedTitle;
      row.workout_summary.completed.duration_seconds = target.workout_summary.completed.duration_seconds + 60;
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(data) });
  };
  await page.route(isRange, changedRange);
  const beforeMutation = rangeRequests.length;
  await page.evaluate(() => window.dispatchEvent(new Event("training-mutation-settled")));
  await button(updatedTitle).waitFor();
  assert.ok(rangeRequests.length > beforeMutation, "A settled mutation must re-read the historical range");
  const changedRow = page.locator(".dta-comparison tbody tr").filter({ has: button(updatedTitle) });
  assert.ok((await changedRow.innerText()).includes(clock(target.workout_summary.completed.duration_seconds + 60)));
  assert.equal(await page.locator(".dta-comparison tbody input[type=checkbox]:checked").count(), 0, "A refreshed dataset must retire previous comparison selections");
  assert.equal(await button("Compare").isDisabled(), true);
  await page.unroute(isRange, changedRange);
  await button("Refresh training analysis").click();
  await button(updatedTitle).waitFor({ state: "hidden" });
  await settled();
  assert.equal(await button(updatedTitle).count(), 0);
  checks.push("settled-workout-mutation-reloads-values-and-clears-stale-comparison-selection");
  await screenshot("workout-comparison");

  await page.reload({ waitUntil: "networkidle" });
  await button("Analysis").click();
  await settled();
  assert.equal(await page.getByRole("tab", { name: "Workout Comparison", exact: true }).getAttribute("aria-selected"), "true");
  await page.getByRole("columnheader", { name: /Average HR/ }).waitFor();
  assert.equal(await page.locator(".dta-comparison tbody tr").count(), expected.length);
  for (const tab of ["Workout Comparison", "Legacy Dashboard"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await settled();
    for (const [width, height] of [[1280, 820], [1024, 720], [768, 820]]) {
      await page.setViewportSize({ width, height });
      const geometry = await workspace().evaluate(node => ({ right: node.getBoundingClientRect().right, document: document.documentElement.scrollWidth, viewport: innerWidth }));
      assert.ok(geometry.right <= geometry.viewport + 1, `${tab} ${width}: workspace must stay inside the viewport`);
      assert.ok(geometry.document <= geometry.viewport + 1, `${tab} ${width}: table and charts must not widen the document`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  checks.push("dashboard-and-comparison-contain-wide-content-at-three-desktop-widths");
  await button("Overview").click();
  assert.equal(await workspace().count(), 0);
  await button("Analysis").waitFor();
  checks.push("tab-and-column-preferences-survive-reload-original-overview-remains");
  assert.deepEqual(errors, []);
} catch (error) {
  await screenshot("failure");
  console.error((await page.locator(".dta-workspace").allInnerTexts()).join("\n").slice(-9000));
  throw error;
} finally {
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, errors, rangeRequests }, null, 2));
  console.log(JSON.stringify({ checks, errors, rangeRequestCount: rangeRequests.length }, null, 2));
  await browser.close();
}
