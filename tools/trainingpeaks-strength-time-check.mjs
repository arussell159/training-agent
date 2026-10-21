// Real Strength time editing and saved private/native readback on disposable localhost.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { browserNetworkEvidence } from "./browser-network-evidence.mjs";
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
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5213";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = path.resolve("artifacts/trainingpeaks-strength-time");
await fs.mkdir(output, { recursive: true });
const hash = async (url) =>
  createHash("sha256")
    .update(await fs.readFile(new URL(url)))
    .digest("hex");
const checkpoint = {
  capturedAt: new Date().toISOString(),
  files: await Promise.all(
    [
      import.meta.url,
      new URL("../ui/dist/index.html", import.meta.url).href,
      new URL("./desktop-preview.mjs", import.meta.url).href,
      new URL("../ui/src/lib/strength-start-time.ts", import.meta.url).href,
      new URL("../app-backend/lib/workout-editor-model.mjs", import.meta.url).href,
    ].map(async (file) => ({ file, sha256: await hash(file) }))
  ),
};
const browser = await playwright.chromium.launch({ channel: "msedge", headless: true }),
  network = browserNetworkEvidence(),
  checks = [],
  errors = [],
  readbacks = [],
  requests = [],
  active = new Set();
let page,
  id,
  date,
  baseline,
  phase = "initial",
  synthetic = false,
  cleaned = false;
const title = `Synthetic Strength time ${Date.now()}`;
const api = (input) => {
  const url = new URL(input);
  return url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
};
const hydrationTrace = [],
  tracePending = [],
  requestIdentity = new WeakMap(),
  traceEpoch = Date.now();
let traceContext = 0,
  traceSequence = 0;
const trace = (event, contextId, details = {}) =>
  hydrationTrace.push({ elapsedMs: Date.now() - traceEpoch, phase, contextId, event, ...details });
const workoutRequest = (url) => /^workouts(?:\/|$)/.test(api(url));
async function traceHydration(context, ownedPage) {
  const contextId = ++traceContext,
    cdp = await context.newCDPSession(ownedPage);
  await cdp.send("Debugger.enable");
  await cdp.send("Debugger.setAsyncCallStackDepth", { maxDepth: 32 });
  await cdp.send("Network.enable");
  trace("context-created", contextId);
  const nativeIds = new Set();
  cdp.on("Network.requestWillBeSent", (event) => {
    if (!workoutRequest(event.request.url)) return;
    nativeIds.add(event.requestId);
    trace("cdp-request", contextId, {
      requestId: event.requestId,
      url: event.request.url,
      method: event.request.method,
      documentURL: event.documentURL,
      initiator: event.initiator,
    });
  });
  cdp.on("Network.responseReceived", (event) => {
    if (nativeIds.has(event.requestId))
      trace("cdp-response", contextId, {
        requestId: event.requestId,
        status: event.response.status,
        url: event.response.url,
      });
  });
  cdp.on("Network.loadingFinished", (event) => {
    if (nativeIds.has(event.requestId))
      trace("cdp-finished", contextId, { requestId: event.requestId });
  });
  cdp.on("Network.loadingFailed", (event) => {
    if (nativeIds.has(event.requestId))
      trace("cdp-failed", contextId, {
        requestId: event.requestId,
        errorText: event.errorText,
        canceled: event.canceled,
        blockedReason: event.blockedReason,
      });
  });
  ownedPage.on("request", (request) => {
    if (!workoutRequest(request.url())) return;
    const requestId = ++traceSequence;
    requestIdentity.set(request, { requestId, startedPhase: phase });
    trace("request", contextId, {
      requestId,
      url: request.url(),
      method: request.method(),
      pageURL: ownedPage.url(),
    });
  });
  ownedPage.on("requestfinished", (request) => {
    if (!requestIdentity.has(request)) return;
    trace("finished", contextId, {
      ...requestIdentity.get(request),
      url: request.url(),
      pageURL: ownedPage.url(),
    });
  });
  ownedPage.on("requestfailed", (request) => {
    if (!requestIdentity.has(request)) return;
    trace("failed", contextId, {
      ...requestIdentity.get(request),
      url: request.url(),
      reason: request.failure()?.errorText,
      pageURL: ownedPage.url(),
    });
    tracePending.push(
      ownedPage
        .evaluate(() => ({
          dialogPresent: Boolean(document.querySelector(".dsb-dialog")),
          title: document.querySelector('.dsb-dialog input[aria-label="Workout Title"]')?.value,
          time: [...document.querySelectorAll('.dsb-picker-time [role="spinbutton"]')].map(
            (node) => ({
              label: node.getAttribute("aria-label"),
              value: node.getAttribute("aria-valuenow"),
              text: node.textContent,
            })
          ),
          saveDisabled: [...document.querySelectorAll(".dsb-dialog button")].find(
            (node) => node.textContent.trim() === "Save"
          )?.disabled,
          alerts: [...document.querySelectorAll('[role="alert"]')].map((node) => node.textContent),
        }))
        .then(
          (state) =>
            trace("failure-visible-state", contextId, { ...requestIdentity.get(request), state }),
          (error) =>
            trace("failure-state-unavailable", contextId, {
              ...requestIdentity.get(request),
              error: error.message,
            })
        )
    );
  });
}
const root = () => page.locator(".dsb-dialog"),
  time = () => root().locator(".dsb-picker-time");
