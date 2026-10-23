// Actual production UI interactions; all records belong to the disposable preview.
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
const port = 5403,
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let browser, page;
const result = { checks: [], firstConfirmationMs: null, errors: [] };
try {
  await new Promise((r, j) => {
    server.stdout.once("data", r);
    server.once("error", j);
  });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
    timezoneId: "America/Chicago",
  });
  page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") result.errors.push(e.text());
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Calendar", exact: true }).click();
  await page.getByRole("button", { name: "Open Editable run workout", exact: true }).click();
  await page.getByRole("button", { name: "Edit Editable run workout", exact: true }).click();
  const field = page.getByLabel("Workout name", { exact: true });
  await field.fill("Retained confirmation draft");
  const cancel = page.getByRole("button", { name: "Cancel workout editing", exact: true });
  await page.evaluate(() => {
    window.__confirmationMs = null;
    document.addEventListener(
      "click",
      () => {
        const start = performance.now(),
          check = () => {
            const dialog = document.querySelector('[role="alertdialog"]');
            if (dialog && dialog.getBoundingClientRect().height > 0)
              requestAnimationFrame(() => (window.__confirmationMs = performance.now() - start));
            else requestAnimationFrame(check);
          };
        requestAnimationFrame(check);
      },
      { once: true, capture: true }
    );
  });
  await cancel.click();
  const modal = page.getByRole("alertdialog", { name: "Discard unsaved changes?", exact: true });
  await modal.waitFor();
  await page.waitForFunction(() => window.__confirmationMs !== null);
  result.firstConfirmationMs = await page.evaluate(() => window.__confirmationMs);
  assert.equal(
    await modal.getByRole("button", { name: "Discard changes", exact: true }).count(),
    1
  );
  assert.equal(
    await modal
      .getByRole("button", { name: "Cancel", exact: true })
      .evaluate((e) => e === document.activeElement),
    true
  );
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    assert.equal(
      await modal.evaluate((e) => e.contains(document.activeElement)),
      true,
      "focus remains in confirmation"
    );
  }
  await page.keyboard.press("Escape");
  await modal.waitFor({ state: "detached" });
  assert.equal(await field.inputValue(), "Retained confirmation draft");
  assert.equal(await cancel.evaluate((e) => e === document.activeElement), true);
  result.checks.push(
    "Mobile shared confirmation opens with action wording, traps Tab, Escape retains draft and restores trigger focus"
  );
  await cancel.click();
  await modal.waitFor();
  const original = page.url();
  await page.evaluate(() => history.back());
  await modal.waitFor({ state: "detached" });
  await page.waitForURL(original);
  assert.equal(await field.inputValue(), "Retained confirmation draft");
  result.checks.push(
    "Browser Back dismisses open confirmation and preserves current editor, URL and draft"
  );
  await page.evaluate(() => history.back());
  await modal.waitFor();
  await page.evaluate(() => history.back());
  await modal.waitFor({ state: "detached" });
  await page.waitForURL(original);
  assert.equal(await field.inputValue(), "Retained confirmation draft");
  result.checks.push(
    "Back while navigation awaits consent cancels the pending exit without losing the draft"
  );
  await page.evaluate(() => {
    const trigger = document.querySelector('button[aria-label="Cancel workout editing"]');
    trigger.click();
    trigger.click();
  });
  await modal.waitFor();
  assert.equal(await page.locator("[data-app-confirmation]").count(), 1);
  assert.equal(await page.getByRole("alertdialog").count(), 1);
  result.checks.push(
    "Duplicate close events create one confirmation and do not share approval with a second action"
  );
  await modal.getByRole("button", { name: "Discard changes", exact: true }).click();
  await modal.waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Edit Editable run workout", exact: true }).waitFor();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Open Editable run workout", exact: true }).waitFor();
  assert.equal(await page.locator("[data-app-confirmation]").count(), 0);
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), "hidden");
  result.checks.push(
    "Confirmed discard returns to workout; subsequent Back works and no imperative root remains"
  );
  await context.close();
  const desktop = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    serviceWorkers: "block",
  });
  page = await desktop.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") result.errors.push(e.text());
  });
  await page.goto(origin + "/calendar", { waitUntil: "networkidle" });
  await page.locator("[data-workout-id]").filter({ hasText: "Editable run workout" }).click();
  const remove = page.getByRole("dialog").getByRole("button", { name: "Delete", exact: true });
  await remove.click();
  const deletion = page.getByRole("alertdialog", { name: "Delete workout", exact: true });
  await deletion.waitFor();
  assert.equal(
    await deletion.getByRole("button", { name: "Delete workout", exact: true }).count(),
    1
  );
  await deletion.getByRole("button", { name: "Cancel", exact: true }).click();
  await deletion.waitFor({ state: "detached" });
  await page.getByLabel("Planned duration", { exact: true }).fill("0:23:00");
  assert.equal(await page.getByLabel("Planned duration", { exact: true }).inputValue(), "0:23:00");
  result.checks.push(
    "Desktop Delete uses same action-specific confirmation; cancel leaves underlying details interactive"
  );
  await page.screenshot({ path: "artifacts/premium-app/confirmation-desktop-return.png" });
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.failure = error.message;
  if (page) {
    await fs.mkdir("artifacts/premium-app", { recursive: true });
    await page.screenshot({ path: "artifacts/premium-app/confirmation-failure.png" });
    result.failureBody = await page.locator("body").innerText();
  }
  throw error;
} finally {
  await fs.mkdir("artifacts/premium-app", { recursive: true });
  await fs.writeFile(
    "artifacts/premium-app/confirmation.json",
    JSON.stringify(result, null, 2) + "\n"
  );
  console.log(JSON.stringify(result, null, 2));
  await browser?.close();
  server.kill();
}
