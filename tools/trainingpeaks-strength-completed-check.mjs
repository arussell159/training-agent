// Synthetic localhost only. Read-only checks plus two explicit Description
// Save/restore PUTs; every other provider write fails the acceptance gate.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    )
  );
}
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5213";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = path.resolve("artifacts/trainingpeaks-strength-completed");
await fs.mkdir(output, { recursive: true });
const hash = async (file) =>
  createHash("sha256")
    .update(await fs.readFile(file))
    .digest("hex");
const checkpoint = {
  at: new Date().toISOString(),
  files: await Promise.all(
    [
      new URL(import.meta.url),
      new URL("../ui/dist/index.html", import.meta.url),
      new URL("./desktop-calendar-preview-fixtures.mjs", import.meta.url),
      new URL("../app-backend/lib/activity-bundle.mjs", import.meta.url),
      new URL("../ui/src/components/desktop-strength-completed.tsx", import.meta.url),
    ].map(async (file) => ({ file: file.href, sha256: await hash(file) }))
  ),
};
const browser = await pw.chromium.launch({ channel: "msedge", headless: true });
const checks = [],
  errors = [],
  readbacks = [],
  network = [],
  requests = [],
  lifecycle = [],
  contexts = [],
  expectedHttp = [],
  expectedCanceled = [],
  authTeardowns = [],
  allowedNativeWrites = [],
  routeTasks = [];
let page,
  phase = "source-oracles",
  baseline,
  paired,
  providerOnly,
  pairedNative,
  providerNative,
  sourceContext;
const endpoint = (input) => {
  const url = new URL(input);
  return url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
};
const summaryFor = (input, id) => endpoint(input) === `activities/${id}/summary`;
const modal = () => page.getByRole("dialog", { name: "Completed Strength Workout", exact: true });
const table = () =>
  modal().getByRole("table", { name: "Planned and completed Strength values", exact: true });
async function json(route) {
  const response = await page.request.get(`${origin}/api/${route}`);
  assert.ok(response.ok(), `${route}: ${response.status()}`);
  const body = await response.json();
  readbacks.push({ phase, route, body });
  return body;
}
function recordExpected(response) {
  expectedHttp.push({
    url: response.url(),
    method: response.request().method(),
    status: response.status(),
  });
}
async function rows() {
  return table()
    .getByRole("row")
    .evaluateAll((nodes) =>
      Object.fromEntries(
        nodes.slice(1).map((row) => {
          const cells = [...row.querySelectorAll("th,td")].map((cell) => cell.textContent.trim());
          return [cells[0], cells.slice(1)];
        })
      )
    );
}
async function expectRows(expected) {
  await page.waitForFunction(
    ({ selector, expected }) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const rows = Object.fromEntries(
        [...node.querySelectorAll("tbody tr")].map((row) => {
          const cells = [...row.querySelectorAll("th,td")].map((cell) => cell.textContent.trim());
          return [cells[0], cells.slice(1)];
        })
      );
      return Object.entries(expected).every(
        ([key, value]) => JSON.stringify(rows[key]) === JSON.stringify(value)
      );
    },
    { selector: ".dsc-summary table", expected }
  );
  for (const [key, value] of Object.entries(expected))
    assert.deepEqual((await rows())[key], value, key);
}
const pairedExpected = {
  Exercises: ["1", "--"],
  Sets: ["3", "--"],
  Reps: ["24", "--"],
  Volume: ["1,200 lb", "--"],
  Duration: ["00:20:00", "00:25:00"],
  TSS: ["20", "31"],
  IF: ["0.55", "0.72"],
};
const providerExpected = {
  Exercises: ["--", "--"],
  Sets: ["--", "--"],
  Reps: ["--", "--"],
  Volume: ["--", "--"],
  Duration: ["--", "00:15:00"],
  TSS: ["--", "0"],
  IF: ["--", "0.00"],
};
async function fresh({
  viewport = { width: 1280, height: 820 },
  override,
  historyPair = false,
} = {}) {
  const context = await browser.newContext({ viewport, colorScheme: "light", locale: "en-US" });
  contexts.push(context);
  const contextId = contexts.length;
  if (historyPair)
    await context.addInitScript(() => {
      if (window !== window.top || !new URL(location.href).searchParams.has("workout")) return;
      const target = location.href,
        base = new URL(target);
      base.searchParams.delete("workout");
      const before = history.length;
      history.replaceState({ syntheticHistoryEntry: "base" }, "", base.href);
      history.pushState({ syntheticHistoryEntry: "workout" }, "", target);
      window.__completedHistorySetup = {
        target,
        base: base.href,
        beforeLength: before,
        entryCount: history.length,
      };
    });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") network.push({ kind: "console", phase, text: message.text() });
  });
  page.on("request", (request) =>
    requests.push({ phase, at: Date.now(), method: request.method(), url: request.url() })
  );
  for (const event of ["request", "requestfinished", "requestfailed"])
    page.on(event, (request) => {
      if (!request.url().includes("/api/")) return;
      lifecycle.push({
        contextId,
        requestStart: request.timing().startTime,
        event,
        phase,
        at: Date.now(),
        url: request.url(),
        method: request.method(),
        failure: request.failure(),
      });
    });
  page.on("response", (response) => {
    if (response.url().includes("/api/"))
      lifecycle.push({
        contextId,
        requestStart: response.request().timing().startTime,
        event: "response",
        phase,
        at: Date.now(),
        url: response.url(),
        status: response.status(),
      });
  });
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame())
      lifecycle.push({ event: "navigation", phase, at: Date.now(), url: frame.url() });
  });
  page.on("requestfailed", (request) =>
    network.push({
      kind: "failed",
      phase,
      at: Date.now(),
      url: request.url(),
      method: request.method(),
      reason: request.failure()?.errorText,
    })
  );
  page.on("response", (response) => {
    if (response.status() >= 400)
      network.push({
        kind: "http",
        phase,
        url: response.url(),
        method: response.request().method(),
        status: response.status(),
      });
    if (/activities\/[^/]+\/summary$/.test(endpoint(response.url())))
      routeTasks.push(
        response
          .json()
          .then((body) =>
            readbacks.push({ phase, route: response.url(), status: response.status(), body })
          )
          .catch((error) => readbacks.push({ phase, route: response.url(), error: error.message }))
      );
  });
  if (override) await override(page, context);
  return context;
}
async function open(workout, { direct = false, entryPath = "/calendar" } = {}) {
  await page.goto(
    `${origin}${entryPath}?theme=light${direct ? `&workout=${encodeURIComponent(workout.id)}` : ""}`,
    { waitUntil: "domcontentloaded" }
  );
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  if (!direct) {
    await page.locator(".calendar-desktop-toolbar").waitFor();
    await page.locator("[data-workout-id]").filter({ hasText: workout.title }).first().click();
  }
  await modal().waitFor();
}
async function close() {
  await modal()
    .getByRole("button", { name: "Close completed Strength workout", exact: true })
    .click();
  await modal().waitFor({ state: "hidden" });
}
const descriptionInput = () =>
  page.getByRole("textbox", { name: "Workout description", exact: true });
