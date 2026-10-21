// Explicit committed-workout -> native workout-library acceptance. Synthetic localhost only.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { browserNetworkEvidence } from "./browser-network-evidence.mjs";
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
const output = path.resolve("artifacts/trainingpeaks-workout-template");
await fs.mkdir(output, { recursive: true });
const hash = async (url) =>
    createHash("sha256")
      .update(await fs.readFile(new URL(url)))
      .digest("hex"),
  checkpoint = {
    capturedAt: new Date().toISOString(),
    files: await Promise.all(
      [
        import.meta.url,
        new URL("../ui/dist/index.html", import.meta.url).href,
        new URL("./desktop-calendar-preview-fixtures.mjs", import.meta.url).href,
        new URL("../app-backend/lib/workout-template.mjs", import.meta.url).href,
        new URL("../ui/src/components/save-workout-template-dialog.tsx", import.meta.url).href,
      ].map(async (file) => ({ file, sha256: await hash(file) }))
    ),
  };
const browser = await pw.chromium.launch({ channel: "msedge", headless: true }),
  network = browserNetworkEvidence(),
  checks = [],
  errors = [],
  readbacks = [],
  requests = [],
  lifecycle = [],
  active = new Set(),
  expectedHttp = [];
let page,
  id,
  date,
  baseline,
  initialExercises,
  exerciseId,
  committed,
  phase = "initial",
  synthetic = false,
  cleaned = false,
  allowError = null;
const templates = new Set(),
  scheduled = new Set(),
  stamp = Date.now(),
  title = `Synthetic committed Strength ${stamp}`,
  exerciseTitle = `Synthetic template exercise ${stamp}`,
  savedNotes = "Saved source instructions.",
  dirtyNotes = "Unsaved library snapshot instructions.";
const api = (input) => {
    const url = new URL(input);
    return url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
  },
  isTemplate = (input) => /^workouts\/.*\/save-template$/.test(api(input)),
  root = () => page.locator(".dsb-dialog"),
  modal = () => page.getByRole("dialog", { name: "Add exercise to Workout Library", exact: true }),
  button = (name) => root().getByRole("button", { name, exact: true }),
  libPosts = (ledger) =>
    ledger.writes.filter((row) => row.method === "POST" && row.path === "/athlete/0/workouts"),
  templatePosts = () => requests.filter((row) => row.method === "POST" && isTemplate(row.url));
async function json(route, options = {}) {
  const response = await page.request.fetch(`${origin}/api/${route}`, options),
    body = await response.json();
  assert.ok(response.ok(), `${route}: ${JSON.stringify(body)}`);
  readbacks.push({ phase, route, body });
  return body;
}
const records = () => json("preview/provider-records"),
  editor = () => json(`workouts/${encodeURIComponent(id)}/editor`),
  library = () => json("workout-library"),
  state = (data) => json("preview/workout-template-state", { method: "POST", data });
