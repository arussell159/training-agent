// Actual shared React components, isolated from backend/provider writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const port = Number(process.env.INTERACTION_TEST_PORT || 5391), origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: path.resolve("ui"), stdio: ["ignore", "pipe", "pipe"] });
let browser;
const results = [];
try {
  await new Promise((resolve, reject) => {
    let output = "";
    server.stdout.on("data", chunk => { output += chunk; if (output.includes("Local:")) resolve(); });
    server.stderr.on("data", chunk => { output += chunk; });
    server.on("exit", code => reject(Error(`Harness server exited ${code}: ${output}`)));
    server.on("error", reject);
  });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", route => {
      const url = new URL(route.request().url());
      return url.origin === origin && !url.pathname.startsWith("/api/") ? route.continue() : route.abort();
    });
    await page.goto(`${origin}/tests/interaction-feedback.html`, { waitUntil: "networkidle" });
    const button = page.getByRole("button", { name: "Show notice" });
    const before = await button.boundingBox();
    await button.dispatchEvent("pointerdown", { pointerId: 1, isPrimary: true, button: 0, clientX: before.x + 5, clientY: before.y + 5 });
    const pressed = await button.evaluate(element => ({ marked: element.hasAttribute("data-app-pressed"), scale: getComputedStyle(element).scale, transform: getComputedStyle(element).transform }));
    assert.equal(pressed.marked, true);
    assert.ok(pressed.scale === "none" || pressed.scale === "1");
    assert.equal(pressed.transform, "none");
    assert.deepEqual(await button.boundingBox(), before, "press must not move its target");
    await button.dispatchEvent("pointerup", { pointerId: 1 });
    assert.equal(await button.evaluate(element => element.hasAttribute("data-app-pressed")), false);
    await button.click();
    await page.getByText("Immediate confirmation", { exact: true }).waitFor();
    await button.click();
    assert.equal(await page.locator(".app-toast").count(), 1);
    const styles = await page.evaluate(() => ({ pageAnimation: getComputedStyle(document.querySelector("main")).animationName, toastTransform: getComputedStyle(document.querySelector(".app-toast")).transform, probe: window.interactionProbe }));
    assert.equal(styles.pageAnimation, "none");
    assert.equal(styles.toastTransform, "none");
    assert.equal(styles.probe.renders, 1, "toast updates must not rerender command consumers");
    assert.equal(styles.probe.subscriptions, 1, "toast commands must keep stable effect dependencies");
    await page.getByRole("button", { name: "Dismiss notification" }).click();
    await page.locator(".app-toast").waitFor({ state: "detached" });
    for (const state of ["pending", "queued", "success", "success"]) {
      await page.evaluate(state => window.dispatchEvent(new CustomEvent("training-write-feedback", { detail: { operation: "isolated-test-operation", workoutId: "event:test-only", state, title: state === "success" ? "Saved test workout" : "Saving test workout" } })), state);
    }
    await page.getByText("Saved test workout", { exact: true }).waitFor();
    assert.equal(await page.locator(".app-toast").count(), 1, "queued/completed/repeated events must update one notification");
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("training-write-feedback", { detail: { operation: "isolated-test-operation", workoutId: "event:test-only", state: "error", title: "Test save needs attention", error: "Controlled failure" } })));
    await page.getByText("Test save needs attention", { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    results.push({ reducedMotion, pressed, ...styles, toastCount: await page.locator(".app-toast").count(), errors });
    await context.close();
  }
  await fs.mkdir("artifacts/mobile-interaction", { recursive: true });
  await fs.writeFile("artifacts/mobile-interaction/shared-feedback.json", JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
