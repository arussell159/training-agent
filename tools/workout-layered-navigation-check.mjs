// Synthetic localhost acceptance for layered consent and immutable creation recovery.
// One explicit owned workout create/recheck/delete; no live provider calls.
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
const output = path.resolve(process.env.LAYERED_EVIDENCE || "artifacts/workout-layered-navigation");
await fs.mkdir(output, { recursive: true });
const hash = async (file) =>
    createHash("sha256")
      .update(await fs.readFile(file))
      .digest("hex"),
  checkpoint = {
    at: new Date().toISOString(),
    files: await Promise.all(
      [
        new URL(import.meta.url),
        new URL("../ui/dist/index.html", import.meta.url),
        new URL("../ui/src/components/desktop-workout-create.tsx", import.meta.url),
        new URL("../ui/src/components/workout-editor.tsx", import.meta.url),
        new URL("./desktop-calendar-preview-fixtures.mjs", import.meta.url),
      ].map(async (file) => ({ file: file.href, sha256: await hash(file) }))
    ),
  };
const browser = await pw.chromium.launch({ channel: "msedge", headless: true }),
  checks = [],
  errors = [],
  requests = [],
  network = [],
  readbacks = [],
  expectedHttp = [];
let page,
  phase = "initial",
  baseline,
  initialCatalog,
  ownedId = null,
  wire = null,
  created = null,
  cleaned = false;
const stamp = Date.now(),
  parentTitle = `Layered parent ${stamp}`,
  childTitle = `Layered child ${stamp}`,
  runTitle = `Immutable Run ${stamp}`,
  notes = "Exact retained structured Run description.",
  privateNotes = "Exact retained personal Run notes.";
const api = (input) => {
  const url = new URL(input);
  return url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
};
const isCreate = (input) => api(input) === "workouts/editor",
  isLibrary = (input) => api(input) === "strength-exercises";
const strength = () => page.locator(".dsb-dialog"),
  definition = () => page.locator(".sel-dialog"),
  builder = () => page.locator(".we-tp-desktop"),
  creator = () => page.locator(".desktop-workout-create");
const childDiscard = () =>
    page.getByRole("alertdialog", { name: "Discard exercise changes?", exact: true }),
  parentDiscard = () =>
    page.getByRole("alertdialog", { name: "Discard unsaved changes?", exact: true });
