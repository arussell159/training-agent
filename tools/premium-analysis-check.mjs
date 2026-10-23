// Geometry and selection checks against disposable production preview data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const engines = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const engine = process.env.ANALYSIS_ENGINE || "chromium";
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5198";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const output = `artifacts/premium-app/analysis-cleanup-${engine}`;
await fs.mkdir(output, { recursive: true });
const browser = await engines[engine].launch({ headless: true, ...(engine === "chromium" ? {channel: "msedge"} : {executablePath: process.env.ANALYSIS_EXECUTABLE}) });
const results = [];
try {
  for (const scenario of [
    {id: 9004, title: "Threshold intervals — recorded power and route"},
    {id: 9003, title: "Aerobic run — recorded route and laps"},
  ]) for (const width of [768, 1024, 1148, 1280, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 820 }, reducedMotion: "reduce" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/workout-reports?workout=event%3A${scenario.id}`, { waitUntil: "networkidle" });
    const popup = page.getByRole("dialog", { name: scenario.title, exact: true });
    await popup.waitFor();
    await page.locator(".analysis-inspector-primary").waitFor();
    await popup.getByRole("button", {name: "Close", exact: true}).waitFor();
    assert.equal(await popup.getByRole("button", {name: "Save & Close", exact: true}).isVisible(), false);
    const axisLabels = await popup.locator('.analysis-overlay-axes > div > div > span').evaluateAll(nodes => nodes.map(node => ({text: node.textContent, height: node.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(node).lineHeight), width: node.getBoundingClientRect().width, scrollWidth: node.scrollWidth})));
    for (const label of axisLabels) {
      assert.ok(label.height <= label.lineHeight + 1, `Axis label wraps at ${width}: ${JSON.stringify(label)}`);
      assert.ok(label.scrollWidth <= label.width + 1, `Axis label overflows at ${width}: ${JSON.stringify(label)}`);
    }
    const geometry = await page.locator(".analysis-inspector-primary").evaluate(element => {
      const bounds = node => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width }; };
      return { parent: bounds(element), values: [...element.querySelectorAll("dd")].map(node => ({ text: node.textContent, ...bounds(node) })), root: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    assert.equal(geometry.values.length, 3);
    assert.ok(geometry.root <= geometry.viewport, `Root overflow at ${width}`);
    for (const value of geometry.values) {
      assert.ok(value.x >= geometry.parent.x - 1 && value.right <= geometry.parent.right + 1, `Value outside inspector at ${width}: ${JSON.stringify(value)}`);
    }
    for (let i = 0; i < geometry.values.length; i++) for (let j = i + 1; j < geometry.values.length; j++) {
      const a = geometry.values[i], b = geometry.values[j];
      assert.ok(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y, `Overlapping values at ${width}`);
    }
    const lap = page.locator(".analysis-lap-list").getByRole("button", { name: /^Lap 1 / });
    await lap.click();
    assert.equal(await lap.getAttribute("aria-pressed"), "true");
    await page.locator(".analysis-statistics").getByRole("heading", { name: "Lap 1", exact: true }).waitFor();
    await page.locator(".analysis-lap-list").getByRole("button", { name: /^Entire workout / }).click();
    await page.locator(".analysis-statistics").getByRole("heading", { name: "Entire Workout", exact: true }).waitFor();
    const axis = page.getByRole("button", { name: "Dist", exact: true });
    await axis.click();
    assert.equal(await axis.getAttribute("aria-pressed"), "true");
    await page.getByRole("button", { name: "Time", exact: true }).click();
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${output}/${scenario.id}-${width}.png` });
    results.push({ workout: scenario.id, width, geometry, axisLabels, errors, lapSelection: true, distanceAxis: true });
    await context.close();
  }
  await fs.writeFile(`${output}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ checks: results.length, errors: [] }));
} finally {
  await browser.close();
}