async function fresh(workoutId) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    colorScheme: "light",
    locale: "en-US",
  });
  network.attach(context);
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    lifecycle.push({
      event: "request",
      at: Date.now(),
      phase,
      url: request.url(),
      method: request.method(),
    });
    requests.push({
      phase,
      url: request.url(),
      method: request.method(),
      body: request.postData() ? request.postDataJSON() : null,
    });
    if (request.method() === "GET" && request.resourceType() === "fetch") active.add(request);
  });
  page.on("requestfinished", (request) => {
    active.delete(request);
    lifecycle.push({
      event: "finished",
      at: Date.now(),
      phase,
      url: request.url(),
      method: request.method(),
    });
  });
  page.on("requestfailed", (request) => {
    active.delete(request);
    lifecycle.push({
      event: "failed",
      at: Date.now(),
      phase,
      url: request.url(),
      method: request.method(),
      reason: request.failure()?.errorText,
    });
  });
  page.on("response", (response) => {
    if (allowError && response.status() === allowError.status && allowError.match(response.url()))
      expectedHttp.push([response.url(), response.request().method(), response.status()]);
  });
  await page.goto(
    `${origin}/calendar?theme=light${workoutId ? `&workout=${encodeURIComponent(workoutId)}` : ""}`,
    { waitUntil: "domcontentloaded" }
  );
  if (workoutId) await root().waitFor();
  else await page.locator(".calendar-desktop-toolbar").waitFor();
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  synthetic = true;
}
async function finiteReads() {
  for (let pass = 0; pass < 8; pass++) {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const pending = [...active].filter((request) => id && request.url().includes(id.slice(6)));
    if (!pending.length) return;
    await Promise.all(
      pending.map(async (request) => {
        const response = await request.response();
        if (response) await response.finished();
      })
    );
  }
  assert.equal(
    [...active].filter((request) => id && request.url().includes(id.slice(6))).length,
    0
  );
}
async function sourceSave(isNew = false) {
  const endpoint = isNew ? "workouts/editor" : `workouts/${encodeURIComponent(id)}/editor`,
    waiting = page.waitForResponse(
      (response) =>
        api(response.url()) === endpoint && response.request().method() === (isNew ? "POST" : "PUT")
    );
  await button("Save").click();
  const response = await waiting;
  assert.ok(response.ok(), await response.text());
  const result = await response.json();
  if (isNew) id = result.workout.id;
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".dsb-dialog button")].find(
        (node) => node.textContent.trim() === "Save"
      )?.disabled === true
  );
  await finiteReads();
  return response.request().postDataJSON();
}
async function chooseSubtype(value) {
  await button("Activity Subtype").click();
  const popup = page.getByRole("dialog", { name: "Activity Subtype", exact: true });
  await popup.getByRole("combobox", { name: "Subtype", exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
  await popup.getByRole("button", { name: "Select", exact: true }).click();
  await popup.waitFor({ state: "hidden" });
}
async function openTemplate() {
  await button("Strength workout options").click();
  const entry = page
    .getByRole("menu", { name: "Strength workout options", exact: true })
    .getByRole("menuitem", { name: "Save to Workout Library", exact: true });
  assert.equal(await entry.isEnabled(), true);
  await entry.click();
  await modal().waitFor();
  await modal()
    .getByRole("status")
    .filter({ hasText: "Loading workout library folders" })
    .waitFor({ state: "hidden" });
}
async function prepare(name) {
  await openTemplate();
  await modal().getByLabel("Workout Title", { exact: true }).fill(name);
  await modal().getByLabel("Workout Library Folder", { exact: true }).selectOption("folder:2");
  assert.equal(await modal().getByRole("button", { name: "Add", exact: true }).isEnabled(), true);
}
async function cancel() {
  await modal().getByRole("button", { name: "Cancel", exact: true }).click();
  await modal().waitFor({ state: "hidden" });
}
async function add() {
  await modal().getByRole("button", { name: "Add", exact: true }).click();
}
async function successfulAdd(name) {
  await prepare(name);
  const waiting = page.waitForResponse(
    (response) => isTemplate(response.url()) && response.request().method() === "POST"
  );
  await add();
  const response = await waiting;
  assert.ok(response.ok(), await response.text());
  const result = await response.json();
  assert.equal(result.verified, true);
  templates.add(result.workoutId);
  await modal().waitFor({ state: "hidden" });
  await finiteReads();
  return result;
}
async function lostReply(name, mutate) {
  await prepare(name);
  let captured;
  const match = (url) => isTemplate(url.href),
    lose = async (route) => {
      const response = await route.fetch();
      assert.ok(response.ok());
      captured = await response.json();
      templates.add(captured.workoutId);
      if (mutate) await route.fulfill({ response, json: mutate(structuredClone(captured)) });
      else
        await route.fulfill({
          status: 503,
          json: { error: "Synthetic lost template reply after verified native commit" },
        });
    };
  if (!mutate) allowError = { status: 503, match: isTemplate };
  await page.route(match, lose);
  await add();
  await modal().getByRole("button", { name: "Recheck library save", exact: true }).waitFor();
  await modal().getByRole("alert").waitFor();
  await page.unroute(match, lose);
  allowError = null;
  assert.ok(captured);
  return { result: captured, attempt: templatePosts().at(-1).body };
}
async function recheck() {
  const waiting = page.waitForResponse(
    (response) => isTemplate(response.url()) && response.request().method() === "POST"
  );
  await modal().getByRole("button", { name: "Recheck library save", exact: true }).click();
  return waiting;
}
async function verifyTemplate(result, snapshot) {
  const raw = (await records()).libraryWorkouts.find(
    (row) => `library:${row.id}` === result.workoutId
  );
  assert.ok(raw);
  assert.equal(raw.folder_id, 2);
  assert.equal(raw.type, "WeightTraining");
  assert.equal(raw.name, result.intent.title);
  assert.equal(raw.start_date_local, undefined);
  assert.equal(raw.paired_activity_id, undefined);
  assert.equal(raw.attachments, undefined);
  assert.match(raw.description, /Saved source instructions/);
  assert.doesNotMatch(
    raw.description,
    /Unsaved library|Athlete recording feedback|Workout editor v1|"version"\s*:|"strength"\s*:|"blocks"\s*:|"steps"\s*:/
  );
  const row = (await library()).workouts.find((row) => row.id === result.workoutId);
  assert.ok(row?.editor_model);
  // Library DTOs are deliberately undated: the existing production projection
  // normalizes their editable model date to its fixed sentinel. Scheduling
  // below independently checks projection to the requested real calendar date.
  assert.deepEqual(row.editor_model, {
    ...snapshot.model,
    name: result.intent.title,
    date: "2000-01-01",
  });
  assert.equal(row.template_metadata_error, undefined);
  for (const [field, value] of Object.entries(snapshot.plannedValues))
    assert.equal(row.workout_summary.planned[field], value, `Template planned ${field}`);
  assert.equal(row.workout_summary.planned.duration_seconds, 1200);
  assert.equal(row.workout_summary.planned.tss, 0);
  assert.equal(row.workout_date, undefined);
  return row;
}
async function ordinaryReopen() {
  lifecycle.push({ event: "explicit-navigation", at: Date.now(), phase });
  await page.goto(`${origin}/calendar?theme=light&workout=${encodeURIComponent(id)}`, {
    waitUntil: "domcontentloaded",
  });
  await root().waitFor();
  await finiteReads();
  assert.equal(await root().getByLabel("Workout Title", { exact: true }).inputValue(), title);
}
async function deleteTemplate(templateId) {
  await state({ deleteTemplateId: templateId });
  templates.delete(templateId);
  assert.equal(
    (await library()).workouts.some((row) => row.id === templateId),
    false
  );
}
function unexpected() {
  const counts = new Map(),
    consoleCounts = new Map(),
    key = (value) => JSON.stringify(value),
    consume = (map, id) => {
      const n = map.get(id) || 0;
      if (!n) return false;
      map.set(id, n - 1);
      return true;
    };
  for (const row of expectedHttp) {
    counts.set(key(row), (counts.get(key(row)) || 0) + 1);
    consoleCounts.set(row[2], (consoleCounts.get(row[2]) || 0) + 1);
  }
  return network.entries.filter((entry) =>
    entry.kind === "http-error"
      ? !consume(counts, key([entry.url, entry.method, entry.status]))
      : entry.kind === "console-error"
        ? !(
            /Failed to load resource: the server responded with a status of (\d+)\b/.test(
              entry.text
            ) && consume(consoleCounts, Number(entry.text.match(/status of (\d+)/)[1]))
          )
        : true
  );
}
try {
  await fresh();
  baseline = await records();
  initialExercises = await json("strength-exercises");
  const day = new Date();
  day.setDate(day.getDate() + 5);
  date = day.toLocaleDateString("en-CA");
  await page
    .getByRole("button", {
      name: `Add workout for ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      exact: true,
    })
    .press("Enter");
  await page
    .locator(".calendar-add-dialog")
    .getByRole("button", { name: "Strength", exact: true })
    .click();
  await page.getByRole("button", { name: "New Strength Builder", exact: true }).click();
  await root().waitFor();
  await button("Strength workout options").click();
  assert.equal(
    await page
      .getByRole("menu", { name: "Strength workout options", exact: true })
      .getByRole("menuitem", { name: "Save to Workout Library", exact: true })
      .isDisabled(),
    true
  );
  await button("Strength workout options").click();
  await root().getByLabel("Workout Title", { exact: true }).fill(title);
  await root().getByLabel("Workout Instructions", { exact: true }).fill(savedNotes);
  await chooseSubtype("Mobility");
  await button("Add Block").evaluate((node) => node.scrollIntoView({ block: "center" }));
  const addBlockBox = await button("Add Block").boundingBox();
  assert.ok(addBlockBox);
  await page.mouse.click(
    addBlockBox.x + addBlockBox.width / 2,
    addBlockBox.y + addBlockBox.height / 2
  );
  await button("Single Exercise").click();
  await root().getByRole("combobox", { name: "Exercise A", exact: true }).fill(exerciseTitle);
  await button(`Create Custom Exercise: ${exerciseTitle}`).click();
  const definition = page.getByRole("dialog", { name: "Create Custom Exercise", exact: true });
  await definition.getByLabel("Exercise title", { exact: true }).fill(exerciseTitle);
  await definition.getByRole("button", { name: "Preview Changes", exact: true }).click();
  const defSaved = page.waitForResponse(
    (response) =>
      api(response.url()) === "strength-exercises" &&
      response.request().method() === "POST" &&
      response.ok()
  );
  await page
    .getByRole("dialog", { name: "Exercise Preview", exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  exerciseId = (await (await defSaved).json()).id;
  await page.locator(".sel-dialog").waitFor({ state: "hidden" });
  await root().getByLabel(`${exerciseTitle} set 1 Reps`, { exact: true }).fill("8");
  await root().getByLabel(`${exerciseTitle} set 1 Reps`, { exact: true }).press("Tab");
  await root().getByLabel(`${exerciseTitle} set 1 Weight lb`, { exact: true }).fill("50");
  await root().getByLabel(`${exerciseTitle} set 1 Weight lb`, { exact: true }).press("Tab");
  await root().getByLabel("Planned Duration", { exact: true }).fill("0:20:00");
  await root().getByLabel("Planned TSS", { exact: true }).fill("0");
  const time = root().locator(".dsb-picker-time");
  await time.getByRole("button", { name: /^Choose time/ }).click();
  await page
    .getByRole("listbox", { name: "Select hours", exact: true })
    .getByRole("option", { name: "9 hours", exact: true })
    .click();
  await page
    .getByRole("listbox", { name: "Select minutes", exact: true })
    .getByRole("option", { name: "35 minutes", exact: true })
    .click();
  await page.getByRole("option", { name: "AM", exact: true }).click();
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await button("Comments").click();
  await root()
    .getByLabel("Add Comment", { exact: true })
    .fill("Athlete recording feedback must not become template instructions.");
  await button("Close Strength side panel").click();
  phase = "ordinary-save";
  await sourceSave(true);
  committed = await editor();
  assert.equal(committed.model.strength.subtype, "Mobility");
  assert.equal(committed.model.strength.startTimeAssigned, true);
  assert.equal(committed.scheduledTime.slice(0, 5), "09:35");
  assert.equal(committed.plannedValues.duration_seconds, 1200);
  assert.equal(committed.plannedValues.tss, 0);
  assert.ok(
    committed.comments.some(
      (comment) =>
        comment.body === "Athlete recording feedback must not become template instructions."
    )
  );
  assert.equal(libPosts(await records()).length, libPosts(baseline).length);
  assert.deepEqual((await records()).libraryWorkouts, baseline.libraryWorkouts);
  checks.push(
    "rich-strength-ordinary-save-creates-no-library-template-and-new-draft-action-is-disabled"
  );
  phase = "menu-and-cancel";
  await button("Strength workout options").click();
  await page
    .getByRole("menu", { name: "Strength workout options", exact: true })
    .getByRole("menuitem", { name: "Save to Workout Library", exact: true })
    .press("Escape");
  assert.equal(
    await page
      .getByRole("menu", { name: "Strength workout options", exact: true })
      .getByRole("menuitem", { name: "Save to Workout Library", exact: true })
      .count(),
    0
  );
  await root().waitFor();
  await root().getByLabel("Workout Instructions", { exact: true }).fill(dirtyNotes);
  const beforeCancel = await records();
  await openTemplate();
  assert.equal(await modal().getByLabel("Workout Title", { exact: true }).inputValue(), title);
  assert.equal(await modal().getByRole("button", { name: "Add", exact: true }).isDisabled(), true);
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Meta+s");
  assert.deepEqual((await records()).writes, beforeCancel.writes);
  await cancel();
  assert.equal(
    await root().getByLabel("Workout Instructions", { exact: true }).inputValue(),
    dirtyNotes
  );
  assert.equal(await button("Save").isEnabled(), true);
  checks.push(
    "saved-menu-escape-and-template-cancel-shortcuts-preserve-dirty-source-with-zero-calendar-or-library-writes"
  );
  phase = "folder-validation";
  await openTemplate();
  const folders = await json("workout-library/folders");
  await fs.writeFile(
    path.join(output, "folder-options-dom.json"),
    JSON.stringify(
      await modal()
        .getByLabel("Workout Library Folder", { exact: true })
        .evaluate((node) => ({
          html: node.outerHTML,
          disabled: node.disabled,
          options: [...node.options].map((option) => ({
            text: option.text,
            value: option.value,
            disabled: option.disabled,
            attribute: option.getAttribute("disabled"),
          })),
        })),
      null,
      2
    )
  );
  assert.deepEqual(
    folders.folders.filter((row) => row.editable).map((row) => row.id),
    ["folder:1", "folder:2"]
  );
  assert.equal(
    await modal()
      .getByRole("option", { name: "Read-only Library", exact: true })
      .evaluate((option) => option.disabled && option.hasAttribute("disabled")),
    true
  );
  assert.equal(
    await modal().getByRole("option", { name: "Public Library", exact: true }).count(),
    0
  );
  assert.equal(
    await modal().getByRole("option", { name: "Foreign Library", exact: true }).count(),
    0
  );
  await modal().getByLabel("Workout Library Folder", { exact: true }).selectOption("folder:2");
  for (const invalid of ["", "   "]) {
    await modal().getByLabel("Workout Title", { exact: true }).fill(invalid);
    assert.equal(
      await modal().getByRole("button", { name: "Add", exact: true }).isDisabled(),
      true
    );
  }
  assert.equal(
    await modal().getByLabel("Workout Title", { exact: true }).getAttribute("maxlength"),
    "128"
  );
  await cancel();
  assert.equal(templatePosts().length, 0);
  checks.push(
    "real-private-owned-folder-validation-title-required-and-readonly-public-foreign-boundaries"
  );
  phase = "held-committed-copy";
  await prepare(`Committed snapshot ${stamp}`);
  let started, release;
  const began = new Promise((resolve) => {
      started = resolve;
    }),
    held = new Promise((resolve) => {
      release = resolve;
    }),
    match = (url) => isTemplate(url.href);
  let heldResult;
  const hold = async (route) => {
    const response = await route.fetch();
    assert.ok(response.ok());
    heldResult = await response.json();
    templates.add(heldResult.workoutId);
    started();
    await held;
    await route.fulfill({ response });
  };
  await page.route(match, hold);
  await add();
  await began;
  assert.equal(await modal().getByRole("button", { name: "Add", exact: true }).isDisabled(), true);
  assert.equal(
    await modal().getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    true
  );
  assert.equal(await modal().getByLabel("Workout Title", { exact: true }).isDisabled(), true);
  await modal().press("Escape");
  await page.keyboard.press("Control+s");
  await page.keyboard.press("Meta+s");
  assert.equal(templatePosts().length, 1);
  assert.equal(await root().getByLabel("Workout Instructions", { exact: true }).isDisabled(), true);
  release();
  await modal().waitFor({ state: "hidden" });
  await page.unroute(match, hold);
  assert.ok(heldResult);
  assert.equal(libPosts(await records()).length, libPosts(baseline).length + 1);
  checks.push("held-add-locks-both-dialog-and-source-with-one-immutable-template-post");
  phase = "committed-snapshot";
  const templateRow = await verifyTemplate(heldResult, committed);
  assert.equal(
    await root().getByLabel("Workout Instructions", { exact: true }).inputValue(),
    dirtyNotes
  );
  assert.equal(await button("Save").isEnabled(), true);
  assert.deepEqual((await editor()).model, committed.model);
  assert.equal((await editor()).scheduledTime.slice(0, 5), "09:35");
  checks.push(
    "selected-folder-template-copies-last-committed-exact-strength-time-marker-planned-values-without-consuming-draft"
  );
  phase = "scheduled-copy";
  const destination = new Date(Date.parse(committed.model.date + "T12:00:00Z") + 86400000)
      .toISOString()
      .slice(0, 10),
    scheduledResult = await json(
      `workout-library/${encodeURIComponent(heldResult.workoutId)}/schedule`,
      { method: "POST", data: { date: destination, creationId: randomUUID() } }
    ),
    copyId = scheduledResult.workout.id;
  scheduled.add(copyId);
  assert.notEqual(copyId, id);
  const scheduledRead = await json(`workouts/${encodeURIComponent(copyId)}/editor`);
  assert.deepEqual(scheduledRead.model, { ...templateRow.editor_model, date: destination });
  assert.deepEqual(scheduledRead.plannedValues, committed.plannedValues);
  assert.equal(
    scheduledRead.scheduledTime.slice(0, 5),
    "00:00",
    "Native templates are undated and do not carry the source calendar clock"
  );
  assert.deepEqual((await editor()).model, committed.model);
  assert.deepEqual(
    (await library()).workouts.find((row) => row.id === heldResult.workoutId).editor_model,
    templateRow.editor_model
  );
  checks.push(
    "real-scheduled-library-copy-has-independent-calendar-id-and-date-with-source-and-template-unchanged"
  );
  phase = "provider-rejection";
  await prepare(`Rejected template ${stamp}`);
  const beforeRejected = (await records()).libraryWorkouts;
  await state({ nativeFailure: "before" });
  allowError = { status: 403, match: isTemplate };
  await add();
  await modal().getByRole("alert").waitFor();
  allowError = null;
  assert.equal(
    await modal().getByRole("button", { name: "Recheck library save", exact: true }).count(),
    0
  );
  assert.equal(await modal().getByRole("button", { name: "Add", exact: true }).isEnabled(), true);
  assert.deepEqual((await records()).libraryWorkouts, beforeRejected);
  await state({ readOnly: true });
  await modal()
    .getByRole("button", { name: "Reload workout library folders", exact: true })
    .click();
  await modal().getByRole("alert").filter({ hasText: "read-only" }).waitFor();
  assert.equal(await modal().getByRole("button", { name: "Add", exact: true }).isDisabled(), true);
  await state({ readOnly: false });
  await modal()
    .getByRole("button", { name: "Reload workout library folders", exact: true })
    .click();
  await modal()
    .getByRole("status")
    .filter({ hasText: "Loading workout library folders" })
    .waitFor({ state: "hidden" });
  await cancel();
  checks.push(
    "definite-native-rejection-and-authoritative-readonly-catalog-retain-editable-draft-without-claiming-success"
  );
  phase = "folder-source-conflicts";
  await prepare(`Folder conflict ${stamp}`);
  await state({ folder: { id: 2, name: "Renamed Strength Library" } });
  const beforeConflict = libPosts(await records()).length;
  allowError = { status: 409, match: isTemplate };
  await add();
  await modal().getByRole("alert").waitFor();
  assert.equal(libPosts(await records()).length, beforeConflict);
  assert.equal(
    await modal().getByRole("button", { name: "Cancel", exact: true }).isEnabled(),
    true
  );
  await cancel();
  allowError = null;
  await state({ folder: { id: 2, name: "Strength Library" } });
  await prepare(`Source conflict ${stamp}`);
  const external = await editor();
  await json(`workouts/${encodeURIComponent(id)}/editor`, {
    method: "PUT",
    data: {
      model: { ...external.model, notes: "Externally committed source instructions." },
      revision: external.revision,
      time: external.scheduledTime.slice(0, 5),
      values: external.plannedValues,
      description: "Externally committed source instructions.",
      descriptionMode: "manual",
    },
  });
  allowError = { status: 409, match: isTemplate };
  await add();
  await modal().getByRole("alert").waitFor();
  assert.equal(libPosts(await records()).length, beforeConflict);
  await cancel();
  allowError = null;
  await ordinaryReopen();
  committed = await editor();
  checks.push(
    "real-stale-folder-and-source-revisions-reject-before-native-library-post-without-saving-dirty-editor"
  );
  phase = "lost-reply-reload";
  const beforeLost = libPosts(await records()).length,
    lost = await lostReply(`Lost reply ${stamp}`);
  assert.equal(
    await modal().getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    true
  );
  await modal().press("Escape");
  assert.equal(await modal().count(), 1);
  lifecycle.push({ event: "explicit-reload", at: Date.now(), phase });
  await page.reload({ waitUntil: "domcontentloaded" });
  await root().waitFor();
  await finiteReads();
  await openTemplate();
  assert.equal(
    await modal().getByLabel("Workout Title", { exact: true }).inputValue(),
    lost.attempt.title
  );
  const recovered = await recheck();
  assert.ok(recovered.ok());
  await modal().waitFor({ state: "hidden" });
  assert.deepEqual(templatePosts().at(-1).body, { ...lost.attempt, reconcileOnly: true });
  assert.equal(libPosts(await records()).length, beforeLost + 1);
  checks.push(
    "post-commit-lost-reply-reloads-and-rechecks-original-account-operation-with-no-second-native-post"
  );
  phase = "account-scope";
  const beforeAccount = libPosts(await records()).length,
    accountLost = await lostReply(`Account boundary ${stamp}`);
  await state({ actor: "B" });
  allowError = { status: 409, match: isTemplate };
  const wrongAccount = await recheck();
  assert.equal(wrongAccount.status(), 409);
  await modal().getByRole("alert").waitFor();
  allowError = null;
  assert.equal(
    await modal().getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    true
  );
  assert.equal(libPosts(await records()).length, beforeAccount + 1);
  await state({ actor: "A" });
  assert.ok((await recheck()).ok());
  await modal().waitFor({ state: "hidden" });
  assert.equal(libPosts(await records()).length, beforeAccount + 1);
  assert.deepEqual(templatePosts().at(-1).body, { ...accountLost.attempt, reconcileOnly: true });
  checks.push(
    "wrong-actor-recheck409-preserves-original-account-attempt-until-return-and-never-creates-a-duplicate"
  );
  phase = "malformed-success";
  const beforeMalformed = libPosts(await records()).length,
    malformed = await lostReply(`Malformed reply ${stamp}`, (body) => ({
      ...body,
      operationId: randomUUID(),
    }));
  assert.equal(await modal().getByRole("button", { name: "Add", exact: true }).isDisabled(), true);
  assert.ok((await recheck()).ok());
  await modal().waitFor({ state: "hidden" });
  assert.equal(libPosts(await records()).length, beforeMalformed + 1);
  assert.deepEqual(templatePosts().at(-1).body, { ...malformed.attempt, reconcileOnly: true });
  checks.push(
    "wrong-success-operation-identity-retains-pending-save-and-only-exact-recheck-can-confirm-it"
  );
  phase = "changed-deleted-outcomes";
  for (const outcome of ["changed", "deleted"]) {
    const pending = await lostReply(`Outcome ${outcome} ${stamp}`);
    if (outcome === "changed")
      await state({
        template: { id: pending.result.workoutId, name: `Externally changed ${stamp}` },
      });
    else {
      await state({ deleteTemplateId: pending.result.workoutId });
      templates.delete(pending.result.workoutId);
    }
    const count = libPosts(await records()).length;
    allowError = { status: 409, match: isTemplate };
    assert.equal((await recheck()).status(), 409);
    await modal().getByRole("alert").waitFor();
    allowError = null;
    await modal()
      .getByRole("button", { name: "Review saved library outcome", exact: true })
      .click();
    const inspection = modal().getByRole("region", {
      name: "Retained library outcome",
      exact: true,
    });
    await inspection
      .getByText(outcome === "changed" ? /has since changed/ : /has since been deleted/)
      .waitFor();
    await modal()
      .getByRole("button", { name: "Acknowledge outcome and close", exact: true })
      .click();
    await modal().waitFor({ state: "hidden" });
    assert.equal(libPosts(await records()).length, count);
  }
  checks.push(
    "fresh-changed-and-deleted-inspection-proofs-require-explicit-acknowledgement-without-auto-post"
  );
  phase = "storage-catalog";
  await prepare(`Denied storage ${stamp}`);
  const countBeforeStorage = templatePosts().length;
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    window.__templateRestoreStorage = () => {
      Storage.prototype.setItem = original;
    };
    Storage.prototype.setItem = function (key, value) {
      if (String(key).startsWith("workout-template-pending:"))
        throw new DOMException("Synthetic denied template recovery storage", "SecurityError");
      return original.call(this, key, value);
    };
  });
  await add();
  await modal()
    .getByRole("alert")
    .filter({ hasText: "recovery identity could not be retained" })
    .waitFor();
  assert.equal(templatePosts().length, countBeforeStorage);
  await page.evaluate(() => window.__templateRestoreStorage());
  await cancel();
  const foldersMatch = (url) => api(url.href) === "workout-library/folders",
    wrongFolders = async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      body.folders[0].revision = "invalid";
      await route.fulfill({ response, json: body });
    };
  await page.route(foldersMatch, wrongFolders);
  await openTemplate();
  await modal().getByRole("alert").filter({ hasText: "could not be verified" }).waitFor();
  assert.equal(await modal().getByRole("button", { name: "Add", exact: true }).isDisabled(), true);
  await page.unroute(foldersMatch, wrongFolders);
  await modal()
    .getByRole("button", { name: "Reload workout library folders", exact: true })
    .click();
  await modal()
    .getByRole("status")
    .filter({ hasText: "Loading workout library folders" })
    .waitFor({ state: "hidden" });
  await cancel();
  checks.push("denied-recovery-storage-sends-zero-http-and-malformed-folder200-cannot-enable-add");
  phase = "unconfirmed";
  await prepare(`Unconfirmed ${stamp}`);
  const count = libPosts(await records()).length,
    drop = (route) =>
      route.fulfill({
        status: 503,
        json: { error: "Synthetic unavailable before template service" },
      });
  allowError = { status: 503, match: isTemplate };
  await page.route(match, drop);
  await add();
  await modal().getByRole("button", { name: "Recheck library save", exact: true }).waitFor();
  await modal().getByRole("alert").waitFor();
  await page.unroute(match, drop);
  allowError = { status: 502, match: isTemplate };
  assert.equal((await recheck()).status(), 502);
  await modal().getByRole("alert").waitFor();
  allowError = { status: 404, match: (url) => /^workout-template-operations\//.test(api(url)) };
  const absentInspection = page.waitForResponse((response) =>
    /^workout-template-operations\//.test(api(response.url()))
  );
  await modal().getByRole("button", { name: "Review saved library outcome", exact: true }).click();
  const absentResponse = await absentInspection;
  assert.equal(absentResponse.status(), 404);
  assert.equal((await absentResponse.json()).code, "TEMPLATE_OPERATION_NOT_FOUND");
  await modal()
    .getByRole("alert")
    .filter({ hasText: "The retained library operation is unavailable." })
    .waitFor();
  allowError = null;
  assert.equal(
    await modal().getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    true
  );
  assert.equal(await modal().getByRole("button", { name: "Add", exact: true }).isDisabled(), true);
  await modal().getByRole("button", { name: "Recheck library save", exact: true }).waitFor();
  assert.equal(
    await modal()
      .getByRole("button", { name: "Acknowledge outcome and close", exact: true })
      .count(),
    0
  );
  assert.equal(libPosts(await records()).length, count);
  checks.push(
    "unconfirmed-before-service-operation-remains-pending-and-reconcile-only-never-performs-first-write"
  );
  phase = "cleanup";
  await state({
    actor: "A",
    readOnly: false,
    nativeFailure: null,
    folder: {
      id: 2,
      name: "Strength Library",
      visibility: "PRIVATE",
      canEdit: true,
      owner: "self",
    },
  });
  for (const templateId of [...templates]) await deleteTemplate(templateId);
  for (const workoutId of [...scheduled, id]) {
    const response = await page.request.delete(
      `${origin}/api/workouts/${encodeURIComponent(workoutId)}`
    );
    assert.ok(response.ok());
    assert.equal(
      (
        await page.request.get(`${origin}/api/workouts/${encodeURIComponent(workoutId)}/editor`)
      ).status(),
      404
    );
  }
  if (exerciseId) {
    const catalog = await json("strength-exercises"),
      row = catalog.exercises.find((row) => row.id === exerciseId);
    await json(`strength-exercises/${encodeURIComponent(exerciseId)}`, {
      method: "DELETE",
      data: {
        accountScope: catalog.accountScope,
        revision: row.revision,
        operationId: randomUUID(),
      },
    });
    assert.deepEqual((await json("strength-exercises")).exercises, initialExercises.exercises);
  }
  const after = await records();
  assert.deepEqual(after.events, baseline.events);
  assert.deepEqual(after.libraryWorkouts, baseline.libraryWorkouts);
  cleaned = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected(), []);
  assert.equal(
    await hash(new URL("../ui/dist/index.html", import.meta.url)),
    checkpoint.files.find((row) => row.file.endsWith("/ui/dist/index.html")).sha256
  );
  checks.push(
    "exact-owned-template-calendar-exercise-cleanup-and-strict-runtime-network-artifact-gates"
  );
  assert.equal(checks.length, 15);
  await page.screenshot({
    path: path.join(output, "verified-workout-template.png"),
    animations: "disabled",
  });
} catch (error) {
  process.exitCode = 1;
  errors.push(error.stack || error.message);
  console.error(error.stack || error.message);
  if (page) {
    await fs
      .writeFile(path.join(output, "failure-dom.txt"), await page.locator("body").innerText())
      .catch(() => {});
    await page
      .screenshot({ path: path.join(output, "failure.png"), animations: "disabled" })
      .catch(() => {});
  }
} finally {
  if (synthetic && !cleaned)
    try {
      await state({
        actor: "A",
        readOnly: false,
        nativeFailure: null,
        folder: {
          id: 2,
          name: "Strength Library",
          visibility: "PRIVATE",
          canEdit: true,
          owner: "self",
        },
      });
      for (const templateId of [...templates]) await deleteTemplate(templateId);
      for (const workoutId of [...scheduled, ...(id ? [id] : [])]) {
        const response = await page.request.delete(
          `${origin}/api/workouts/${encodeURIComponent(workoutId)}`
        );
        assert.ok(response.ok() || response.status() === 404);
      }
      if (exerciseId) {
        const catalog = await json("strength-exercises"),
          row = catalog.exercises.find((row) => row.id === exerciseId);
        if (row)
          await json(`strength-exercises/${encodeURIComponent(exerciseId)}`, {
            method: "DELETE",
            data: {
              accountScope: catalog.accountScope,
              revision: row.revision,
              operationId: randomUUID(),
            },
          });
      }
      assert.deepEqual((await records()).events, baseline.events);
      assert.deepEqual((await records()).libraryWorkouts, baseline.libraryWorkouts);
      cleaned = true;
    } catch (error) {
      errors.push(`Synthetic cleanup failed: ${error.message}`);
      process.exitCode = 1;
    }
  const evidence = structuredClone(network.entries);
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
        lifecycle,
        expectedHttp,
        cleanup: { sourceId: id, verified: cleaned },
        limitations: {
          synthetic: true,
          visualPercentageCertified: false,
          templateDeletionUiImplemented: false,
          cleanupUsesStrictCreatedIdOnlyPreviewHook: true,
          scheduledCopyExercisedViaRealHttpServiceNotSchedulingUi: true,
          unconfirmedRecoveryOnlyLivesInDisposableBrowserProfile: true,
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
