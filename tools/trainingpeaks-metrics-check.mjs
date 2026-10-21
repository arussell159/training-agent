// Real entry lifecycle against an isolated synthetic preview; no provider credentials.
// Start fresh: desktop-preview --calendar-edits --lose-metrics-response-once --port=5215.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5215";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "Local synthetic preview required.");
const output = path.resolve("artifacts/trainingpeaks-metrics");
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, colorScheme: "light" });
const page = await context.newPage();
page.setDefaultTimeout(15000);
const checks = [], errors = [], attempts = [];
page.on("pageerror", error => errors.push(error.message));
const endpoint = (url, name) => new URL(url).pathname === `/api/${name}` || new URL(url).searchParams.get("__api_route") === name;
page.on("request", request => { if (request.method() === "POST" && endpoint(request.url(), "calendar/metrics")) attempts.push(request.postDataJSON()); });
await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const dialog = () => page.getByRole("dialog", { name: "Metrics", exact: true });
const button = name => dialog().getByRole("button", { name, exact: true });
const shift = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
const date = d => d.toLocaleDateString("en-CA");
const dayLabel = d => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
const provider = async () => (await page.request.get(`${origin}/api/preview/provider-records`)).json();
const read = async d => (await page.request.get(`${origin}/api/calendar/metrics?date=${date(d)}`)).json();
const nativeWrites = records => records.writes.filter(row => /\/wellness\//.test(row.path));
async function choose(d) {
  await page.getByRole("button", { name: `Add workout for ${dayLabel(d)}`, exact: true }).press("Enter");
  await page.locator(".calendar-add-dialog").getByRole("button", { name: "Metrics", exact: true }).click();
  await dialog().waitFor();
  await dialog().locator(".cme-loading").waitFor({ state: "hidden" });
}
async function edit(label, value, time) {
  await dialog().getByRole("region", { name: `${label} metric`, exact: true }).locator(".cme-card-value").click();
  await dialog().locator(".cme-add-panel").getByLabel(label, { exact: true }).fill(value);
  if (time !== undefined) await dialog().getByLabel(`${label} time`, { exact: true }).fill(time);
  await button("Add").click();
}
async function metricOptions(label, action) {
  const card = dialog().getByRole("region", { name: `${label} metric`, exact: true });
  await card.getByLabel(`${label} options`, { exact: true }).click();
  await card.getByRole("button", { name: action, exact: true }).click();
}
try {
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  const initial = await provider(), d = shift(4);
  await choose(d);
  await dialog().locator(".cme-add-field").first().waitFor();
  await dialog().evaluate(async element => { await Promise.all(element.getAnimations({ subtree: true }).filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {}))); });
  assert.equal(await dialog().getByLabel("Weight", { exact: true }).evaluate(element => document.activeElement === element), true, "Fresh empty-day entry focuses Weight after dialog transitions settle");
  assert.equal(await dialog().locator(".cme-add-field").count(), 14);
  assert.equal(await button("Save").isDisabled(), true);
  assert.equal(await button("Add").isDisabled(), true);
  assert.equal(await dialog().getByLabel("Weight time", { exact: true }).inputValue(), `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "America/Chicago" }).format(new Date())}:00`);
  assert.deepEqual(await dialog().getByLabel("Stress", { exact: true }).locator("option").allTextContents(), ["Select Stress", "None", "Very Low", "Low", "Average", "High", "Very High", "Extreme"]);
  await dialog().getByLabel("Metrics note", { exact: true }).fill("Note alone must not save");
  await button("Close").click();
  assert.equal(await button("Save").isDisabled(), true);
  await button("Add All Metrics").click();
  await dialog().getByLabel("Weight", { exact: true }).fill("1001");
  assert.equal(await button("Add").isDisabled(), true);
  await dialog().getByLabel("Weight", { exact: true }).fill("155");
  await dialog().getByLabel("Weight time", { exact: true }).fill("16:00");
  await dialog().getByLabel("Sleep Hours", { exact: true }).fill("8.25");
  await dialog().getByLabel("Sleep Hours time", { exact: true }).fill("07:15");
  await dialog().getByLabel("Stress", { exact: true }).selectOption("Extreme");
  await dialog().getByLabel("HRV", { exact: true }).fill("0");
  await dialog().getByLabel("HRV time", { exact: true }).fill("");
  assert.equal(await button("Save").isDisabled(), true);
  await button("Add").click();
  assert.equal(await dialog().locator(".cme-metric-card").count(), 4);
  assert.equal(await button("Save").isEnabled(), true);
  assert.equal(nativeWrites(await provider()).length, nativeWrites(initial).length);
  assert.equal(await button("Save").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(24, 108, 225)");
  await page.screenshot({ path: path.join(output, "staged-metrics.png"), animations: "disabled" });
  checks.push("fourteen-fields-exact-ratings-timezone-zero-validation-stage-without-write");

  await button("Close metrics editor").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing", exact: true }).click();
  assert.equal(await dialog().locator(".cme-metric-card").count(), 4);
  await button("Save & Close").click();
  await button("Recheck save").waitFor();
  assert.equal(await dialog().isVisible(), true, "Save & Close cannot dismiss an unconfirmed response");
  let records = await provider();
  const native = nativeWrites(records).slice(nativeWrites(initial).length);
  assert.equal(native.length, 1);
  assert.deepEqual(Object.keys(native[0].body).sort(), ["comments", "hrv", "sleepSecs", "weight"]);
  assert.equal(native[0].body.weight, 155 * 0.45359237);
  assert.equal(native[0].body.sleepSecs, 8.25 * 3600);
  assert.equal(native[0].body.hrv, 0);
  assert.equal(native[0].body.comments, "Note alone must not save");
  await button("Close metrics editor").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Close and keep recovery", exact: true }).click();
  await choose(d);
  await button("Recheck & Close").click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(nativeWrites(await provider()).length, nativeWrites(records).length, "Receipt replay cannot repeat native write");
  assert.deepEqual(attempts[0], attempts[1], "Unconfirmed reply must reuse exact immutable operation and payload");
  checks.push("save-close-uncertain-retained-reopen-exact-receipt-replay-single-native-write");

  await page.reload({ waitUntil: "networkidle" });
  const dayCell = page.locator(`[data-calendar-date="${date(d)}"]`);
  assert.equal(await dayCell.getByRole("button", { name: "View daily metrics", exact: true }).count(), 1);
  await dayCell.getByRole("button", { name: "View daily metrics", exact: true }).click();
  await dialog().locator(".cme-loading").waitFor({ state: "hidden" });
  await dialog().getByRole("region", { name: "Stress metric", exact: true }).getByText("Extreme", { exact: true }).waitFor();
  await dialog().getByRole("region", { name: "HRV metric", exact: true }).getByText("Time not recorded", { exact: true }).waitFor();
  assert.equal(await dialog().getByLabel("Metrics note", { exact: true }).inputValue(), "Note alone must not save");
  await edit("Weight", "0", "");
  await button("Save").click();
  await dialog().getByText("Metrics saved.", { exact: true }).waitFor();
  let saved = await read(d);
  assert.equal(saved.entries.weight.value, 0);
  assert.equal(saved.entries.weight.time, null);
  assert.equal(saved.entries.stress.value, "Extreme");
  assert.equal(saved.entries.sleepHours.value, 8.25);
  records = await provider();
  assert.deepEqual(nativeWrites(records).at(-1).body, { weight: 0 });
  checks.push("calendar-reload-manual-values-null-time-zero-native-narrow-patch-untouched-fields");

  await edit("Weight", "156");
  let rejected = false;
  const reject = async route => {
    if (route.request().method() !== "POST" || !endpoint(route.request().url(), "calendar/metrics")) return route.fallback();
    rejected = true;
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ code: "INVALID_METRICS", error: "Synthetic invalid write" }) });
  };
  await page.route("**/*", reject);
  await button("Save & Close").click();
  await dialog().getByText("Synthetic invalid write", { exact: true }).waitFor();
  assert.equal(rejected, true);
  assert.equal(await dialog().isVisible(), true);
  assert.equal(nativeWrites(await provider()).length, nativeWrites(records).length);
  await page.unroute("**/*", reject);
  assert.match(await dialog().getByRole("region", { name: "Weight metric", exact: true }).innerText(), /156\.0/);
  checks.push("definite-failure-retains-draft-dialog-and-no-native-write");

  // Another tab changes this date after our editor loaded it; do not silently overwrite it.
  const external = await read(d);
  const externalWrite = await page.request.post(`${origin}/api/calendar/metrics`, { data: { date: date(d), revision: external.revision, operationId: "ed18eb4c-3caf-40ca-8a37-c45b5ad376ea", changes: { stress: { value: "Low", time: null } } } });
  assert.equal(externalWrite.ok(), true);
  await button("Save").click();
  await button("Reload latest values").waitFor();
  assert.match(await dialog().getByRole("region", { name: "Weight metric", exact: true }).innerText(), /156\.0/);
  assert.equal((await read(d)).entries.weight.value, 0);
  await button("Reload latest values").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Keep editing", exact: true }).click();
  await button("Reload latest values").click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Reload latest values", exact: true }).click();
  await dialog().getByRole("region", { name: "Stress metric", exact: true }).getByText("Low", { exact: true }).waitFor();
  assert.match(await dialog().getByRole("region", { name: "Weight metric", exact: true }).innerText(), /0\.0/);
  checks.push("cross-tab-revision-conflict-preserves-draft-explicit-reload-only");

  await edit("Weight", "157");
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let entered = false;
  const hold = async route => {
    if (route.request().method() !== "POST" || !endpoint(route.request().url(), "calendar/metrics")) return route.fallback();
    entered = true; await held; await route.continue();
  };
  await page.route("**/*", hold);
  await button("Save & Close").click();
  await page.waitForFunction(() => document.querySelector('.cme-header-actions button')?.textContent.includes("Saving"));
  assert.equal(entered, true);
  await dialog().press("Escape");
  assert.equal(await dialog().isVisible(), true);
  assert.equal(await button("Close metrics editor").isDisabled(), true);
  assert.equal(await button("Save & Close").isDisabled(), true);
  release();
  await dialog().waitFor({ state: "hidden" });
  await page.unroute("**/*", hold);
  assert.equal((await read(d)).entries.weight.value, 157);
  checks.push("busy-save-close-awaits-real-write-prevents-close-and-duplicate-actions");

  const metadataDay = shift(5), beforeMetadata = nativeWrites(await provider()).length;
  await choose(metadataDay);
  await dialog().getByLabel("Stress", { exact: true }).selectOption("None");
  await button("Add").click();
  await button("Save & Close").click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal(nativeWrites(await provider()).length, beforeMetadata, "A subjective field must never be coerced into native ratings");
  await page.reload({ waitUntil: "networkidle" });
  const metadataCell = page.locator(`[data-calendar-date="${date(metadataDay)}"]`);
  await metadataCell.getByRole("button", { name: "View daily metrics", exact: true }).click();
  await dialog().getByRole("region", { name: "Stress metric", exact: true }).waitFor();
  await metricOptions("Stress", "Clear recorded value");
  assert.equal(await button("Save & Close").isEnabled(), true, "Clearing the final saved value remains saveable");
  await button("Save & Close").click();
  await dialog().waitFor({ state: "hidden" });
  assert.equal((await read(metadataDay)).entries.stress.value, null);
  assert.equal(nativeWrites(await provider()).length, beforeMetadata);
  assert.equal(await metadataCell.getByRole("button", { name: "View daily metrics", exact: true }).count(), 0);
  checks.push("metadata-only-day-survives-reload-explicit-clear-last-entry-without-native-write");

  const cleared = await read(metadataDay);
  const noteOnly = await page.request.post(`${origin}/api/calendar/metrics`, { data: { date: date(metadataDay), revision: cleared.revision, operationId: "a4655e7d-199b-48ec-9da1-a44f6405ddc9", changes: {}, note: "Saved note retained after clearing metrics" } });
  assert.equal(noteOnly.ok(), true);
  await page.reload({ waitUntil: "networkidle" });
  const noteCard = page.locator(`[data-calendar-date="${date(metadataDay)}"]`).getByRole("button", { name: "View daily metrics", exact: true });
  await noteCard.getByText(/Saved note retained/).waitFor();
  await noteCard.click();
  await dialog().locator(".cme-add-field").first().waitFor();
  assert.equal(await dialog().getByLabel("Metrics note", { exact: true }).inputValue(), "Saved note retained after clearing metrics");
  assert.equal(await button("Save").isDisabled(), true);
  checks.push("note-only-retained-record-keeps-calendar-open-affordance-without-enabling-empty-save");
  const allInputs = {
    Weight: "160.5", "Sleep Hours": "7.75", "Resting Heart Rate": "50", MuscleMass: "123.25",
    "Percent Fat": "12.5", "Time in Deep Sleep": "1.25", "Time in REM Sleep": "2.5", HRV: "45.5",
  };
  for (const [label, value] of Object.entries(allInputs)) await dialog().locator(".cme-add-panel").getByLabel(label, { exact: true }).fill(value);
  for (const [label, value] of Object.entries({ "Sleep Quality": "Best", Fatigue: "Very High", Soreness: "Moderately High", Stress: "Low", "Yesterday's Training": "RestDay", "Overall Feeling": "Extremely Superior" }))
    await dialog().getByLabel(label, { exact: true }).selectOption(value);
  await button("Add").click();
  assert.equal(await dialog().locator(".cme-metric-card").count(), 14);
  assert.equal(await button("Add All Metrics").isDisabled(), true);
  await button("Save & Close").click();
  await dialog().waitFor({ state: "hidden" });
  const allSaved = await read(metadataDay);
  assert.equal(Object.values(allSaved.entries).filter(entry => entry.value !== null).length, 14);
  assert.equal(allSaved.entries.overallFeeling.value, "Extremely Superior");
  assert.equal(allSaved.entries.yesterdayTraining.value, "RestDay");
  assert.equal(allSaved.entries.deepSleepHours.value, 1.25);
  assert.equal(allSaved.entries.muscleMass.value, 123.25);
  assert.deepEqual(Object.keys(nativeWrites(await provider()).at(-1).body).sort(), ["bodyFat", "hrv", "restingHR", "sleepSecs", "weight"]);
  checks.push("all-fourteen-values-roundtrip-exact-subjective-scales-with-only-five-native-fields");

  await choose(d);
  await dialog().getByLabel("Graph 1", { exact: true }).selectOption("Sleep Hours");
  await edit("Weight", "158");
  assert.equal(await button("Save").isEnabled(), true);
  assert.equal(await button("Save & Close").isDisabled(), true);
  await button("Save layout").click();
  await button("Save layout").waitFor({ state: "hidden" });
  await page.waitForFunction(() => [...document.querySelectorAll('.cme-header-actions button')].find(element => element.textContent === "Save & Close")?.disabled === false);
  await button("Save & Close").click();
  await dialog().waitFor({ state: "hidden" });
  checks.push("history-layout-dirty-prevents-save-close-until-real-layout-persistence");
  assert.equal((await provider()).events.length, initial.events.length, "Metrics never creates a workout event");
  assert.deepEqual(errors, []);
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), animations: "disabled" }).catch(() => {});
  throw error;
} finally {
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ checks, errors, attempts }, null, 2));
  console.log(JSON.stringify({ checks, errors }, null, 2));
  await browser.close();
}
