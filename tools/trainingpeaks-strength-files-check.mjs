// Strength Files UI acceptance, with a declared synthetic production-upload-service oracle.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { uploadWorkoutRecording } from "../app-backend/lib/workout-files.mjs";
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
const output = path.resolve("artifacts/trainingpeaks-strength-files");
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
      new URL("../ui/src/components/workout-file-actions.tsx", import.meta.url).href,
      new URL("../app-backend/lib/workout-files.mjs", import.meta.url).href,
      new URL("./desktop-preview.mjs", import.meta.url).href,
    ].map(async (file) => ({ file, sha256: await hash(file) }))
  ),
};
const browser = await pw.chromium.launch({ channel: "msedge", headless: true }),
  network = browserNetworkEvidence(),
  checks = [],
  errors = [],
  readbacks = [],
  uploadRequests = [],
  oracleWrites = [],
  expectedHttp = [],
  active = new Set();
let page,
  id,
  baseline,
  synthetic = false,
  cleaned = false,
  phase = "initial",
  mode = "reject",
  status = 400,
  originalPlan,
  pairedActivity,
  startHeld,
  releaseHeld,
  heldDone,
  heldRequest;
const bytes = Buffer.from(
    '<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"><Activities/></TrainingCenterDatabase>'
  ),
  file = { name: "synthetic-strength-recording.tcx", mimeType: "application/xml", buffer: bytes },
  title = `Synthetic Strength Files ${Date.now()}`,
  digest = createHash("sha256").update(bytes).digest("hex");
const api = (input) => {
    const url = new URL(input);
    return url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
  },
  root = () => page.locator(".dsb-dialog"),
  dialog = () => page.getByRole("dialog", { name: "Upload Device File", exact: true }),
  button = (name) => root().getByRole("button", { name, exact: true });
