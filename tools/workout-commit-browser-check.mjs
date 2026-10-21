// Uses production UI + real commit worker + synthetic provider and memory backend.
// IndexedDB assertions are durable browser transactions; backend storage is a test double.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url),
  { chromium } = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    )
  );
const dist = process.env.PERF_DIST || "ui/dist";
const port = Number(process.env.PERF_PORT || 5251),
  origin = `http://127.0.0.1:${port}`,
  output = process.env.PERF_OUTPUT || "artifacts/performance-2026-10-21/commits-browser.json";
const n = Number(process.env.PERF_SAMPLES || 40),
  delay = Number(process.env.COMMIT_PROVIDER_DELAY || 7000);
const server = spawn(
  process.execPath,
  [
    "tools/desktop-preview.mjs",
    "--calendar-edits",
    `--dist=${dist}`,
    `--port=${port}`,
    `--commit-provider-delay-ms=${delay}`,
  ],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let browser;
const evidence = {
  conditions: {
    dist,
    n,
    providerDelayMs: delay,
    viewport: { width: 1280, height: 820 },
    network: "localhost; synthetic provider writes deliberately delayed; no browser throttling",
    backend:
      "real createDurableWorkoutCommits service with serialized in-memory test record; not production Supabase latency/durability",
  },
  samples: [],
  checks: [],
};
evidence.backendAcceptance = [];
async function ledger(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("training-agent-workout-commits-v1", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result,
            tx = db.transaction("ledgers"),
            r = tx.objectStore("ledgers").getAll();
          r.onsuccess = () => {
            resolve(r.result);
            db.close();
          };
          r.onerror = () => reject(r.error);
        };
      })
  );
}
async function inspect(page) {
  const response = await page.request.get(`${origin}/api/preview/workout-commits`);
  assert.ok(response.ok());
  return response.json();
}
async function open(page, id) {
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  await page.locator(`[data-workout-id="${id}"]`).click();
  await page.getByRole("button", { name: "Workout actions", exact: true }).click();
  await page
    .locator(".desktop-workout-toolbar-popover")
    .getByRole("button", { name: /Edit workout/i })
    .click();
  await page.locator(".dtb-workspace").waitFor();
}
async function save(page, title) {
  await page.locator('.dtb-workspace input[aria-label="Workout title"]').fill(title);
  await page.evaluate((title) => {
    window.__commitMeasure = { title };
    document.addEventListener(
      "click",
      (event) => {
        const value = window.__commitMeasure;
        value.start = performance.now();
        const clickedButton = event.target.closest("button");
        const visible = () => {
          if (clickedButton?.disabled)
            requestAnimationFrame(() => {
              value.visibleMs = performance.now() - value.start;
            });
          else requestAnimationFrame(visible);
        };
        visible();
      },
      { once: true, capture: true }
    );
  }, title);
  await page.locator(".dtb-footer").getByRole("button", { name: "Save", exact: true }).click();
  await page.waitForFunction(
    () =>
      window.__commitMeasure.durableMs !== undefined &&
      window.__commitMeasure.visibleMs !== undefined
  );
  const value = await page.evaluate(() => window.__commitMeasure);
  const stored = (await ledger(page))
    .flatMap((x) => x.operations)
    .find((op) => op.input.model.name === title);
  assert.ok(stored, `Accepted revision ${title} exists in IDB`);
  await page.waitForFunction(() =>
    /Saved on this device|Saved in the app|Synced to Intervals\.icu/.test(
      document.querySelector(".dtb-footer")?.textContent || ""
    )
  );
  return value;
}
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(Error(`Fixture exited ${code}`)));
  });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  evidence.conditions.browser = browser.version();
  const context = await browser.newContext({
    viewport: evidence.conditions.viewport,
    colorScheme: "light",
  });
  await context.addInitScript(() => {
    const transaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args) {
      const tx = transaction.apply(this, args);
      if (
        this.name === "training-agent-workout-commits-v1" &&
        args[1] === "readwrite" &&
        window.__abortNextWorkoutCommit
      ) {
        window.__abortNextWorkoutCommit = false;
        queueMicrotask(() => tx.abort());
      }
      if (this.name === "training-agent-workout-commits-v1" && args[1] === "readwrite")
        tx.addEventListener("complete", () => {
          const value = window.__commitMeasure;
          if (!value?.start || value.durableMs !== undefined) return;
          const completed = performance.now();
          const read = transaction
            .call(this, "ledgers", "readonly")
            .objectStore("ledgers")
            .getAll();
          read.onsuccess = () => {
            if (
              read.result.some((ledger) =>
                ledger.operations.some((op) => op.input.model.name === value.title)
              )
            )
              value.durableMs = completed - value.start;
          };
        });
      return tx;
    };
  });
  const requests = new Map();
  context.on("request", (request) => {
    if (
      request.method() === "POST" &&
      (new URL(request.url()).searchParams.get("__api_route") ||
        new URL(request.url()).pathname.replace(/^\/api\//, "")) === "workout-commits"
    )
      requests.set(request, performance.now());
  });
  context.on("response", (response) => {
    const request = response.request(),
      start = requests.get(request);
    if (start === undefined) return;
    void response
      .json()
      .then((body) => {
        if (body.accepted)
          evidence.backendAcceptance.push({
            operationId: body.operationId,
            revision: body.revision,
            responseMs: performance.now() - start,
            accepted: true,
          });
      })
      .catch(() => {});
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const initial = await (
      await page.request.get(`${origin}/api/training-context?scope=full`)
    ).json(),
    id = initial.planned.find((row) => row.title === "Editable run workout").id;
  await open(page, id);
  for (let i = 0; i < n; i++) {
    const title = `Commit benchmark revision ${i + 1}`;
    evidence.samples.push(await save(page, title));
    if (n < 10 || i % 10 === 9) console.log(`durable saves ${i + 1}/${n}`);
  }
  let latest = evidence.samples.at(-1).title;
  await page.getByRole("button", { name: "Close workout builder", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(
    await page.locator(`[data-workout-id="${id}"]`).filter({ hasText: latest }).count(),
    1
  );
  evidence.checks.push(
    "Latest accepted revision remains visible in calendar during delayed synchronization"
  );
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(
    await page.locator(`[data-workout-id="${id}"]`).filter({ hasText: latest }).count(),
    1
  );
  evidence.checks.push("Reload restores latest accepted model from IDB before provider completion");
  if (process.env.COMMIT_LOST_RESPONSE === "1") {
    const lostTitle = "Accepted backend response intentionally lost";
    const deliveries = [];
    const dropAcceptedResponse = async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const api = url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
      if (api !== "workout-commits" || request.method() !== "POST" || request.postDataJSON()?.input?.model?.name !== lostTitle) {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      const accepted = await response.json();
      assert.ok(response.ok() && accepted.accepted);
      deliveries.push({ body: request.postData(), accepted });
      await route.abort("connectionreset");
    };
    await context.route("**/api/**", dropAcceptedResponse);
    await open(page, id);
    await save(page, lostTitle);
    const waitForDeliveries = async count => {
      for (let attempt = 0; attempt < 60 && deliveries.length < count; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.ok(deliveries.length >= count, `Backend accepted ${count} lost-response deliveries`);
    };
    await waitForDeliveries(1);
    const operationId = deliveries[0].accepted.operationId;
    assert.equal((await inspect(page)).workouts.find(row => row.workoutId === id).model.name, lostTitle);
    await page.reload({ waitUntil: "networkidle" });
    await waitForDeliveries(2);
    assert.equal(deliveries[0].body, deliveries[1].body);
    assert.equal(deliveries[0].accepted.revision, deliveries[1].accepted.revision);
    assert.equal(deliveries[1].accepted.operationId, operationId);
    await context.unroute("**/api/**", dropAcceptedResponse);
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    let recovered;
    for (let attempt = 0; attempt < 60; attempt++) {
      recovered = (await ledger(page)).flatMap(row => row.operations).find(op => op.operationId === operationId);
      if (recovered?.backendRevision) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.equal(recovered?.backendRevision, deliveries[0].accepted.revision);
    const host = await inspect(page);
    assert.equal(host.store.operations[operationId].revision, Number(recovered.backendRevision.slice(4)));
    evidence.lostResponse = { deliveries, recoveredRevision: recovered.backendRevision, operationId };
    evidence.checks.push("Response lost after actual backend acceptance survives reload; identical operation UUID/body replays to the same revision and then acknowledges locally");
    latest = lostTitle;
  }
  const deliveryBlocked = async (route) => {
    const url = new URL(route.request().url()),
      api = url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
    if (api === "workout-commits") await route.abort("internetdisconnected");
    else await route.continue();
  };
  await context.route("**/api/**", deliveryBlocked);
  evidence.recovery = [];
  for (let i = 0; i < 10; i++) {
    await open(page, id);
    latest = `Delivery outage revision ${i + 1}`;
    await save(page, latest);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(`[data-workout-id="${id}"]`).filter({ hasText: latest }).waitFor();
    const local = (await ledger(page))
      .flatMap((x) => Object.values(x.workouts))
      .find((row) => row.workoutId === id);
    assert.equal(local.input.model.name, latest);
    assert.equal(local.state, "local");
    evidence.recovery.push({ iteration: i + 1, title: latest, retained: true });
    console.log(`delivery outage ${i + 1}/10`);
  }
  await context.unroute("**/api/**", deliveryBlocked);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  evidence.checks.push(
    "Ten delivery-outage save/reload cycles retain full model and local outbox; restoring transport resumes handoff"
  );
  const second = await context.newPage();
  await second.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  assert.equal(
    await second.locator(`[data-workout-id="${id}"]`).filter({ hasText: latest }).count(),
    1
  );
  evidence.checks.push("Second tab reads shared accepted revision");
  await open(second, id);
  await open(page, id);
  latest = "Two-tab accepted winner";
  await save(page, latest);
  await second
    .locator('.dtb-workspace input[aria-label="Workout title"]')
    .fill("Stale tab draft must survive conflict");
  await second.locator(".dtb-footer").getByRole("button", { name: "Save", exact: true }).click();
  await second
    .getByText(/This workout changed in another tab\. Reopen it before saving/)
    .first()
    .waitFor();
  assert.equal(
    await second.locator('.dtb-workspace input[aria-label="Workout title"]').inputValue(),
    "Stale tab draft must survive conflict"
  );
  assert.equal(
    (await ledger(second))
      .flatMap((row) => Object.values(row.workouts))
      .find((row) => row.workoutId === id).input.model.name,
    latest
  );
  await second.getByRole("button", { name: "Close workout builder", exact: true }).click();
  await second.getByRole("button", { name: "Discard changes", exact: true }).click();
  await second.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  evidence.checks.push(
    "Concurrent stale editor Save is rejected across tabs; losing draft stays recoverable and winner remains accepted"
  );
  await page.close();
  let finalState;
  for (let attempt = 0; attempt < 180; attempt++) {
    finalState = await inspect(second);
    const row = finalState.workouts.find((row) => row.workoutId === id);
    if (row?.model?.name === latest && row.syncStatus === "synced") break;
    if (attempt % 15 === 0)
      console.log("handoff", row?.revision, row?.model?.name, row?.syncStatus);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  evidence.finalState = finalState;
  const finished = await inspect(second);
  const remote = finished.workouts.find((row) => row.workoutId === id);
  assert.equal(remote.model.name, latest);
  assert.equal(remote.syncStatus, "synced");
  const native = await (await second.request.get(`${origin}/api/preview/provider-records`)).json();
  assert.equal(
    native.events.filter((row) => row.id === Number(remote.providerWorkoutId.split(":")[1]))[0]
      .name,
    latest
  );
  evidence.checks.push(
    "Worker survives first tab close; final native provider row equals latest accepted revision"
  );
  await open(second, id);
  await context.setOffline(true);
  const offlineTitle = "Actual offline accepted revision";
  await save(second, offlineTitle);
  const offlineLedger = (await ledger(second))
    .flatMap((x) => Object.values(x.workouts))
    .find((row) => row.workoutId === id);
  assert.equal(offlineLedger.input.model.name, offlineTitle);
  assert.equal(offlineLedger.state, "local");
  await second.reload({ waitUntil: "domcontentloaded", timeout: 5000 }).catch(() => {});
  await context.setOffline(false);
  await second.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  await second.locator(`[data-workout-id="${id}"]`).filter({ hasText: offlineTitle }).waitFor();
  evidence.checks.push(
    "Actual offline Save commits full model+operation; failed offline reload retains it; reconnect reopens accepted revision"
  );
  let accepted;
  for (let attempt = 0; attempt < 60; attempt++) {
    accepted = (await inspect(second)).workouts.find((row) => row.workoutId === id);
    if (accepted?.model?.name === offlineTitle) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.equal(accepted.model.name, offlineTitle);
  assert.equal(accepted.syncStatus, "pending");
  evidence.closedTabAccepted = {
    workoutId: id,
    revision: accepted.revision,
    status: accepted.syncStatus,
  };
  await second.close();
  let closedFinal;
  for (let attempt = 0; attempt < 60; attempt++) {
    closedFinal = await (await context.request.get(`${origin}/api/preview/workout-commits`)).json();
    const row = closedFinal.workouts.find((row) => row.workoutId === id);
    if (row?.model?.name === offlineTitle && row.syncStatus === "synced") break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  const closedRow = closedFinal.workouts.find((row) => row.workoutId === id);
  assert.equal(closedRow.model.name, offlineTitle);
  assert.equal(closedRow.syncStatus, "synced");
  const closedNative = await (
    await context.request.get(`${origin}/api/preview/provider-records`)
  ).json();
  assert.equal(
    closedNative.events.find((row) => row.id === Number(closedRow.providerWorkoutId.split(":")[1]))
      .name,
    offlineTitle
  );
  evidence.checks.push(
    "After backend acknowledges pending revision, ALL browser tabs close; server-owned worker reaches correct native final revision"
  );
  evidence.closedTabCompleted = {
    revision: closedRow.revision,
    syncedRevision: closedRow.syncedRevision,
    acceptedAt: closedRow.acceptedAt,
    observedAt: new Date().toISOString(),
  };
  const finalPage = await context.newPage();
  await open(finalPage, id);
  const beforeCancel = (await ledger(finalPage)).flatMap((row) => row.operations).length;
  await finalPage
    .locator('.dtb-workspace input[aria-label="Workout title"]')
    .fill("Unsaved title must be discarded");
  await finalPage.getByRole("button", { name: "Close workout builder", exact: true }).click();
  await finalPage.getByRole("button", { name: "Discard changes", exact: true }).click();
  const afterCancel = await ledger(finalPage);
  assert.equal(afterCancel.flatMap((row) => row.operations).length, beforeCancel);
  assert.equal(
    afterCancel.flatMap((row) => Object.values(row.workouts)).find((row) => row.workoutId === id)
      .input.model.name,
    offlineTitle
  );
  evidence.checks.push(
    "Cancel+Discard unsaved editor changes creates no accepted operation and preserves earlier accepted model"
  );
  await open(finalPage, id);
  await context.setOffline(true);
  const beforeFailure = await ledger(finalPage),
    failedTitle = "Recoverable draft after storage transaction abort";
  await finalPage.locator('.dtb-workspace input[aria-label="Workout title"]').fill(failedTitle);
  await finalPage.evaluate(() => {
    window.__abortNextWorkoutCommit = true;
  });
  await finalPage.locator(".dtb-footer").getByRole("button", { name: "Save", exact: true }).click();
  await finalPage.locator('.dtb-footer [role="alert"]').waitFor();
  assert.equal(
    await finalPage.locator('.dtb-workspace input[aria-label="Workout title"]').inputValue(),
    failedTitle
  );
  const afterFailure = await ledger(finalPage);
  assert.equal(
    afterFailure.flatMap((row) => row.operations).length,
    beforeFailure.flatMap((row) => row.operations).length
  );
  assert.equal(
    afterFailure.flatMap((row) => Object.values(row.workouts)).find((row) => row.workoutId === id)
      .input.model.name,
    offlineTitle
  );
  await context.setOffline(false);
  const failureHost = (await inspect(finalPage)).workouts.find((row) => row.workoutId === id);
  assert.equal(failureHost.model.name, offlineTitle);
  evidence.checks.push(
    "Injected IndexedDB transaction abort leaves recoverable editor draft visible, creates no operation and changes neither accepted model nor backend record"
  );
  const stats = (key) => {
    const values = evidence.samples.map((x) => x[key]).sort((a, b) => a - b);
    return {
      n: values.length,
      median: values[Math.ceil(values.length * 0.5) - 1],
      p95: values[Math.ceil(values.length * 0.95) - 1],
      max: values.at(-1),
    };
  };
  evidence.summary = { visible: stats("visibleMs"), durableIDB: stats("durableMs") };
  console.log(JSON.stringify(evidence.summary));
} catch (error) {
  evidence.error = error.stack;
  if (error.snapshot) evidence.failureState = error.snapshot;
  throw error;
} finally {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
  await browser?.close();
  server.kill();
}