const commentInput = () =>
  page.getByRole("textbox", { name: "New post-activity comment", exact: true });
const privateNotesInput = () => page.getByRole("textbox", { name: "Private Notes", exact: true });
const discardDialog = () =>
  page.getByRole("alertdialog", { name: "Discard unsaved changes?", exact: true });
async function details() {
  await modal().getByRole("button", { name: "Notes and Details", exact: true }).click();
  await descriptionInput().waitFor();
  await privateNotesInput().waitFor();
  await page.waitForFunction(
    () => !document.querySelector('textarea[aria-label="Private Notes"]')?.disabled
  );
}
async function confirmDiscard() {
  await discardDialog().getByRole("button", { name: "Discard changes", exact: true }).click();
  await modal().waitFor();
}
async function realDescriptionSave(text) {
  await descriptionInput().fill(text);
  const waiting = page.waitForResponse(
    (response) =>
      endpoint(response.url()) === "calendar/workout-description" &&
      response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  const response = await waiting;
  assert.equal(response.status(), 200, await response.text());
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("button")].find(
        (button) => button.textContent.trim() === "Save"
      )?.disabled === true
  );
  const record = await json("preview/provider-records"),
    delta = record.writes.slice(baseline.writes.length);
  assert.equal(delta.length, allowedNativeWrites.length + 1);
  const write = delta.at(-1);
  assert.equal(write.method, "PUT");
  assert.equal(write.path, `/athlete/0/events/${pairedNative.paired_event_id}`);
  assert.doesNotMatch(
    write.body.description,
    /Workout editor v1|\{"version"|Intervals\.icu device definition:/i
  );
  allowedNativeWrites.push(write);
  return record;
}
function semanticRecords(record) {
  const copy = structuredClone(record);
  delete copy.writes;
  for (const field of ["events", "activities"]) for (const row of copy[field]) delete row.updated;
  return copy;
}
async function dirtyDirect({ historyPair = false } = {}) {
  await fresh({ historyPair });
  await open(paired, { direct: true, entryPath: "/" });
  await settled();
  await details();
  const original = {
      description: await descriptionInput().inputValue(),
      comment: await commentInput().inputValue(),
      privateNotes: await privateNotesInput().inputValue(),
    },
    values = {
      description: `Unsaved description ${phase}`,
      comment: `Unsaved comment ${phase}`,
      privateNotes: `Private unsaved thought ${phase}`,
    };
  await descriptionInput().fill(values.description);
  await commentInput().fill(values.comment);
  await privateNotesInput().fill(values.privateNotes);
  return {
    original,
    values,
    url: page.url(),
    historyLength: await page.evaluate(() => history.length),
  };
}
async function expectDraft(draft, values = draft.values) {
  assert.equal(await descriptionInput().inputValue(), values.description);
  assert.equal(await commentInput().inputValue(), values.comment);
  assert.equal(await privateNotesInput().inputValue(), values.privateNotes);
}
async function noAdditionalWrites() {
  assert.deepEqual((await json("preview/provider-records")).writes, [
    ...baseline.writes,
    ...allowedNativeWrites,
  ]);
}
const oldRecordRequest = (input) => {
  let api = endpoint(input);
  for (let pass = 0; pass < 2; pass++) {
    try {
      api = decodeURIComponent(api);
    } catch {
      break;
    }
  }
  const url = new URL(input);
  return (
    api.includes(paired.id) ||
    api.includes(pairedNative.id) ||
    url.searchParams.get("workoutId") === paired.id
  );
};
async function assertOldRecordHidden() {
  for (const text of [paired.title, "Fixture Air Squat"])
    for (const node of await page.getByText(text, { exact: true }).all())
      assert.equal(
        await node.isVisible(),
        false,
        `Old record leaked after account/cache revoke: ${text}`
      );
  assert.equal(await descriptionInput().count(), 0);
  assert.equal(await modal().count(), 0);
  assert.equal(
    await page
      .getByRole("table", { name: "Prescribed sets: Fixture Air Squat", exact: true })
      .count(),
    0
  );
}
async function scopeStorageChange(context, suffix, entryPoint = "workout") {
  await page.evaluate(() => {
    window.__completedScopeEvents = [];
    window.addEventListener("storage", (event) => {
      if (event.key === "training-agent-startup-v2")
        window.__completedScopeEvents.push({
          at: Date.now(),
          key: event.key,
          oldValue: event.oldValue,
          newValue: event.newValue,
        });
    });
  });
  const sibling = await context.newPage();
  await sibling.goto(`${origin}/privacy.html`, { waitUntil: "domcontentloaded" });
  await sibling.evaluate((suffix) => {
    const key = "training-agent-startup-v2",
      current = JSON.parse(localStorage.getItem(key) || "{}");
    localStorage.setItem(
      key,
      JSON.stringify({ ...current, cache_scope: `synthetic-completed-scope-${suffix}` })
    );
  }, suffix);
  if (entryPoint === "calendar") {
    await page.getByRole("heading", { name: "Reopen calendar", exact: true }).waitFor();
    await page.getByRole("button", { name: "Reload calendar", exact: true }).waitFor();
    await page
      .getByText(
        "The connected account changed. Reload the calendar to view the current account.",
        { exact: true }
      )
      .waitFor();
  } else {
    await page.getByRole("dialog", { name: "Reopen workout", exact: true }).waitFor();
    await page.getByRole("button", { name: "Close workout", exact: true }).waitFor();
  }
  const actualBrowserStorageEvents = await page.evaluate(() => window.__completedScopeEvents);
  assert.equal(actualBrowserStorageEvents.length, 1);
  readbacks.push({
    phase,
    actualBrowserStorageEvents,
  });
  await assertOldRecordHidden();
  await sibling.close();
  return actualBrowserStorageEvents[0].at;
}
async function readonly() {
  assert.equal(await modal().getByRole("textbox").count(), 0);
  assert.equal(await modal().getByRole("spinbutton").count(), 0);
  for (const label of ["Save", "Save and Close", "Build Workout", "Delete Workout"])
    assert.equal(await modal().getByRole("button", { name: label, exact: true }).count(), 0);
}
async function settled() {
  await modal()
    .getByRole("status")
    .filter({ hasText: "Refreshing completed values" })
    .waitFor({ state: "hidden" });
}
function alterWorkout(body, change) {
  if (!body || typeof body !== "object") return body;
  const transform = (row) => (row?.id === paired.id ? change(structuredClone(row)) : row);
  if (body.workout) body.workout = transform(body.workout);
  const context = body.context || body;
  for (const field of ["history", "planned"])
    if (Array.isArray(context[field])) context[field] = context[field].map(transform);
  return body;
}
async function dtoOverride(page, { workoutChange, summaryChange } = {}) {
  await page.route("**/api/**", async (route) => {
    const api = endpoint(route.request().url());
    if (route.request().method() !== "GET") return route.fallback();
    const changeSummary = summaryChange && summaryFor(route.request().url(), pairedNative.id),
      changeWorkout =
        workoutChange &&
        (/^(training-context|training-updates)$/.test(api) ||
          api === `workout-history/${encodeURIComponent(paired.id)}` ||
          api === `workout-history/${paired.id}`);
    if (!changeSummary && !changeWorkout) return route.fallback();
    const response = await route.fetch();
    assert.ok(response.ok());
    const original = await response.json(),
      body = structuredClone(original);
    const result = changeSummary ? summaryChange(body) : alterWorkout(body, workoutChange);
    readbacks.push({
      phase,
      declaredDtoInput: true,
      url: route.request().url(),
      original,
      body: result,
    });
    await route.fulfill({ response, json: result });
  });
}
async function layout(width) {
  await page.setViewportSize({ width, height: 820 });
  await modal().waitFor();
  // Shared popup duration100 applies to viewport-resize width changes. Wait
  // for natural layout settlement rather than sampling a transitional width.
  const frames = await modal().evaluate(async (node) => {
    const frames = [];
    let previous = "",
      stable = 0;
    for (let count = 0; count < 120; count++) {
      await new Promise(requestAnimationFrame);
      const box = node.getBoundingClientRect(),
        signature = JSON.stringify([box.x, box.y, box.width, box.height]);
      frames.push({ x: box.x, y: box.y, width: box.width, height: box.height });
      stable = signature === previous ? stable + 1 : 0;
      previous = signature;
      if (stable >= 6) return frames;
    }
    throw Error("Completed Strength viewport layout did not settle");
  });
  readbacks.push({ phase, viewportWidth: width, nativeResizeFrames: frames });
  const measured = await modal().evaluate((node) => {
    const box = node.getBoundingClientRect(),
      style = getComputedStyle(node);
    return {
      viewport: innerWidth,
      bodyScroll: document.documentElement.scrollWidth,
      box: {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        right: box.right,
        bottom: box.bottom,
      },
      overflow: node.scrollWidth - node.clientWidth,
      radius: style.borderRadius,
      shadow: style.boxShadow,
      header: [...node.querySelectorAll(".dsc-header button")].map((button) => {
        const r = button.getBoundingClientRect();
        return {
          label: button.textContent.trim() || button.getAttribute("aria-label"),
          left: r.left,
          right: r.right,
          top: r.top,
          bottom: r.bottom,
        };
      }),
    };
  });
  readbacks.push({ phase, layout: measured });
  const expectedInset = width <= 900 ? 16 : 32;
  assert.ok(Math.abs(measured.box.x - expectedInset) <= 0.5, JSON.stringify(measured));
  assert.ok(
    Math.abs(measured.box.width - (width - 2 * expectedInset)) <= 0.5,
    JSON.stringify(measured)
  );
  assert.ok(measured.box.x >= 0 && measured.box.right <= width, JSON.stringify(measured));
  assert.ok(measured.bodyScroll <= width + 1, "Page must not overflow horizontally");
  assert.ok(measured.overflow <= 1, "Completed dialog must not overflow horizontally");
  for (const control of measured.header)
    assert.ok(
      control.left >= measured.box.x && control.right <= measured.box.right,
      JSON.stringify(control)
    );
  await page.screenshot({
    path: path.join(output, `completed-${width}.png`),
    animations: "disabled",
  });
}
try {
  await fresh();
  baseline = await json("preview/provider-records");
  sourceContext = await json("training-context");
  pairedNative = baseline.activities.find(
    (row) => row.name === "Completed Strength — paired prescription"
  );
  providerNative = baseline.activities.find(
    (row) => row.name === "Completed Strength — provider only"
  );
  assert.ok(pairedNative && providerNative, "Completed Strength seeds are required");
  const all = [...sourceContext.history, ...sourceContext.planned];
  paired = all.find((row) => row.id === `event:${pairedNative.paired_event_id}`);
  providerOnly = all.find((row) => row.id === `activity:${providerNative.id}`);
  assert.ok(paired && providerOnly);
  for (const [raw, seconds, tss, ifPercent] of [
    [pairedNative, 1500, 31, 72],
    [providerNative, 900, 0, 0],
  ]) {
    assert.equal(raw.type, "WeightTraining");
    assert.equal(raw.moving_time, seconds);
    assert.equal(raw.icu_training_load, tss);
    assert.equal(raw.icu_intensity, ifPercent);
    for (const field of ["distance", "average_cadence", "sets", "exercises"])
      assert.equal(Object.hasOwn(raw, field), false);
    const response = await json(`activities/${raw.id}/summary`);
    assert.equal(response.duration_seconds, seconds);
    assert.equal(response.tss, tss);
    assert.equal(response.intensity_factor, ifPercent / 100);
  }
  const privateExercise = paired.editor_model.strength.blocks[0].exercises[0];
  assert.equal(privateExercise.sets.length, 3);
  for (const parameter of privateExercise.parameters)
    for (const set of privateExercise.sets)
      assert.equal(set.values[parameter.id], parameter.kind === "reps" ? 8 : 50);
  assert.equal(paired.workout_summary.planned.duration_seconds, 1200);
  assert.equal(paired.workout_summary.planned.tss, 20);
  assert.equal(paired.workout_summary.planned.intensity_factor, 0.55);
  for (const raw of baseline.events
    .concat(baseline.activities)
    .filter((row) => row.type === "WeightTraining"))
    assert.doesNotMatch(
      raw.description,
      /Workout editor v1|\{"version"|Intervals\.icu device definition:/i
    );
  checks.push(
    "raw-native-and-production-activity-bundle-summary-oracles-distinguish-plan-from-recording-with-zero-native-writes"
  );

  phase = "calendar-paired";
  await open(paired);
  await settled();
  await expectRows(pairedExpected);
  await readonly();
  await modal().getByText("Completed exercise results are unavailable.", { exact: true }).waitFor();
  const prescription = modal().getByRole("table", {
    name: "Prescribed sets: Fixture Air Squat",
    exact: true,
  });
  assert.equal(await prescription.getByRole("row").count(), 4);
  assert.deepEqual(await prescription.getByRole("row").nth(1).getByRole("cell").allTextContents(), [
    "8",
    "50",
  ]);
  checks.push(
    "calendar-opens-readonly-paired-summary-with-planned-prescription-and-unknown-actual-set-results"
  );
  phase = "keyboard-no-write";
  await modal().press("Control+s");
  await modal().press("Meta+s");
  await expectRows(pairedExpected);
  await modal().press("Escape");
  await modal().waitFor({ state: "hidden" });
  assert.deepEqual((await json("preview/provider-records")).writes, baseline.writes);
  checks.push("close-escape-and-save-shortcuts-never-save-or-delete-a-completed-recording");

  phase = "provider-direct";
  await fresh();
  await open(providerOnly, { direct: true });
  await settled();
  await expectRows(providerExpected);
  await readonly();
  await modal()
    .getByText("No saved exercise prescription is available for this recording.", { exact: true })
    .waitFor();
  checks.push(
    "provider-only-direct-open-shows-recorded-zero-tss-and-if-without-phantom-planned-sets-or-duration"
  );
  await close();

  phase = "direct-paired";
  await fresh();
  await open(paired, { direct: true });
  await settled();
  await expectRows(pairedExpected);
  await readonly();
  checks.push(
    "direct-paired-link-renders-completed-summary-instead-of-editable-prescription-builder"
  );
  phase = "analysis-details-roundtrip";
  await modal().getByRole("button", { name: "Analyze Recording", exact: true }).click();
  await modal().waitFor({ state: "hidden" });
  await page
    .getByText("No recorded signal stream is available for this activity.", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await modal().waitFor();
  await details();
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await modal().waitFor();
  await expectRows(pairedExpected);
  checks.push(
    "real-recording-analysis-and-notes-details-remain-reachable-with-summary-return-without-mutations"
  );
  phase = "responsive";
  for (const width of [1280, 1024, 768]) await layout(width);
  await page.setViewportSize({ width: 1280, height: 820 });
  checks.push(
    "completed-summary-header-and-dialog-have-no-viewport-overflow-at1280-1024-768-with-actual-screenshots"
  );

  phase = "dirty-details-exits";
  await fresh();
  await open(paired);
  await settled();
  await details();
  const originalDescription = await descriptionInput().inputValue(),
    originalPrivate = await privateNotesInput().inputValue();
  const dirtyDescription = "Synthetic completed Strength description draft",
    dirtyComment = "Synthetic unsaved post-activity comment",
    dirtyPrivate = "Synthetic unsaved private thoughts";
  await descriptionInput().fill(dirtyDescription);
  await commentInput().fill(dirtyComment);
  await privateNotesInput().fill(dirtyPrivate);
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await discardDialog().waitFor();
  await discardDialog().getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await descriptionInput().inputValue(), dirtyDescription);
  assert.equal(await commentInput().inputValue(), dirtyComment);
  assert.equal(await privateNotesInput().inputValue(), dirtyPrivate);
  await page.getByRole("button", { name: "Close workout details", exact: true }).click();
  await discardDialog().waitFor();
  await discardDialog().getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await descriptionInput().inputValue(), dirtyDescription);
  assert.equal(await commentInput().inputValue(), dirtyComment);
  assert.equal(await privateNotesInput().inputValue(), dirtyPrivate);
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await discardDialog().waitFor();
  await confirmDiscard();
  await details();
  assert.equal(await descriptionInput().inputValue(), originalDescription);
  assert.equal(await commentInput().inputValue(), "");
  assert.equal(await privateNotesInput().inputValue(), originalPrivate);
  assert.deepEqual(await json("preview/provider-records"), baseline);
  assert.equal(
    requests.filter(
      (row) =>
        row.method !== "GET" &&
        /^(comments|workouts\/[^/]+\/personal|calendar\/workout-description)$/.test(
          endpoint(row.url)
        )
    ).length,
    0
  );
  checks.push(
    "dirty-description-comment-private-notes-survive-summary-and-close-cancel-while-explicit-discard-clears-recovery-with-zero-writes"
  );

  phase = "failed-detail-save";
  await descriptionInput().fill(dirtyDescription);
  await commentInput().fill(dirtyComment);
  let releaseFailure, startFailure;
  const failureStarted = new Promise((resolve) => (startFailure = resolve)),
    failureRelease = new Promise((resolve) => (releaseFailure = resolve));
  const rejectDescription = async (route) => {
    if (
      endpoint(route.request().url()) !== "calendar/workout-description" ||
      route.request().method() !== "POST"
    )
      return route.fallback();
    startFailure();
    await failureRelease;
    await route.fulfill({
      status: 503,
      json: { error: "Declared completed description save unavailable; draft retained." },
    });
  };
  await page.route("**/api/**", rejectDescription);
  const failedWrite = page.waitForResponse(
    (response) =>
      endpoint(response.url()) === "calendar/workout-description" && response.status() === 503
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await failureStarted;
  assert.equal(await page.getByRole("button", { name: "Summary", exact: true }).isDisabled(), true);
  assert.equal(await discardDialog().count(), 0);
  assert.equal(await descriptionInput().inputValue(), dirtyDescription);
  releaseFailure();
  recordExpected(await failedWrite);
  await page
    .locator(".desktop-workout-dialog-footer")
    .getByRole("alert")
    .filter({ hasText: "Declared completed description save unavailable" })
    .waitFor();
  await page.unroute("**/api/**", rejectDescription);
  assert.equal(await descriptionInput().inputValue(), dirtyDescription);
  assert.equal(await commentInput().inputValue(), dirtyComment);
  assert.deepEqual(await json("preview/provider-records"), baseline);
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await discardDialog().waitFor();
  await confirmDiscard();
  await details();
  assert.equal(await descriptionInput().inputValue(), originalDescription);
  assert.equal(await commentInput().inputValue(), "");
  checks.push(
    "held-and503-description-save-keeps-details-draft-busy-guarded-until-explicit-discard-clears-retained-recovery"
  );

  phase = "real-direct-details-save-restore";
  await fresh();
  await open(paired, { direct: true });
  await settled();
  await details();
  const committedDescription = "Synthetic verified completed Strength description.";
  await realDescriptionSave(committedDescription);
  await page.getByRole("button", { name: "Summary", exact: true }).click();
  await modal().waitFor();
  await expectRows(pairedExpected);
  await fresh();
  await open(paired, { direct: true });
  await settled();
  await details();
  assert.equal(await descriptionInput().inputValue(), committedDescription);
  const savedContext = await json("training-context"),
    savedWorkout = [...savedContext.history, ...savedContext.planned].find(
      (row) => row.id === paired.id
    );
  assert.deepEqual(savedWorkout.editor_model.strength, paired.editor_model.strength);
  await realDescriptionSave(originalDescription);
  const restoredRecords = await json("preview/provider-records");
  assert.deepEqual(semanticRecords(restoredRecords), semanticRecords(baseline));
  assert.deepEqual(restoredRecords.writes, [...baseline.writes, ...allowedNativeWrites]);
  assert.equal(
    requests.filter((row) => row.method === "POST" && endpoint(row.url) === "comments").length,
    0,
    "Unsaved comments must never be posted during discard or description Save"
  );
  checks.push(
    "direct-details-has-real-save-fresh-readback-and-ui-restore-with-exact-two-owned-native-puts-private-prescription-preserved-and-no-comment-post"
  );

  for (const action of ["app-back", "sidebar-calendar"]) {
    phase = `dirty-${action}`;
    const draft = await dirtyDirect();
    const trigger = () =>
      action === "app-back"
        ? page.getByRole("button", { name: "Back to home", exact: true })
        : page
            .getByRole("navigation", { name: "Primary navigation", exact: true })
            .getByRole("button", { name: "Calendar", exact: true });
    await trigger().click();
    await discardDialog().waitFor();
    await discardDialog().getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(page.url(), draft.url);
    await expectDraft(draft);
    assert.equal(await page.evaluate(() => history.length), draft.historyLength);
    await noAdditionalWrites();
    await trigger().click();
    await discardDialog().waitFor();
    await discardDialog().getByRole("button", { name: "Discard changes", exact: true }).click();
    if (action === "app-back") {
      const base = new URL(draft.url);
      base.searchParams.delete("workout");
      await page.waitForURL(base.href);
    } else {
      await page.waitForURL(
        (url) => url.pathname === "/calendar" && !url.searchParams.has("workout")
      );
      await page.locator(".calendar-desktop-toolbar").waitFor();
    }
    assert.equal(await descriptionInput().count(), 0);
    await noAdditionalWrites();
    await open(paired, { direct: true, entryPath: "/" });
    await settled();
    await details();
    await expectDraft(draft, draft.original);
    await noAdditionalWrites();
    checks.push(
      `direct-dirty-details-${action}-cancel-retains-all-fields-url-history-and-confirmed-discard-exits-clears-recovery-with-zero-writes`
    );
  }

  phase = "dirty-browser-history";
  const historyDraft = await dirtyDirect({ historyPair: true }),
    historySetup = await page.evaluate(() => window.__completedHistorySetup);
  assert.ok(historySetup);
  assert.equal(historySetup.entryCount, historySetup.beforeLength + 1);
  assert.equal(historyDraft.url, historySetup.target);
  assert.equal(historyDraft.historyLength, historySetup.entryCount);
  readbacks.push({ phase, declaredPreMountSameDocumentHistory: historySetup });
  await page.goBack({ waitUntil: "commit" });
  await discardDialog().waitFor();
  await discardDialog().getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForURL(historyDraft.url);
  await expectDraft(historyDraft);
  assert.equal(await page.evaluate(() => history.length), historySetup.entryCount);
  const canceledForward = await page.goForward({ waitUntil: "commit" });
  assert.equal(canceledForward, null);
  assert.equal(page.url(), historyDraft.url);
  await expectDraft(historyDraft);
  assert.equal(await page.evaluate(() => history.length), historySetup.entryCount);
  await noAdditionalWrites();
  await page.goBack({ waitUntil: "commit" });
  await discardDialog().waitFor();
  await discardDialog().getByRole("button", { name: "Discard changes", exact: true }).click();
  await page.waitForURL(historySetup.base);
  assert.equal(await descriptionInput().count(), 0);
  await noAdditionalWrites();
  await page.goForward({ waitUntil: "commit" });
  await page.waitForURL(historySetup.target);
  await modal().waitFor();
  await settled();
  await expectRows(pairedExpected);
  await details();
  await expectDraft(historyDraft, historyDraft.original);
  assert.equal(await page.evaluate(() => history.length), historySetup.entryCount);
  await noAdditionalWrites();
  checks.push(
    "actual-browser-back-cancel-retains-exact-url-draft-and-history-forward-stack-while-confirmed-back-and-forward-restore-clean-summary"
  );

  phase = "details-account-cache-revoke";
  const revokedDraft = await dirtyDirect();
  const revokeAt = await scopeStorageChange(page.context(), "details");
  await page.waitForFunction(
    () => !document.querySelector('textarea[aria-label="Workout description"]')
  );
  for (const value of Object.values(revokedDraft.values))
    assert.equal((await page.locator("body").innerText()).includes(value), false);
  assert.deepEqual(
    requests.filter((row) => row.at >= revokeAt && oldRecordRequest(row.url)),
    [],
    "Revoking an account/cache scope must not dispatch old-ID lookups or mutations"
  );
  await noAdditionalWrites();
  checks.push(
    "same-id-dirty-details-cache-scope-revoke-unmounts-whole-old-record-and-dispatches-no-old-id-read-or-write"
  );

  phase = "analyze-session-revoke";
  await fresh();
  await open(paired, { direct: true, entryPath: "/" });
  await settled();
  await modal().getByRole("button", { name: "Analyze Recording", exact: true }).click();
  await page
    .getByText("No recorded signal stream is available for this activity.", { exact: true })
    .waitFor();
  const expire = async (route) =>
    endpoint(route.request().url()) === "sync" && route.request().method() === "POST"
      ? route.fulfill({ status: 401, json: { error: "Declared expired authenticated session" } })
      : route.fallback();
  await page.route("**/api/**", expire);
  const expired = page.waitForResponse(
      (response) => endpoint(response.url()) === "sync" && response.status() === 401
    ),
    expiredStart = requests.length;
  await page.getByRole("button", { name: "Site menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Refresh Intervals.icu", exact: true }).click();
  const expiredResponse = await expired;
  recordExpected(expiredResponse);
  lifecycle.push({ event: "declared401Observed", phase, at: Date.now() });
  await page.getByRole("button", { name: "Sign in", exact: true }).waitFor();
  lifecycle.push({ event: "actualSignInVisible", phase, at: Date.now() });
  authTeardowns.push({
    url: expiredResponse.url(),
    contextId: contexts.length,
    signedOutAt: Date.now(),
  });
  await assertOldRecordHidden();
  assert.equal(
    await page
      .getByText("No recorded signal stream is available for this activity.", { exact: true })
      .count(),
    0
  );
  assert.deepEqual(
    requests.slice(expiredStart).filter((row) => oldRecordRequest(row.url)),
    [],
    "Expired session must not fetch or write any ID retained from the old recording"
  );
  await noAdditionalWrites();
  checks.push(
    "same-id-analyze-actual401-session-revoke-clears-whole-old-record-and-permits-no-old-id-request-or-write"
  );

  phase = "modern-null";
  await fresh({
    override: (p) =>
      dtoOverride(p, {
        workoutChange: (row) => ({
          ...row,
          actualDurationMinutes: 999,
          completed_data: { duration_minutes: 999, tss: 999 },
          workout_summary: {
            planned: { duration_seconds: null, tss: null, intensity_factor: null },
            completed: { duration_seconds: null, tss: null, intensity_factor: null },
          },
        }),
        summaryChange: (body) => ({
          ...body,
          duration_seconds: null,
          tss: null,
          intensity_factor: null,
        }),
      }),
  });
  await open(paired, { direct: true });
  await settled();
  await expectRows({
    ...pairedExpected,
    Duration: ["--", "--"],
    TSS: ["--", "--"],
    IF: ["--", "--"],
  });
  checks.push("declared-modern-null-dtos-do-not-fall-back-to-stale-legacy-or-planned-values");
  phase = "modern-zero";
  await fresh({
    override: (p) =>
      dtoOverride(p, {
        workoutChange: (row) => ({
          ...row,
          workout_summary: {
            planned: { duration_seconds: 0, tss: 0, intensity_factor: 0 },
            completed: { duration_seconds: 0, tss: 0, intensity_factor: 0 },
          },
        }),
        summaryChange: (body) => ({ ...body, duration_seconds: 0, tss: 0, intensity_factor: 0 }),
      }),
  });
  await open(paired, { direct: true });
  await settled();
  await expectRows({
    ...pairedExpected,
    Duration: ["00:00:00", "00:00:00"],
    TSS: ["0", "0"],
    IF: ["0.00", "0.00"],
  });
  checks.push("declared-modern-zero-dtos-retain-known-zeros-in-both-columns");

  phase = "invalid-prescription";
  await fresh({
    override: (p) =>
      dtoOverride(p, {
        workoutChange: (row) => ({
          ...row,
          editor_model: {
            ...row.editor_model,
            strength: { version: 1, blocks: [{ kind: "single", exercises: null }] },
          },
        }),
      }),
  });
  await open(paired, { direct: true });
  await settled();
  await modal()
    .getByRole("alert")
    .filter({ hasText: "The saved exercise prescription could not be read" })
    .waitFor();
  await expectRows({
    ...pairedExpected,
    Exercises: ["--", "--"],
    Sets: ["--", "--"],
    Reps: ["--", "--"],
    Volume: ["--", "--"],
  });
  assert.equal(
    await modal()
      .getByRole("table", { name: /Prescribed sets:/ })
      .count(),
    0
  );
  await readonly();
  checks.push(
    "invalid-private-prescription-dto-is-not-rendered-as-valid-or-editable-exercise-results"
  );

  phase = "failed-summary-retry";
  let reject = true;
  await fresh({
    override: async (p) => {
      await p.route("**/api/**", async (route) => {
        if (!summaryFor(route.request().url(), pairedNative.id) || !reject) return route.fallback();
        reject = false;
        await route.fulfill({ status: 503, json: { error: "Declared summary unavailable" } });
      });
    },
  });
  const failure = page.waitForResponse(
    (response) => summaryFor(response.url(), pairedNative.id) && response.status() === 503
  );
  await open(paired, { direct: true });
  recordExpected(await failure);
  await modal().getByRole("button", { name: "Retry completed values", exact: true }).waitFor();
  await expectRows(pairedExpected);
  await modal().getByRole("button", { name: "Retry completed values", exact: true }).click();
  await settled();
  await expectRows(pairedExpected);
  checks.push(
    "summary503-retains-context-values-and-real-retry-loads-recorded-summary-without-write"
  );

  phase = "malformed-summary200";
  let malformed = true;
  await fresh({
    override: async (p) =>
      p.route("**/api/**", async (route) => {
        if (!malformed || !summaryFor(route.request().url(), pairedNative.id))
          return route.fallback();
        malformed = false;
        const response = await route.fetch();
        const body = { ...(await response.json()), duration_seconds: "not-a-measurement" };
        readbacks.push({ phase, declaredMalformedSummary: body });
        await route.fulfill({ response, json: body });
      }),
  });
  await open(paired, { direct: true });
  await modal().getByRole("button", { name: "Retry completed values", exact: true }).waitFor();
  await expectRows(pairedExpected);
  await modal().getByRole("button", { name: "Retry completed values", exact: true }).click();
  await settled();
  await expectRows(pairedExpected);
  checks.push(
    "malformed-successful-summary-response-does-not-certify-recorded-values-and-real-retry-recovers"
  );

  phase = "late-old-id";
  let releaseOld, oldStarted;
  const began = new Promise((resolve) => (oldStarted = resolve)),
    release = new Promise((resolve) => (releaseOld = resolve));
  await fresh({
    override: async (p) => {
      await p.route("**/api/**", async (route) => {
        if (!summaryFor(route.request().url(), pairedNative.id)) return route.fallback();
        const response = await route.fetch();
        oldStarted();
        await release;
        try {
          await route.fulfill({
            response,
            json: {
              ...(await response.json()),
              duration_seconds: 9999,
              tss: 999,
              intensity_factor: 4,
            },
          });
        } catch (error) {
          readbacks.push({ phase, lateOldIdFulfillError: error.message });
        }
      });
    },
  });
  await open(paired);
  await began;
  lifecycle.push({ event: "beforeActualClose", phase, at: Date.now() });
  await close();
  lifecycle.push({ event: "afterActualClose", phase, at: Date.now() });
  await page.locator("[data-workout-id]").filter({ hasText: providerOnly.title }).first().click();
  await modal().waitFor();
  await settled();
  await expectRows(providerExpected);
  releaseOld();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await expectRows(providerExpected);
  for (const entry of network.filter(
    (row) =>
      row.kind === "failed" &&
      row.phase === "late-old-id" &&
      summaryFor(row.url, pairedNative.id) &&
      /ERR_ABORTED/.test(row.reason || "")
  ))
    expectedCanceled.push({
      ...entry,
      reasonProof:
        "Actual Close completed Strength workout followed by opening different recording; only intentionally held old summary may cancel.",
    });
  checks.push(
    "held-old-recording-response-cannot-replace-new-recording-summary-after-real-close-and-open"
  );

  phase = "late-old-cache-scope";
  let releaseScope, startScope;
  const scopeBegan = new Promise((resolve) => (startScope = resolve)),
    scopeRelease = new Promise((resolve) => (releaseScope = resolve));
  let firstScope = true;
  const scopeContext = await fresh({
    override: async (p) => {
      await p.route("**/api/**", async (route) => {
        if (!summaryFor(route.request().url(), pairedNative.id) || !firstScope)
          return route.fallback();
        firstScope = false;
        const response = await route.fetch();
        startScope();
        await scopeRelease;
        try {
          await route.fulfill({
            response,
            json: {
              ...(await response.json()),
              duration_seconds: 8888,
              tss: 888,
              intensity_factor: 4,
            },
          });
        } catch (error) {
          readbacks.push({ phase, lateScopeFulfillError: error.message });
        }
      });
    },
  });
  await open(paired);
  await scopeBegan;
  const oldScopeAt = await scopeStorageChange(scopeContext, "summary", "calendar");
  releaseScope();
  await new Promise((resolve) => setTimeout(resolve, 200));
  await assertOldRecordHidden();
  assert.deepEqual(
    requests.filter((row) => row.at >= oldScopeAt && oldRecordRequest(row.url)),
    [],
    "Old workout props cannot authorize a fresh read after account/cache scope changes"
  );
  for (const entry of network.filter(
    (row) =>
      row.kind === "failed" &&
      row.phase === "late-old-cache-scope" &&
      summaryFor(row.url, pairedNative.id) &&
      /ERR_ABORTED/.test(row.reason || "")
  ))
    expectedCanceled.push({
      ...entry,
      reasonProof:
        "Actual browser storage event changed cache scope while declared old-scope summary was held.",
    });
  checks.push(
    "actual-cross-tab-cache-scope-revoke-clears-entire-summary-and-rejects-late-old-read-with-no-new-old-id-request"
  );

  phase = "final-gates";
  await Promise.allSettled(routeTasks);
  const finalRecords = await json("preview/provider-records");
  assert.deepEqual(
    semanticRecords(finalRecords),
    semanticRecords(baseline),
    "All native semantic fields must be restored; only server updated timestamps may differ after actual description Save/restore"
  );
  assert.deepEqual(
    finalRecords.writes,
    [...baseline.writes, ...allowedNativeWrites],
    "Only the two explicit description Save/restore PUTs may write"
  );
  const httpCounts = new Map(),
    cancelCounts = new Map();
  for (const witness of authTeardowns) {
    const response = lifecycle.find(
      (row) =>
        row.event === "response" &&
        row.contextId === witness.contextId &&
        row.url === witness.url &&
        row.status === 401
    );
    assert.ok(response, "Declared auth teardown must have an actual matching401 response");
    for (const failure of lifecycle.filter(
      (row) =>
        row.event === "requestfailed" &&
        row.contextId === witness.contextId &&
        row.requestStart === response.requestStart &&
        row.url === witness.url &&
        row.failure?.errorText === "net::ERR_ABORTED" &&
        row.at >= response.at
    ))
      expectedCanceled.push({
        url: failure.url,
        method: failure.method,
        reason: failure.failure.errorText,
        reasonProof:
          "Exact injected401 request canceled by the witnessed authenticated-session teardown; actual Sign in visible.",
        responseAt: response.at,
        requestStart: response.requestStart,
        signedOutAt: witness.signedOutAt,
      });
  }
  for (const row of expectedHttp) {
    const key = JSON.stringify([row.url, row.method, row.status]);
    httpCounts.set(key, (httpCounts.get(key) || 0) + 1);
  }
  for (const row of expectedCanceled) {
    const key = JSON.stringify([row.url, row.method, row.reason]);
    cancelCounts.set(key, (cancelCounts.get(key) || 0) + 1);
  }
  const consoleStatuses = new Map();
  for (const row of expectedHttp)
    consoleStatuses.set(row.status, (consoleStatuses.get(row.status) || 0) + 1);
  const consume = (map, key) => {
    const count = map.get(key) || 0;
    if (!count) return false;
    map.set(key, count - 1);
    return true;
  };
  const unexpected = network.filter((row) =>
    row.kind === "http"
      ? !consume(httpCounts, JSON.stringify([row.url, row.method, row.status]))
      : row.kind === "failed"
        ? !consume(cancelCounts, JSON.stringify([row.url, row.method, row.reason]))
        : !(
            /Failed to load resource: the server responded with a status of (\d+)\b/.test(
              row.text
            ) && consume(consoleStatuses, Number(row.text.match(/status of (\d+)/)[1]))
          )
  );
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  assert.equal(
    await hash(new URL("../ui/dist/index.html", import.meta.url)),
    checkpoint.files[1].sha256
  );
  checks.push(
    "strict-runtime-network-frozen-artifact-and-native-semantic-cleanup-with-only-two-explicit-details-save-restore-writes"
  );
} catch (error) {
  process.exitCode = 1;
  errors.push(error.stack || error.message);
  console.error(error.message);
  await fs
    .writeFile(
      path.join(output, "failure-fields.json"),
      JSON.stringify(
        await page?.locator("textarea,input").evaluateAll((nodes) =>
          nodes.map((node) => ({
            label: node.getAttribute("aria-label"),
            name: node.name,
            value: node.value,
            readOnly: node.readOnly,
            disabled: node.disabled,
          }))
        ),
        null,
        2
      )
    )
    .catch(() => {});
  await fs
    .writeFile(
      path.join(output, "failure-geometry.json"),
      JSON.stringify(
        await page?.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          focus: document.activeElement?.outerHTML,
          dialogs: [...document.querySelectorAll('[role="dialog"]')].map((node) => {
            const style = getComputedStyle(node);
            return {
              class: node.className,
              box: node.getBoundingClientRect().toJSON(),
              position: style.position,
              left: style.left,
              top: style.top,
              right: style.right,
              bottom: style.bottom,
              translate: style.translate,
              transform: style.transform,
              animation: style.animationName,
              ancestors: [
                ...(function* (parent) {
                  while (parent) {
                    const s = getComputedStyle(parent);
                    yield {
                      tag: parent.tagName,
                      class: parent.className,
                      box: parent.getBoundingClientRect().toJSON(),
                      transform: s.transform,
                      translate: s.translate,
                      position: s.position,
                    };
                    parent = parent.parentElement;
                  }
                })(node.parentElement),
              ],
              controls: [...node.querySelectorAll("button")].map((button) => ({
                label: button.textContent.trim() || button.getAttribute("aria-label"),
                box: button.getBoundingClientRect().toJSON(),
              })),
            };
          }),
        })),
        null,
        2
      )
    )
    .catch(() => {});
  await fs
    .writeFile(path.join(output, "failure-dom.txt"), await page?.locator("body").innerText())
    .catch(() => {});
  await fs
    .writeFile(
      path.join(output, "failure-accessibility.txt"),
      await page?.locator("body").ariaSnapshot()
    )
    .catch(() => {});
  await page
    ?.screenshot({ path: path.join(output, "failure.png"), animations: "disabled" })
    .catch(() => {});
} finally {
  await Promise.allSettled(routeTasks);
  const evidence = structuredClone(network);
  await browser.close();
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        passed: checks.length,
        checks,
        errors,
        checkpoint,
        expectedHttp,
        expectedCanceled,
        allowedNativeWrites,
        requests,
        lifecycle,
        limitations: {
          synthetic: true,
          visualPercentageCertified: false,
          liveProviderVerified: false,
          actualExerciseSetsUnavailable: true,
          rawRecordingStreamsUnavailableInTheseTwoSeeds: true,
          cacheScopeBoundaryIsNotLiveAccountSwitch: true,
          browserHistoryProducerSetupUsesDeclaredPreMountHistoryApi: true,
          positiveDetailsSaveUsesRealService: true,
          declared503OnlyInterceptsNegativeDescriptionSave: true,
        },
      },
      null,
      2
    )
  );
  await fs.writeFile(path.join(output, "readbacks.json"), JSON.stringify(readbacks, null, 2));
  await fs.writeFile(path.join(output, "network.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors: errors.length }));
}