async function json(route) {
  const response = await page.request.get(`${origin}/api/${route}`),
    body = await response.json();
  assert.equal(response.ok(), true, `${route}: ${JSON.stringify(body)}`);
  readbacks.push({ phase, route, body });
  return body;
}
const records = () => json("preview/provider-records");
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
    if (request.method() === "GET" && request.resourceType() === "fetch") active.add(request);
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
async function menu() {
  await button("Strength workout options").click();
  return page.getByRole("menu",{name:"Strength workout options",exact:true}).getByRole("menuitem", { name: "Files", exact: true });
}
async function openFiles() {
  const entry = await menu();
  assert.equal(await entry.isEnabled(), true);
  await entry.click();
  await dialog().waitFor();
  await dialog().getByRole("button", { name: "Browse for a file", exact: true }).waitFor();
}
async function choose(selected = file) {
  await dialog().getByLabel("Activity recording", { exact: true }).setInputFiles(selected);
}
async function clickUpload() {
  await dialog().getByRole("button", { name: "Upload Device File", exact: true }).click();
}
async function retained() {
  assert.equal(await dialog().count(), 1);
  await dialog().getByRole("alert").waitFor();
  await dialog().locator(".dsb-device-file-drop").getByText(file.name, { exact: true }).waitFor();
  assert.equal(
    await dialog().getByRole("button", { name: "Cancel", exact: true }).isEnabled(),
    true
  );
  assert.equal(await dialog().getByRole("button", { name: "Done", exact: true }).count(), 0);
}
async function productionOracle(input) {
  assert.deepEqual(input, { name: file.name, data: bytes.toString("base64"), workoutId: id });
  return uploadWorkoutRecording({ INTERVALS_API_KEY: "synthetic-upload-oracle" }, input, {
    request: async (pathname) => {
      if (pathname === `/athlete/0/events/${id.slice(6)}`)
        return {
          ...originalPlan,
          ...(pairedActivity ? { paired_activity_id: pairedActivity.id } : {}),
        };
      if (pairedActivity && pathname === `/activity/${pairedActivity.id}`)
        return structuredClone(pairedActivity);
      throw Error(`Unexpected synthetic upload read: ${pathname}`);
    },
    fetchImpl: async (url, options) => {
      const target = new URL(url);
      assert.equal(target.origin, "https://intervals.icu");
      assert.equal(target.pathname, "/api/v1/athlete/0/activities");
      assert.equal(options.method, "POST");
      assert.equal(target.searchParams.get("paired_event_id"), id.slice(6));
      assert.equal(target.searchParams.get("external_id"), `training-agent:${digest}`);
      const uploaded = options.body.get("file");
      assert.equal(uploaded.name, file.name);
      assert.deepEqual(Buffer.from(await uploaded.arrayBuffer()), bytes);
      oracleWrites.push({
        url: String(url),
        method: options.method,
        fileName: uploaded.name,
        bytes: uploaded.size,
        sha256: digest,
      });
      pairedActivity = {
        id: "i799999991",
        start_date_local: originalPlan.start_date_local,
        paired_event_id: id.slice(6),
        external_id: `training-agent:${digest}`,
      };
      return new Response(JSON.stringify({ activities: [{ id: pairedActivity.id }] }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
}
async function intercept(route) {
  const body = route.request().postDataJSON();
  uploadRequests.push({ phase, body });
  assert.deepEqual(body, { name: file.name, data: bytes.toString("base64"), workoutId: id });
  if (mode === "held") {
    heldRequest = route.request();
    startHeld();
    await heldDone;
    expectedHttp.push(status);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: `Synthetic upload rejection ${status}` }),
    });
    return;
  }
  if (mode === "reject") {
    expectedHttp.push(status);
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify({ error: `Synthetic upload rejection ${status}` }),
    });
    return;
  }
  if (mode === "malformed") {
    await route.fulfill({ json: { verified: true, activityIds: [], pairedWorkoutId: id } });
    return;
  }
  if (mode === "wrong-pair") {
    await route.fulfill({
      json: { verified: true, activityIds: ["i799999991"], pairedWorkoutId: "event:999999" },
    });
    return;
  }
  const result = await productionOracle(body);
  readbacks.push({ phase, route: "synthetic-real-upload-service", body: result });
  await route.fulfill({ json: result });
}
function unexpectedNetwork() {
  const counts = new Map();
  for (const status of expectedHttp) counts.set(status, (counts.get(status) || 0) + 1);
  const consoleCounts = new Map(counts);
  const consume = (map, key) => {
    const n = map.get(key) || 0;
    if (!n) return false;
    map.set(key, n - 1);
    return true;
  };
  return network.entries.filter((entry) =>
    entry.kind === "http-error"
      ? !(
          api(entry.url) === "workout-files/upload" &&
          entry.method === "POST" &&
          consume(counts, entry.status)
        )
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
  const day = new Date();
  day.setDate(day.getDate() + 4);
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
  assert.equal(await (await menu()).isDisabled(), true);
  await button("Strength workout options").click();
  await root().getByLabel("Workout Title", { exact: true }).fill(title);
  let signalStarted;
  const pendingStarted = new Promise((resolve) => {
      signalStarted = resolve;
    }),
    releaseSavePromise = new Promise((resolve) => {
      releaseHeld = resolve;
    });
  const saveMatch = (url) => api(url.href) === "workouts/editor",
    holdSave = async (route) => {
      const response = await route.fetch();
      signalStarted();
      await releaseSavePromise;
      await route.fulfill({ response });
    };
  await page.route(saveMatch, holdSave);
  const saved = page.waitForResponse(
    (response) =>
      api(response.url()) === "workouts/editor" && response.request().method() === "POST"
  );
  await button("Save").click();
  await pendingStarted;
  assert.equal(await button("Strength workout options").isDisabled(), true);
  releaseHeld();
  const savedResponse = await saved;
  assert.equal(savedResponse.ok(), true);
  id = (await savedResponse.json()).workout.id;
  assert.match(id, /^event:[1-9]\d*$/);
  await page.unroute(saveMatch, holdSave);
  await finiteReads();
  await button("Close Strength builder").click();
  await root().waitFor({ state: "hidden" });
  await fresh(id);
  await finiteReads();
  originalPlan = (await records()).events.find((row) => `event:${row.id}` === id);
  assert.ok(originalPlan);
  const uploadBaseline = await records();
  checks.push(
    "new-and-pending-strength-files-unavailable-then-exact-saved-identity-survives-fresh-direct-open"
  );
  phase = "cancel";
  await openFiles();
  await page.screenshot({ path: path.join(output, "opened-upload-dialog.png"), animations: "disabled" });
  const measuredUpload = await dialog().evaluate(node => {
    const box = node.getBoundingClientRect(), style = getComputedStyle(node);
    return { className: node.className, viewportWidth: window.innerWidth, box: { x: box.x, y: box.y, width: box.width, height: box.height }, maxWidth: style.maxWidth, borderRadius: style.borderRadius, boxShadow: style.boxShadow, padding: style.padding };
  });
  await fs.writeFile(path.join(output, "upload-dialog-geometry.json"), JSON.stringify(measuredUpload, null, 2));
  assert.ok(Math.abs(measuredUpload.box.width - Math.min(640, measuredUpload.viewportWidth - 64)) <= 0.5, `Upload dialog width: ${JSON.stringify(measuredUpload)}`);
  assert.ok(Math.abs(parseFloat(measuredUpload.maxWidth) - (measuredUpload.viewportWidth - 64)) <= 0.5);
  assert.equal(measuredUpload.borderRadius, "8px");
  assert.match(measuredUpload.boxShadow, /^rgba\(26, 32, 46, 0\.3\) 0px 24px 48px 0px$/);
  checks.push("opened-upload-dialog-has-settled640px-width-viewport-limit8px-radius-and-recorded-shadow");
  assert.equal(
    await dialog().getByRole("button", { name: "Upload Device File", exact: true }).isDisabled(),
    true
  );
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  assert.deepEqual((await records()).writes, uploadBaseline.writes);
  checks.push("accessible-device-upload-dialog-empty-cancel-produces-no-upload-or-native-write");
  await page.route((url) => api(url.href) === "workout-files/upload", intercept);
  phase = "invalid";
  await openFiles();
  await choose({
    name: "private-notes.json",
    mimeType: "application/json",
    buffer: Buffer.from("{}"),
  });
  await clickUpload();
  await dialog().getByRole("alert").filter({ hasText: "FIT, TCX or GPX" }).waitFor();
  assert.equal(uploadRequests.length, 0);
  await choose({
    name: file.name,
    mimeType: file.mimeType,
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1),
  });
  await clickUpload();
  await dialog().getByRole("alert").filter({ hasText: "smaller than 2 MB" }).waitFor();
  assert.equal(uploadRequests.length, 0);
  await dialog().getByRole("button", { name: "Cancel", exact: true }).click();
  checks.push("unsupported-extension-and-oversize-recordings-fail-locally-with-zero-upload-http");
  phase = "browse-drop";
  await openFiles();
  const chooser = page.waitForEvent("filechooser");
  await dialog().getByRole("button", { name: "Browse for a file", exact: true }).click();
  await (await chooser).setFiles(file);
  await dialog().locator(".dsb-device-file-drop").getByText(file.name, { exact: true }).waitFor();
  await dialog()
    .locator(".dsb-device-file-drop")
    .evaluate((node) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File(["first"], "first.tcx"));
      transfer.items.add(new File(["second"], "second.tcx"));
      node.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer })
      );
    });
  await dialog().getByRole("alert").filter({ hasText: "one recording" }).waitFor();
  assert.equal(uploadRequests.length, 0);
  await dialog().locator(".dsb-device-file-drop").getByText(file.name, { exact: true }).waitFor();
  await dialog().locator(".dsb-device-file-drop").evaluate((node, selected) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(selected.bytes)], selected.name, { type: selected.type }));
    node.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { bytes: [...bytes], name: file.name, type: file.mimeType });
  assert.equal(await dialog().getByRole("alert").count(), 0);
  await dialog().locator(".dsb-device-file-drop").getByText(file.name, { exact: true }).waitFor();
  checks.push("real-browse-and-single-file-drop-retain-bytes-while-multiple-file-drop-is-rejected-without-upload");
  phase = "held";
  let started;
  const heldStarted = new Promise((resolve) => {
    started = resolve;
  });
  startHeld = started;
  heldDone = new Promise((resolve) => {
    releaseHeld = resolve;
  });
  mode = "held";
  status = 400;
  await clickUpload();
  await heldStarted;
  assert.equal(
    await dialog().getByRole("button", { name: "Processing…", exact: true }).isDisabled(),
    true
  );
  assert.equal(
    await dialog().getByRole("button", { name: "Cancel", exact: true }).isDisabled(),
    true
  );
  assert.equal(await dialog().getByLabel("Activity recording", { exact: true }).isDisabled(), true);
  await dialog().press("Escape");
  assert.equal(await dialog().count(), 1);
  await page.keyboard.press("Control+s");
  assert.equal(uploadRequests.length, 1);
  assert.equal(await root().getByLabel("Workout Title", { exact: true }).isDisabled(), true);
  assert.deepEqual((await records()).writes, uploadBaseline.writes);
  assert.ok(heldRequest);
  releaseHeld();
  await retained();
  checks.push("held-upload-locks-dialog-and-parent-without-escape-ctrls-or-duplicate-write");
  phase = "rejected";
  mode = "reject";
  for (status of [403, 503]) {
    const before = uploadRequests.length;
    await clickUpload();
    await retained();
    assert.equal(uploadRequests.length, before + 1);
  }
  assert.deepEqual(
    uploadRequests.map((row) => row.body),
    uploadRequests.map(() => ({ name: file.name, data: bytes.toString("base64"), workoutId: id }))
  );
  assert.deepEqual((await records()).writes, uploadBaseline.writes);
  checks.push(
    "definite-and-unavailable-upload-errors-retain-the-same-file-and-workout-for-explicit-retry"
  );
  phase = "malformed";
  for (mode of ["malformed", "wrong-pair"]) {
    await clickUpload();
    await retained();
  }
  checks.push("malformed-success-and-wrong-linked-identity-cannot-claim-a-verified-upload");
  phase = "production-oracle";
  mode = "service";
  await clickUpload();
  await dialog()
    .getByRole("status")
    .filter({ hasText: "Activity uploaded and verified. The recording is linked to this workout." })
    .waitFor();
  assert.equal(oracleWrites.length, 1);
  assert.equal(pairedActivity.paired_event_id, id.slice(6));
  assert.equal(pairedActivity.external_id, `training-agent:${digest}`);
  await dialog().getByRole("button", { name: "Done", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  await finiteReads();
  assert.deepEqual((await records()).writes, uploadBaseline.writes);
  checks.push(
    "actual-production-upload-service-verifies-declared-synthetic-multipart-bytes-hash-and-exact-pair"
  );
  phase = "same-file-retry";
  await openFiles();
  await choose();
  await clickUpload();
  await dialog()
    .getByRole("status")
    .filter({ hasText: "Activity uploaded and verified" })
    .waitFor();
  assert.equal(
    oracleWrites.length,
    1,
    "Real service must read the existing matching pair instead of issuing another native POST"
  );
  await dialog().getByRole("button", { name: "Done", exact: true }).click();
  await dialog().waitFor({ state: "hidden" });
  await finiteReads();
  checks.push(
    "same-file-retry-uses-real-service-paired-readback-without-second-synthetic-native-post"
  );
  phase = "cleanup";
  await button("Strength workout options").click();
  await page.getByRole("menu",{name:"Strength workout options",exact:true}).getByRole("menuitem", { name: "Delete Workout", exact: true }).click();
  await page
    .getByRole("alertdialog", { name: "Are you sure you want to delete?", exact: true })
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  await root().waitFor({ state: "hidden" });
  assert.deepEqual((await records()).events, baseline.events);
  assert.equal(
    (await page.request.get(`${origin}/api/workouts/${encodeURIComponent(id)}/editor`)).status(),
    404
  );
  cleaned = true;
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpectedNetwork(), []);
  assert.equal(
    await hash(new URL("../ui/dist/index.html", import.meta.url)),
    checkpoint.files.find((row) => row.file.endsWith("/ui/dist/index.html")).sha256
  );
  checks.push("exact-synthetic-cleanup-and-strict-runtime-network-artifact-gates");
  assert.equal(checks.length, 11);
  await page.screenshot({
    path: path.join(output, "verified-files-cleanup.png"),
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
  if (synthetic && id && !cleaned)
    try {
      const response = await page.request.delete(
        `${origin}/api/workouts/${encodeURIComponent(id)}`
      );
      assert.ok(response.ok() || response.status() === 404);
      assert.deepEqual((await records()).events, baseline.events);
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
        uploadRequests,
        oracleWrites,
        expectedHttp,
        cleanup: { id, verified: cleaned },
        limitations: {
          actualLiveProviderUpload: false,
          nativeFileParsingInProvider: false,
          interceptedFrontendUploadPassedThroughProductionService: true,
          syntheticUploadProviderIsSeparateFromPreviewProvider: true,
          visualPercentageCertified: false,
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