const button = (name) => root().getByRole("button", { name, exact: true });
const text = (input) => input.replace(/[\u200e\u200f\u2066-\u2069]/g, "").trim();
async function fresh(workoutId) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    locale: "en-US",
    colorScheme: "light",
  });
  network.attach(context);
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  page = await context.newPage();
  await traceHydration(context, page);
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "GET" && request.resourceType() === "fetch") active.add(request);
    if (
      ["POST", "PUT", "DELETE"].includes(request.method()) &&
      /^workouts(?:\/|$)/.test(api(request.url()))
    )
      requests.push({
        phase,
        url: request.url(),
        method: request.method(),
        body: request.postData() ? request.postDataJSON() : null,
      });
  });
  page.on("requestfinished", (request) => active.delete(request));
  page.on("requestfailed", (request) => active.delete(request));
  await page.goto(
    `${origin}/calendar?theme=light${workoutId ? `&workout=${encodeURIComponent(workoutId)}` : ""}`,
    { waitUntil: "domcontentloaded" }
  );
  if (workoutId) await root().waitFor();
  else await page.locator(".calendar-desktop-toolbar").waitFor();
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  synthetic = true;
  if (workoutId) {
    await root().waitFor();
    await time().getByRole("spinbutton", { name: "Hours", exact: true }).waitFor();
    assert.equal(await root().getByLabel("Workout Title", { exact: true }).inputValue(), title);
  }
}
async function json(route) {
  const response = await page.request.get(`${origin}/api/${route}`),
    body = await response.json();
  assert.equal(response.ok(), true, `${route}: ${JSON.stringify(body)}`);
  readbacks.push({ phase, route, body });
  return body;
}
const records = () => json("preview/provider-records");
const editor = () => json(`workouts/${encodeURIComponent(id)}/editor`);
async function finiteReads() {
  for (let pass = 0; pass < 8; pass++) {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const pending = [...active].filter((request) => !id || request.url().includes(id.slice(6)));
    if (!pending.length) return;
    await Promise.all(
      pending.map(async (request) => {
        const response = await request.response();
        if (response) await response.finished();
      })
    );
  }
  assert.equal(
    [...active].filter((request) => !id || request.url().includes(id.slice(6))).length,
    0
  );
}
async function segments() {
  await time().getByRole("spinbutton", { name: "Hours", exact: true }).waitFor();
  const fields = await time()
    .getByRole("spinbutton")
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        label: node.getAttribute("aria-label"),
        value: node.getAttribute("aria-valuenow"),
        text: node.textContent,
      }))
    );
  assert.equal(fields.length, 3);
  return fields;
}
async function blank() {
  const fields = await segments();
  assert.equal(
    fields.every((field) => field.value === null),
    true,
    JSON.stringify(fields)
  );
}
async function assigned(hours, minutes, meridiem) {
  const fields = await segments();
  assert.equal(fields.find((field) => field.label === "Hours").value, String(hours));
  assert.equal(fields.find((field) => field.label === "Minutes").value, String(minutes));
  assert.equal(text(fields[2].text).toUpperCase(), meridiem);
}
async function pick(hours, minutes, meridiem, accept = true) {
  await time()
    .getByRole("button", { name: /^Choose time/ })
    .click();
  const list = page.getByRole("listbox", { name: "Select hours", exact: true });
  await list.waitFor();
  await list.getByRole("option", { name: `${hours} hours`, exact: true }).click();
  await page
    .getByRole("listbox", { name: "Select minutes", exact: true })
    .getByRole("option", { name: `${minutes} minutes`, exact: true })
    .click();
  await page.getByRole("option", { name: meridiem, exact: true }).click();
  await page.getByRole("button", { name: accept ? "OK" : "Cancel", exact: true }).click();
  await list.waitFor({ state: "hidden" });
}
async function clearKeyboard() {
  const fields = time().getByRole("spinbutton");
  assert.equal(await fields.count(), 3);
  for (let index = 0; index < 3; index++) {
    await fields.nth(index).click();
    await fields.nth(index).press("Backspace");
  }
  await root().getByLabel("Workout Title", { exact: true }).click();
  await blank();
}
async function save(isNew = false) {
  const endpoint = isNew ? "workouts/editor" : `workouts/${encodeURIComponent(id)}/editor`,
    method = isNew ? "POST" : "PUT",
    response = page.waitForResponse(
      (response) => api(response.url()) === endpoint && response.request().method() === method
    );
  await button("Save").click();
  const saved = await response;
  assert.equal(saved.ok(), true, await saved.text());
  const wire = saved.request().postDataJSON(),
    body = await saved.json();
  assert.ok(body.workout?.id);
  if (isNew) id = body.workout.id;
  assert.equal(body.workout.id, id);
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll(".dsb-dialog button")].find(
        (node) => node.textContent.trim() === "Save"
      )?.disabled === true
  );
  await finiteReads();
  return wire;
}
async function closeReopen() {
  await button("Close Strength builder").click();
  await root().waitFor({ state: "hidden" });
  await fresh(id);
  await finiteReads();
}
async function persisted(expectedMarker, expectedTime) {
  const read = await editor();
  assert.equal(read.model.strength.startTimeAssigned, expectedMarker);
  assert.deepEqual(read.model.strength.blocks, []);
  assert.deepEqual(read.model.steps, []);
  assert.equal(read.model.unstructured, undefined);
  assert.equal(read.scheduledTime.slice(0, 5), expectedTime);
  const native = (await records()).events.find((event) => `event:${event.id}` === id);
  assert.ok(native);
  assert.equal(native.type, "WeightTraining");
  assert.equal(native.start_date_local.slice(0, 10), date);
  assert.equal(native.start_date_local.slice(11, 16), expectedTime);
  assert.equal(Boolean(native.workout_doc?.steps?.length), false);
  assert.equal(native.time_target == null, true);
  assert.doesNotMatch(
    native.description,
    /Workout editor v1|"version"\s*:|"startTimeAssigned"\s*:|"blocks"\s*:|"steps"\s*:/
  );
  return read;
}
async function historyAction(name) {
  const trigger = button("Strength workout options");
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  await page.getByRole("menu",{name:"Strength workout options",exact:true}).getByRole("menuitem", { name, exact: true }).click();
  if ((await trigger.getAttribute("aria-expanded")) === "true") await trigger.click();
}
async function historyCycle(checkTime) {
  const add = button("Add Block");
  await add.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const box = await add.boundingBox();
  assert.ok(box);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await button("Warm Up").click();
  assert.equal(await root().locator(".dsb-block").count(), 1);
  await checkTime();
  await historyAction("Undo");
  assert.equal(await root().locator(".dsb-block").count(), 0);
  await checkTime();
  await historyAction("Redo");
  assert.equal(await root().locator(".dsb-block").count(), 1);
  await checkTime();
  await historyAction("Undo");
  assert.equal(await root().locator(".dsb-block").count(), 0);
  await checkTime();
}
try {
  await fresh();
  baseline = await records();
  const now = new Date();
  now.setDate(now.getDate() + 3);
  date = now.toLocaleDateString("en-CA");
  await page
    .getByRole("button", {
      name: `Add workout for ${now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
      exact: true,
    })
    .press("Enter");
  await page
    .locator(".calendar-add-dialog")
    .getByRole("button", { name: "Strength", exact: true })
    .click();
  await page.getByRole("button", { name: "New Strength Builder", exact: true }).click();
  await root().waitFor();
  await blank();
  await root().getByLabel("Workout Title", { exact: true }).fill(title);
  phase = "unset-create";
  const unset = await save(true);
  assert.equal(Object.hasOwn(unset.model.strength, "startTimeAssigned"), false);
  assert.equal(unset.time, "00:00");
  await persisted(undefined, "00:00");
  await closeReopen();
  await blank();
  checks.push(
    "title-only-unset-ui-save-has-no-private-assignment-marker-native-midnight-and-fresh-reopen-blank"
  );
  phase = "unset-cancel";
  const writesBefore = (await records()).writes.length;
  await pick(1, 5, "PM", false);
  await blank();
  assert.equal(await button("Save").isDisabled(), true);
  assert.equal((await records()).writes.length, writesBefore);
  await persisted(undefined, "00:00");
  checks.push("canceling-popup-time-retains-unset-field-private-state-and-zero-provider-writes");
  phase = "explicit-midnight";
  await pick(12, 0, "AM");
  await assigned(12, 0, "AM");
  const midnight = await save();
  assert.equal(midnight.model.strength.startTimeAssigned, true);
  assert.equal(midnight.time, "00:00");
  await persisted(true, "00:00");
  await closeReopen();
  await assigned(12, 0, "AM");
  checks.push(
    "explicit-midnight-persists-true-assignment-despite-identical-native00-and-fresh-reopens12am"
  );
  phase = "clear-midnight";
  await clearKeyboard();
  const cleared = await save();
  assert.equal(cleared.model.strength.startTimeAssigned, false);
  assert.equal(cleared.time, "00:00");
  await persisted(false, "00:00");
  await closeReopen();
  await blank();
  checks.push(
    "actual-keyboard-clear-of-all-three-segments-persists-false-assignment-and-fresh-reopens-blank"
  );
  phase = "assigned-history";
  await pick(9, 35, "AM");
  await historyCycle(() => assigned(9, 35, "AM"));
  const afterHistory = await save();
  assert.equal(afterHistory.model.strength.startTimeAssigned, true);
  assert.equal(afterHistory.time, "09:35");
  await persisted(true, "09:35");
  await closeReopen();
  await assigned(9, 35, "AM");
  checks.push(
    "prescription-add-undo-redo-undo-does-not-revert-independent-nonzero-time-or-true-assignment"
  );
  phase = "assigned-cancel";
  const beforeAssignedCancel = (await records()).writes.length;
  await pick(12, 0, "PM", false);
  await assigned(9, 35, "AM");
  assert.equal(await button("Save").isDisabled(), true);
  assert.equal((await records()).writes.length, beforeAssignedCancel);
  await persisted(true, "09:35");
  checks.push(
    "cancel-after-nonzero-time-preserves-existing-time-and-private-assignment-without-save"
  );
  phase = "cleared-history";
  await clearKeyboard();
  await historyCycle(blank);
  const blankHistory = await save();
  assert.equal(blankHistory.model.strength.startTimeAssigned, false);
  assert.equal(blankHistory.time, "00:00");
  await persisted(false, "00:00");
  await closeReopen();
  await blank();
  checks.push(
    "prescription-history-after-clearing-never-resurrects-earlier-time-or-true-assignment"
  );
  phase = "cleanup";
  await finiteReads();
  await button("Strength workout options").click();
  await page.getByRole("menu",{name:"Strength workout options",exact:true}).getByRole("menuitem", { name: "Delete Workout", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Are you sure you want to delete?", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await root().waitFor({ state: "hidden" });
  const after = await records();
  assert.deepEqual(after.events, baseline.events);
  assert.equal(
    (await page.request.get(`${origin}/api/workouts/${encodeURIComponent(id)}/editor`)).status(),
    404
  );
  cleaned = true;
  checks.push("confirmed-ui-cleanup-removes-only-created-native-and-private-workout");
  assert.deepEqual(errors, []);
  assert.deepEqual(
    network.entries,
    [],
    "No deliberate rejection is injected; all runtime/network failures remain unexpected"
  );
  assert.equal(
    await hash(new URL("../ui/dist/index.html", import.meta.url)),
    checkpoint.files.find((row) => row.file.endsWith("/ui/dist/index.html")).sha256
  );
  checks.push("time-workflows-have-clean-runtime-network-and-unchanged-frozen-artifact");
  assert.equal(checks.length, 9);
  await page.screenshot({
    path: path.join(output, "verified-time-cleanup.png"),
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
    await fs
      .writeFile(
        path.join(output, "failure-segments.json"),
        JSON.stringify(await segments().catch(() => null), null, 2)
      )
      .catch(() => {});
    await page
      .screenshot({ path: path.join(output, "failure.png"), animations: "disabled" })
      .catch(() => {});
  }
} finally {
  await Promise.allSettled(tracePending);
  const evidence = structuredClone(network.entries),
    traceEvidence = structuredClone(hydrationTrace);
  await browser.close();
  await fs.writeFile(
    path.join(output, "hydration-trace.json"),
    JSON.stringify(traceEvidence, null, 2)
  );
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        synthetic: true,
        passed: checks.length,
        checks,
        errors,
        requests,
        checkpoint,
        cleanup: { createdId: id, verified: cleaned },
        limitations: { visualPercentageCertified: false, legacyNonzeroBrowserSeeded: false },
      },
      null,
      2
    )
  );
  await fs.writeFile(path.join(output, "network.json"), JSON.stringify(evidence, null, 2));
  await fs.writeFile(path.join(output, "readbacks.json"), JSON.stringify(readbacks, null, 2));
  console.log(
    JSON.stringify({ passed: checks.length, errors: errors.length, cleanupVerified: cleaned })
  );
}
