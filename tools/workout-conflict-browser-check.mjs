// Production UI and real conflict service; synthetic provider and in-memory backend only.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const port = Number(process.env.CONFLICT_PORT || 5254), origin = `http://127.0.0.1:${port}`;
const output = process.env.CONFLICT_OUTPUT || "artifacts/trainingpeaks-parity/conflict-browser-20261021.json";
const server = spawn(process.execPath, ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`], { stdio: ["ignore", "pipe", "pipe"] });
let browser;
const evidence = { synthetic: true, backend: "Real service with serialized memory record; not production database durability", checks: [] };
async function until(callback, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await callback(); if (result) return result; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw Error("Expected persisted state was not observed");
}
try {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await new Promise((resolve, reject) => { server.stdout.once("data", resolve); server.once("error", reject); server.once("exit", code => reject(Error(`Preview exited ${code}`))); });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: "light" });
  let page = await context.newPage();
  page.setDefaultTimeout(15000);
  const json = async (url, method = "GET", body) => {
    const response = await page.request.fetch(`${origin}/api/${url}`, { method, ...(body ? { data: body } : {}) });
    const result = await response.json(); assert.ok(response.ok(), `${response.status()}: ${JSON.stringify(result)}`); return result;
  };
  const initial = await json("training-context?scope=full"), id = initial.planned.find(row => row.title === "Editable run workout").id;
  const inspect = () => json("preview/workout-commits");
  const row = async () => (await inspect()).workouts.find(item => item.workoutId === id);
  const localResolutions = () => page.evaluate(() => new Promise(resolve => {
    const open = indexedDB.open("training-agent-workout-commits-v1", 1);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction("ledgers").objectStore("ledgers").getAll();
      request.onsuccess = () => { resolve(request.result.flatMap(ledger => Object.values(ledger.resolutions || {}))); db.close(); };
    };
  }));
  const external = async title => {
    const native = await json(`workouts/${encodeURIComponent(id)}/editor`);
    return json(`workouts/${encodeURIComponent(id)}/editor`, "PUT", { model: { ...native.model, name: title }, revision: native.revision });
  };
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  await page.locator(`[data-workout-id="${id}"]`).click();
  await page.getByRole("button", { name: "Workout actions", exact: true }).click();
  await page.locator(".desktop-workout-toolbar-popover").getByRole("button", { name: /Edit workout/i }).click();
  const title = page.locator('.dtb-workspace input[aria-label="Workout title"]');
  const save = async name => { await title.fill(name); await page.locator(".dtb-footer").getByRole("button", { name: "Save", exact: true }).click(); await until(async () => (await row())?.model.name === name); };
  await save("Conflict baseline");
  await until(async () => (await row())?.syncStatus === "synced");
  await external("External version one");
  await save("App version one");
  await until(async () => (await row())?.externalConflict);
  await page.locator(".dtb-footer").getByRole("button", { name: "Review changes", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: "Review workout changes", exact: true }) });
  await dialog.getByText("External version one", { exact: true }).waitFor();
  await dialog.getByText("App version one", { exact: true }).waitFor();
  await external("External version two");
  await dialog.getByRole("button", { name: "Keep app version", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await until(async () => (await localResolutions()).some(item => item.state === "failed"));
  assert.equal((await json(`workouts/${encodeURIComponent(id)}/editor`)).model.name, "External version two");
  evidence.checks.push("A native edit after review rejects the stale choice without overwriting either version");
  await page.locator(".dtb-footer").getByRole("button", { name: "Review changes", exact: true }).click();
  await dialog.getByText("External version two", { exact: true }).waitFor();
  await dialog.getByRole("button", { name: "Keep app version", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await until(async () => (await row())?.syncStatus === "synced");
  assert.equal((await json(`workouts/${encodeURIComponent(id)}/editor`)).model.name, "App version one");
  evidence.checks.push("Explicit keep-app choice rebases only on the reviewed provider revision and converges to the full app model");
  await page.getByRole("button", { name: "Close workout builder", exact: true }).click();
  await page.getByRole("button", { name: "Workout actions", exact: true }).click();
  await page.locator(".desktop-workout-toolbar-popover").getByRole("button", { name: /Edit workout/i }).click();
  await title.waitFor();
  await external("Provider version to adopt");
  await save("App version retained in archive");
  await until(async () => (await row())?.externalConflict);
  await page.locator(".dtb-footer").getByRole("button", { name: "Review changes", exact: true }).click();
  await dialog.getByText("Provider version to adopt", { exact: true }).waitFor();
  const attempts = [];
  let loseResponse = true;
  await context.route(/workout-commits.*conflict/, async route => {
    if (route.request().method() !== "POST") return route.continue();
    attempts.push(route.request().postDataJSON());
    if (loseResponse) { loseResponse = false; await route.fetch(); return route.abort("failed"); }
    return route.continue();
  });
  await dialog.getByRole("button", { name: "Use Intervals.icu version", exact: true }).click();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
  await until(async () => (await row())?.model.name === "Provider version to adopt");
  // Destroy the entire page runtime after the backend choice, before its lost
  // response can be acknowledged locally. The next page must replay the stored UUID.
  await page.close(); page = await context.newPage();
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  await until(() => attempts.length >= 2);
  assert.deepEqual(attempts[0], attempts[1]);
  await page.waitForFunction(() => new Promise(resolve => {
    const open = indexedDB.open("training-agent-workout-commits-v1", 1);
    open.onsuccess = () => {
      const db = open.result, request = db.transaction("ledgers").objectStore("ledgers").getAll();
      request.onsuccess = () => { resolve(request.result.some(ledger => Object.values(ledger.workouts).some(row => row.input.model.name === "Provider version to adopt" && row.state === "synced"))); db.close(); };
    };
  }));
  await until(async () => (await row())?.syncStatus === "synced");
  assert.equal((await row()).model.name, "Provider version to adopt");
  assert.equal((await json(`workouts/${encodeURIComponent(id)}/editor`)).model.name, "Provider version to adopt");
  const state = await inspect(), archived = state.store.workouts[id].resolutionHistory;
  assert.ok(archived?.length >= 2, "Both explicit resolutions must retain their reviewed copies");
  assert.ok(JSON.stringify(archived).includes("App version retained in archive"));
  evidence.checks.push("Accept-provider choice survives a lost response and complete page close/reopen by replaying its persistent operation identity/body; losing app version remains archived");
  await page.screenshot({ path: output.replace(/\.json$/, ".png"), fullPage: false });
  evidence.passed = true; evidence.archiveCount = archived.length;
} finally {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(evidence, null, 2));
  await browser?.close(); server.kill();
}
console.log(JSON.stringify(evidence, null, 2));
