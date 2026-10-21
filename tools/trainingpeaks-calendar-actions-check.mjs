// Disposable synthetic preview only. Exercises existing Event/Note/Metrics flows.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
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
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5210";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = path.resolve("artifacts/trainingpeaks-calendar-actions");
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({
  viewport: { width: 1280, height: 820 },
  colorScheme: "light",
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [],
  checks = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/*", (route) =>
  new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
);
const button = (name) => page.getByRole("button", { name, exact: true });
const endpoint = (url, name) =>
  url.pathname === `/api/${name}` || url.searchParams.get("__api_route") === name;
const day = new Date();
day.setDate(day.getDate() + 4);
const date = day.toLocaleDateString("en-CA");
const dayLabel = day.toLocaleDateString("en-US", {
  month: "long",
  day: "numeric",
  year: "numeric",
});
const title = `Synthetic event ${Date.now()}`;
const provider = async () =>
  (await page.request.get(`${origin}/api/preview/provider-records`)).json();
async function choose(label, selected = day) {
  const labelDate = selected.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  await button(`Add workout for ${labelDate}`).press("Enter");
  await page
    .locator(".calendar-add-dialog")
    .getByRole("button", { name: label, exact: true })
    .click();
}
try {
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  const before = await provider();
  await choose("Metrics");
  const metrics = page.getByRole("dialog", { name: "Metrics", exact: true });
  await metrics.waitFor();
  await metrics.getByRole("heading", { name: "Add All Metrics", exact: true }).waitFor();
  await metrics.getByText(/No metrics recorded for this day/).waitFor();
  assert.equal(
    (await provider()).events.length,
    before.events.length,
    "Opening metrics must never create a workout event."
  );
  await metrics.getByRole("button", { name: "Close metrics editor", exact: true }).click();
  checks.push({ name: "metrics-empty-selected-day-no-workout-write", date });

  await choose("Metrics", new Date());
  await metrics.waitFor();
  await page.getByLabel("Graph 1", { exact: true }).selectOption("Sleep Hours");
  await button("Save layout").click();
  await button("Save layout").waitFor({ state: "hidden" });
  const savedConfig = await (await page.request.get(`${origin}/api/config`)).json();
  assert.equal(savedConfig.metricsLayout.graphs[0], "Sleep Hours");
  await metrics.getByRole("button", { name: "Close metrics editor", exact: true }).click();
  await choose("Metrics", new Date());
  await page.waitForFunction(
    () => document.querySelector('[aria-label="Graph 1"]')?.value === "Sleep Hours"
  );
  await page.screenshot({ path: path.join(output, "daily-metrics.png"), animations: "disabled" });
  await metrics.getByRole("button", { name: "Close metrics editor", exact: true }).click();
  checks.push({ name: "existing-metrics-layout-save-and-reopen" });

  await choose("Event");
  const eventDialog = page.getByRole("dialog", { name: "Add Event", exact: true });
  await eventDialog.waitFor();
  assert.equal(
    await button("Save").isDisabled(),
    true,
    "An empty event name cannot be submitted."
  );
  assert.equal(await eventDialog.getByLabel("Event date", { exact: true }).inputValue(),date);
  await page.getByLabel("Event name", { exact: true }).fill(title);
  assert.equal(await button("Save").isDisabled(),true,"Event type is required.");
  await eventDialog.getByLabel("Event type",{exact:true}).selectOption("RunningRoad");
  await eventDialog.getByLabel("Event priority",{exact:true}).selectOption("A");
  let entered, release;
  const enteredRequest = new Promise((resolve) => {
    entered = resolve;
  });
  const releaseRequest = new Promise((resolve) => {
    release = resolve;
  });
  let rejectOnce = true;
  await page.route(
    (url) => endpoint(url, "race-events"),
    async (route) => {
      if (rejectOnce && route.request().method() === "POST") {
        rejectOnce = false;
        entered();
        await releaseRequest;
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ error: "Synthetic event rejection; no provider mutation." }),
        });
      } else await route.continue();
    }
  );
  await button("Save").click();
  await enteredRequest;
  assert.equal(await page.getByLabel("Event name", { exact: true }).isDisabled(), true);
  assert.equal(
    await eventDialog.getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    true
  );
  await page.keyboard.press("Escape");
  assert.equal(await eventDialog.isVisible(), true, "A pending save must not close on Escape.");
  release();
  await eventDialog.getByRole("alert").waitFor();
  assert.equal(await page.getByLabel("Event name", { exact: true }).inputValue(), title);
  assert.equal(
    (await provider()).events.some((event) => event.name === title),
    false
  );
  checks.push({
    name: "event-required-name-pending-close-guard-and-rejected-save-retains-draft",
    date,
  });
  await page.getByLabel("Event name", { exact: true }).fill(title + " verified");
  await eventDialog.getByRole("alert").waitFor({ state: "hidden" });
  await page.screenshot({ path: path.join(output, "event-editor.png"), animations: "disabled" });
  await button("Save").click();
  await eventDialog.waitFor({ state: "hidden" });
  const savedSummary = page.getByRole("dialog",{name:title+" verified",exact:true});
  await savedSummary.getByRole("button",{name:"Edit Event",exact:true}).waitFor();
  await savedSummary.getByRole("button",{name:"Close",exact:true}).click();
  const saved = (await provider()).events.find((event) => event.name === title + " verified");
  assert.ok(saved);
  assert.equal(saved.category, "RACE_A");
  assert.equal(saved.start_date_local.slice(0, 10), date);
  await page.getByText(saved.name, { exact: true }).waitFor();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByText(saved.name, { exact: true }).waitFor();
  checks.push({
    name: "event-provider-creation-calendar-update-and-reload",
    date,
    category: saved.category,
    providerId: saved.id,
  });

  await choose("Note");
  const note = page.getByRole("dialog", { name: "Add Note", exact: true });
  await note.waitFor();
  assert.equal(await note.getByLabel("Date", { exact: true }).inputValue(), date);
  await note.getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push({ name: "note-entry-remains-independent-and-inherits-selected-day", date });
  assert.deepEqual(errors, []);
} catch (error) {
  errors.push(error.stack || error.message);
  process.exitCode = 1;
  await page
    .screenshot({ path: path.join(output, "failure.png"), animations: "disabled" })
    .catch(() => {});
  console.error(error.message);
} finally {
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ synthetic: true, referenceParityClaim: false, checks, errors }, null, 2)
  );
  console.log(JSON.stringify({ checks: checks.length, errors: errors.length, output }));
  await browser.close();
}