const day = new Date();
day.setDate(day.getDate() + 5);
const date = day.toLocaleDateString("en-CA"),
  dayLabel = `Add workout for ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
async function json(route, options = {}) {
  const response = await page.request.fetch(`${origin}/api/${route}`, options);
  assert.ok(response.ok(), `${route}: ${response.status()} ${await response.text()}`);
  const body = await response.json();
  readbacks.push({ phase, route, body });
  return body;
}
const records = () => json("preview/provider-records"),
  catalog = () => json("strength-exercises"),
  actor = (value) =>
    json("preview/strength-library-state", {
      method: "POST",
      data: { actor: value, readOnly: false, failNextWrite: null },
    });
async function fresh({ historyPair = false } = {}) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    colorScheme: "light",
    locale: "en-US",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  if (historyPair)
    await context.addInitScript(() => {
      if (window !== window.top || location.pathname !== "/calendar") return;
      const target = location.href,
        base = new URL(target);
      base.pathname = "/";
      const before = history.length;
      history.replaceState({ declaredLayeredEntry: "base" }, "", base.href);
      history.pushState({ declaredLayeredEntry: "calendar" }, "", target);
      window.__layeredHistory = { target, base: base.href, before, entries: history.length };
    });
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) =>
    requests.push({
      phase,
      at: Date.now(),
      url: request.url(),
      method: request.method(),
      body:
        request.postData() && request.headers()["content-type"]?.includes("application/json")
          ? request.postDataJSON()
          : null,
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
  });
  page.on("requestfailed", (request) =>
    network.push({
      kind: "failed",
      phase,
      url: request.url(),
      method: request.method(),
      reason: request.failure()?.errorText,
    })
  );
  page.on("console", (message) => {
    if (message.type() === "error") network.push({ kind: "console", phase, text: message.text() });
  });
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "domcontentloaded" });
  await page.locator(".calendar-desktop-toolbar").waitFor();
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  return context;
}
async function add(sport, label = dayLabel) {
  await page.getByRole("button", { name: label, exact: true }).press("Enter");
  await page
    .locator(".calendar-add-dialog")
    .getByRole("button", { name: sport, exact: true })
    .click();
}
async function newStrength() {
  await add("Strength");
  await page.getByRole("button", { name: "New Strength Builder", exact: true }).click();
  await strength().waitFor();
  await strength().getByLabel("Workout Title", { exact: true }).fill(parentTitle);
  await strength().getByRole("button", { name: "Library", exact: true }).click();
  await strength()
    .locator(".dsb-right-panel")
    .getByRole("button", { name: "Add Exercise", exact: true })
    .click();
  await page.getByRole("dialog", { name: "Create Custom Exercise", exact: true }).waitFor();
  await definition().getByLabel("Exercise title", { exact: true }).fill(childTitle);
}
async function titles() {
  assert.equal(
    await strength().getByLabel("Workout Title", { exact: true }).inputValue(),
    parentTitle
  );
  const field = definition().getByLabel("Exercise title", { exact: true });
  if (await field.count()) assert.equal(await field.inputValue(), childTitle);
  else await definition().getByText(childTitle, { exact: true }).waitFor();
}
async function noWrites() {
  assert.deepEqual(await records(), baseline);
  const current = await catalog();
  assert.deepEqual(current.exercises, initialCatalog.exercises);
  assert.equal(current.total, initialCatalog.total);
}
async function expected(response) {
  expectedHttp.push({
    url: response.url(),
    method: response.request().method(),
    status: response.status(),
  });
  return response;
}
async function historyState() {
  return page.evaluate(() => ({
    url: location.href,
    length: history.length,
    setup: window.__layeredHistory,
  }));
}
async function verifyBlockedBack(original) {
  await page.goBack({ waitUntil: "commit" });
  await page.waitForURL(original.url);
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  assert.equal(await parentDiscard().count(), 0);
  assert.equal(await childDiscard().count(), 0);
  assert.equal((await historyState()).length, original.length);
  await titles();
}
async function controls(scope) {
  return scope.evaluate((node) => ({
    fields: [...node.querySelectorAll("input,textarea,select")].map((field) => ({
      label: field.getAttribute("aria-label"),
      type: field.type,
      value: field.value,
      checked: field.checked,
      locked: field.matches(":disabled") || field.readOnly || Boolean(field.closest("[inert]")),
    })),
    actions: [...node.querySelectorAll("button,summary")].map((button) => ({
      label: button.getAttribute("aria-label") || button.textContent.trim(),
      locked: button.matches(":disabled") || Boolean(button.closest("[inert]")),
      draggable: button.draggable,
    })),
    steps: [...node.querySelectorAll('[aria-label="Step title"]')].map((field) => field.value),
  }));
}
async function pendingFrozen() {
  const before = await controls(builder());
  readbacks.push({ phase, pendingBuilderControls: before });
  assert.ok(before.fields.length > 8);
  for (const field of before.fields)
    assert.equal(
      field.locked,
      true,
      `Pending field remains editable: ${field.label || field.type}`
    );
  // Undo/Redo live in a closed portaled menu. Its actual trigger must be
  // locked, and native keyboard history attempts below must change nothing.
  for (const label of ["Add Active", "Workout recurrence", "Workout actions"]) {
    const actions = before.actions.filter(
      (action) => action.label === label || action.label.startsWith(`${label} (`)
    );
    assert.ok(actions.length, `Missing mutation action ${label}`);
    for (const action of actions)
      assert.equal(action.locked, true, `${label} remains active while creation is uncertain`);
  }
  const posts = requests.filter((row) => row.method === "POST" && isCreate(row.url)).length;
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+Shift+z");
  await page.keyboard.press("Delete");
  const active = builder().locator('button[aria-label="Add Active"]'),
    box = await active.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 100, { steps: 8 });
  await page.mouse.up();
  assert.deepEqual(
    await controls(builder()),
    before,
    "Keyboard/actual pointer drag must not alter the retained request view"
  );
  assert.equal(requests.filter((row) => row.method === "POST" && isCreate(row.url)).length, posts);
}
async function closePending() {
  const close = builder()
    .locator(".dtb-draft-recovery")
    .getByRole("button", { name: "Close", exact: true });
  await close.click();
  await builder().waitFor({ state: "hidden" });
  if (await creator().isVisible()) {
    await creator().getByRole("button", { name: "Close", exact: true }).click();
    await creator().waitFor({ state: "hidden" });
  }
}
function unexpectedNetwork() {
  const http = new Map(),
    consoleCodes = new Map(),
    key = (row) => JSON.stringify([row.url, row.method, row.status]),
    consume = (map, key) => {
      const value = map.get(key) || 0;
      if (!value) return false;
      map.set(key, value - 1);
      return true;
    };
  for (const row of expectedHttp) {
    http.set(key(row), (http.get(key(row)) || 0) + 1);
    consoleCodes.set(row.status, (consoleCodes.get(row.status) || 0) + 1);
  }
  return network.filter((row) =>
    row.kind === "http"
      ? !consume(http, key(row))
      : row.kind === "console"
        ? !(
            /Failed to load resource: the server responded with a status of (\d+)\b/.test(
              row.text
            ) && consume(consoleCodes, Number(row.text.match(/status of (\d+)/)[1]))
          )
        : true
  );
}
async function cleanup() {
  await actor("A");
  if (ownedId) {
    assert.match(ownedId, /^event:[1-9]\d*$/);
    const current = await records();
    if (current.events.some((row) => `event:${row.id}` === ownedId)) {
      const response = await page.request.delete(
        `${origin}/api/workouts/${encodeURIComponent(ownedId)}`
      );
      assert.ok(response.ok(), await response.text());
    }
    assert.equal(
      (
        await page.request.get(`${origin}/api/workouts/${encodeURIComponent(ownedId)}/editor`)
      ).status(),
      404
    );
  }
  const after = await records();
  assert.deepEqual(after.events, baseline.events);
  assert.deepEqual(after.activities, baseline.activities);
  assert.deepEqual(after.libraryWorkouts, baseline.libraryWorkouts);
  assert.deepEqual((await catalog()).exercises, initialCatalog.exercises);
  cleaned = true;
}
try {
  await fresh({ historyPair: true });
  baseline = await records();
  initialCatalog = await catalog();
  assert.deepEqual(baseline.writes, []);
  await newStrength();
  phase = "nested-child-consent-parent-cancel";
  const original = await historyState();
  assert.equal(original.setup.entries, original.setup.before + 1);
  await page.goBack({ waitUntil: "commit" });
  await childDiscard().waitFor();
  await childDiscard().getByRole("button", { name: "Discard changes", exact: true }).click();
  await parentDiscard().waitFor();
  await parentDiscard().getByRole("button", { name: "Cancel", exact: true }).click();
  await page.waitForURL(original.url);
  await titles();
  assert.equal((await historyState()).length, original.length);
  assert.equal(await page.goForward({ waitUntil: "commit" }), null);
  await titles();
  await noWrites();
  checks.push(
    "native-back-child-consent-then-parent-cancel-preserves-both-inputs-url-history-and-zero-native-private-writes"
  );
  phase = "nested-all-consent";
  await page.goBack({ waitUntil: "commit" });
  await childDiscard().waitFor();
  await childDiscard().getByRole("button", { name: "Discard changes", exact: true }).click();
  await parentDiscard().waitFor();
  await parentDiscard().getByRole("button", { name: "Discard", exact: true }).click();
  await page.waitForURL(original.setup.base);
  assert.equal(await strength().count(), 0);
  assert.equal(await definition().count(), 0);
  await noWrites();
  await page.goForward({ waitUntil: "commit" });
  await page.waitForURL(original.setup.target);
  await page.locator(".calendar-desktop-toolbar").waitFor();
  await add("Strength");
  await page.getByRole("button", { name: "New Strength Builder", exact: true }).click();
  await strength().waitFor();
  assert.notEqual(
    await strength().getByLabel("Workout Title", { exact: true }).inputValue(),
    parentTitle
  );
  await noWrites();
  checks.push("all-layer-consent-exits-and-forward-reopen-has-no-old-draft-or-server-write");

  phase = "busy-child-blocks";
  await fresh({ historyPair: true });
  await newStrength();
  await definition().getByRole("button", { name: "Preview Changes", exact: true }).click();
  await page.getByRole("dialog", { name: "Exercise Preview", exact: true }).waitFor();
  let release, start;
  const began = new Promise((resolve) => (start = resolve)),
    held = new Promise((resolve) => (release = resolve));
  const reject = async (route) => {
    if (route.request().method() !== "POST" || !isLibrary(route.request().url()))
      return route.fallback();
    start();
    await held;
    await route.fulfill({
      status: 503,
      json: { error: "Declared exercise request unavailable before service" },
    });
  };
  await page.route("**/api/**", reject);
  const libraryFailure = page.waitForResponse(
    (response) =>
      isLibrary(response.url()) &&
      response.request().method() === "POST" &&
      response.status() === 503
  );
  await definition().getByRole("button", { name: "Save", exact: true }).click();
  await began;
  const busyHistory = await historyState();
  await verifyBlockedBack(busyHistory);
  await noWrites();
  checks.push(
    "busy-exercise-save-blocks-browser-exit-before-any-parent-consent-or-server-mutation"
  );
  phase = "uncertain-account-child-blocks";
  release();
  await expected(await libraryFailure);
  await page.unroute("**/api/**", reject);
  await definition().getByRole("button", { name: "Recheck exercise save", exact: true }).waitFor();
  await verifyBlockedBack(busyHistory);
  const firstExercise = requests.findLast((row) => row.method === "POST" && isLibrary(row.url));
  await actor("B");
  const rejected = page.waitForResponse(
    (response) =>
      isLibrary(response.url()) &&
      response.request().method() === "POST" &&
      response.status() === 409
  );
  await definition().getByRole("button", { name: "Recheck exercise save", exact: true }).click();
  await expected(await rejected);
  const recheckExercise = requests.findLast((row) => row.method === "POST" && isLibrary(row.url));
  assert.deepEqual(recheckExercise.body, { ...firstExercise.body, reconcileOnly: true });
  await verifyBlockedBack(busyHistory);
  assert.equal((await catalog()).total, 0);
  await actor("A");
  await noWrites();
  checks.push(
    "unconfirmed-exercise-and-real-account409-block-exit-retain-exact-original-operation-and-never-write-either-catalog"
  );

  phase = "run-real-create-lost-reply";
  await fresh();
  await add("Run");
  await creator().waitFor();
  await creator().getByLabel("Workout title", { exact: true }).fill(runTitle);
  await creator().getByRole("button", { name: "Build Workout", exact: true }).click();
  await builder().waitFor();
  await builder().getByRole("button", { name: "Continue", exact: true }).click();
  await builder().getByRole("button", { name: "Add Active", exact: true }).click();
  await builder().getByLabel("Step title", { exact: true }).fill("Retained interval");
  await builder().getByLabel("Workout start time", { exact: true }).fill("09:35");
  await builder().getByLabel("Planned duration", { exact: true }).fill("0:20:00");
  await builder().getByLabel("Planned tss", { exact: true }).fill("23");
  await builder().getByLabel("Workout description", { exact: true }).fill(notes);
  await builder().getByLabel("Private Notes", { exact: true }).fill(privateNotes);
  await builder().getByLabel("Workout title", { exact: true }).fill(runTitle);
  await builder().getByLabel("Workout date", { exact: true }).fill(date);
  let dropped = false;
  const lose = async (route) => {
    if (route.request().method() !== "POST" || !isCreate(route.request().url()) || dropped)
      return route.fallback();
    dropped = true;
    wire = route.request().postDataJSON();
    const response = await route.fetch();
    assert.equal(response.status(), 200, await response.text());
    created = await response.json();
    assert.equal(created.verified, true);
    ownedId = created.workout.id;
    assert.match(ownedId, /^event:[1-9]\d*$/);
    readbacks.push({ phase, actualCommittedBeforeLostReply: created, wire });
    await route.fulfill({
      status: 503,
      json: { error: "Declared lost workout create response after verified native commit" },
    });
  };
  await page.route("**/api/**", lose);
  const lost = page.waitForResponse(
    (response) =>
      isCreate(response.url()) &&
      response.request().method() === "POST" &&
      response.status() === 503
  );
  await builder().getByRole("button", { name: "Save", exact: true }).click();
  await expected(await lost);
  await page.unroute("**/api/**", lose);
  await builder()
    .locator(".dtb-draft-recovery")
    .getByRole("button", { name: "Recheck Save", exact: true })
    .waitFor();
  assert.equal(wire.model.name, runTitle);
  assert.equal(wire.model.date, date);
  assert.equal(wire.time, "09:35");
  assert.equal(wire.description, notes);
  assert.equal(wire.values.duration_seconds, 1200);
  assert.equal(wire.values.tss, 23);
  assert.equal(wire.model.steps[0].label, "Retained interval");
  assert.match(wire.creationId, /^[a-f0-9-]{36}$/);
  const native = await records();
  assert.equal(native.events.filter((row) => `event:${row.id}` === ownedId).length, 1);
  assert.equal(
    native.writes.filter((row) => row.method === "POST" && /\/events$/.test(row.path)).length,
    1
  );
  checks.push(
    "actual-run-summary-builder-save-commits-one-verified-native-before-declared-lost-reply-and-retains-original-wire"
  );
  phase = "pending-builder-immutable";
  await pendingFrozen();
  checks.push(
    "uncertain-parent-creation-freezes-all-child-model-time-planned-description-personal-recurrence-fields-and-mutation-actions"
  );
  phase = "close-reload-reopen-recheck";
  await closePending();
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator(".calendar-desktop-toolbar").waitFor();
  const another = new Date(day);
  another.setDate(another.getDate() + 1);
  await add(
    "Run",
    `Add workout for ${another.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`
  );
  await creator().waitFor();
  assert.equal(await creator().getByLabel("Workout title", { exact: true }).inputValue(), runTitle);
  assert.equal(await creator().getByLabel("Workout date", { exact: true }).inputValue(), date);
  assert.equal(
    await creator().getByLabel("Workout start time", { exact: true }).inputValue(),
    "09:35"
  );
  const resumed = await controls(creator());
  readbacks.push({ phase, recoveredPendingControls: resumed });
  for (const field of resumed.fields)
    assert.equal(field.locked, true, `Recovered pending field editable: ${field.label}`);
  const beforeRecheck = (await records()).writes.filter(
    (row) => row.method === "POST" && /\/events$/.test(row.path)
  ).length;
  const confirmed = page.waitForResponse(
    (response) => isCreate(response.url()) && response.request().method() === "POST"
  );
  const confirmedPersonal = page.waitForResponse(
    (response) =>
      api(response.url()) === `workouts/${encodeURIComponent(ownedId)}/personal` &&
      response.request().method() === "PUT"
  );
  await creator()
    .getByRole("button", { name: /^Recheck save$/i })
    .click();
  const response = await confirmed;
  assert.equal(response.status(), 200, await response.text());
  assert.deepEqual(response.request().postDataJSON(), { ...wire, reconcileOnly: true });
  const result = await response.json();
  assert.equal(result.verified, true);
  assert.equal(result.workout.id, ownedId);
  const personalResponse = await confirmedPersonal;
  assert.equal(personalResponse.status(), 200, await personalResponse.text());
  await personalResponse.finished();
  await creator()
    .getByRole("button", { name: "Saving…", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(
    (await records()).writes.filter((row) => row.method === "POST" && /\/events$/.test(row.path))
      .length,
    beforeRecheck
  );
  const saved = await json(`workouts/${encodeURIComponent(ownedId)}/editor`);
  assert.deepEqual(saved.model.steps, wire.model.steps);
  assert.equal(saved.model.date, date);
  const personal = await json(`workouts/${encodeURIComponent(ownedId)}/personal`);
  assert.equal(personal.value.privateNotes, privateNotes);
  const raw = (await records()).events.find((row) => `event:${row.id}` === ownedId);
  assert.ok(raw.description.includes(notes));
  assert.doesNotMatch(
    raw.description,
    /Workout editor v1|training-agent-(?:manual-description|planned-values|workout-comments)-v1|"(?:version|duration_seconds|text)"\s*:/i
  );
  assert.equal(
    raw.description,
    `\`\`\`\n${notes}\n\`\`\`\n\nIntervals.icu device definition:\n- 600s 105-115% Pace intensity=active`
  );
  assert.deepEqual(raw.workout_doc.steps, [
    { duration: 600, pace: { units: "%pace", start: 105, end: 115 }, intensity: "active" },
  ]);
  assert.equal(raw.workout_doc.duration, 600);
  checks.push(
    "close-reload-different-day-reopen-rechecks-identical-original-wire-date-creationId-once-with-private-native-readback"
  );
  phase = "cleanup-and-gates";
  await cleanup();
  assert.deepEqual(unexpectedNetwork(), []);
  assert.deepEqual(errors, []);
  assert.equal(
    await hash(new URL("../ui/dist/index.html", import.meta.url)),
    checkpoint.files[1].sha256
  );
  await page.screenshot({
    path: path.join(output, "verified-layered-navigation.png"),
    animations: "disabled",
  });
  checks.push(
    "exact-owned-workout-only-cleanup-native-and-private404-and-strict-runtime-network-frozen-artifact-gates"
  );
} catch (error) {
  process.exitCode = 1;
  errors.push(error.stack || error.message);
  console.error(error.message);
  await fs
    .writeFile(path.join(output, "failure-dom.txt"), await page?.locator("body").innerText())
    .catch(() => {});
  await fs
    .writeFile(
      path.join(output, "failure-accessibility.txt"),
      await page?.locator("body").ariaSnapshot()
    )
    .catch(() => {});
  await fs
    .writeFile(
      path.join(output, "failure-fields.json"),
      JSON.stringify(
        await page?.locator("input,textarea,select").evaluateAll((fields) =>
          fields.map((field) => ({
            label: field.getAttribute("aria-label"),
            value: field.value,
            disabled: field.matches(":disabled"),
            inert: Boolean(field.closest("[inert]")),
          }))
        ),
        null,
        2
      )
    )
    .catch(() => {});
  await page
    ?.screenshot({ path: path.join(output, "failure.png"), animations: "disabled" })
    .catch(() => {});
} finally {
  if (baseline && !cleaned)
    try {
      await cleanup();
    } catch (error) {
      errors.push(`Synthetic cleanup failed: ${error.message}`);
      process.exitCode = 1;
    }
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
        requests,
        expectedHttp,
        ownedId,
        wire,
        cleanup: { verified: cleaned },
        limitations: {
          synthetic: true,
          liveProviderVerified: false,
          historySetupUsesDeclaredPreMountRealHistoryApi: true,
          negativeExerciseRequestInterceptedBeforeService: true,
          positiveWorkoutLostReplyOnlyAfterActualVerifiedServiceCommit: true,
        },
      },
      null,
      2
    )
  );
  await fs.writeFile(path.join(output, "readbacks.json"), JSON.stringify(readbacks, null, 2));
  await fs.writeFile(path.join(output, "network.json"), JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({ passed: checks.length, errors: errors.length, cleanupVerified: cleaned })
  );
}
