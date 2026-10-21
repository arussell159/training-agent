// Measured component CSS only; preserved app chrome is outside this comparison.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5218";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const out = path.resolve("artifacts/trainingpeaks-parity");
await fs.mkdir(out, { recursive: true });
const reference = JSON.parse(await fs.readFile(path.join(out, "reference-calendar-toolbar-styles.json"), "utf8"));
const navigationReference = JSON.parse(await fs.readFile(path.join(out, "reference-calendar-month-navigation-styles.json"), "utf8"));
assert.equal(reference.button.text, "Today");
const browser = await playwright.chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, colorScheme: "light", locale: "en-US" });
const page = await context.newPage(), errors = [];
page.on("pageerror", error => errors.push(error.message));
await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
try {
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  await page.evaluate(() => document.fonts.ready);
  const local = await page.locator(".calendar-desktop-toolbar").evaluate(el => {
    const snap = e => {
      const s = getComputedStyle(e);
      return { rect: e.getBoundingClientRect().toJSON(), fontSize: s.fontSize, lineHeight: s.lineHeight, fontWeight: s.fontWeight, border: s.border, radius: s.borderRadius, padding: s.padding, bg: s.backgroundColor, color: s.color, shadow: s.boxShadow };
    };
    const buttons = [...el.querySelectorAll(".calendar-desktop-navigation > button")];
    return { toolbar: snap(el), month: snap(el.querySelector(".calendar-desktop-month-trigger")), today: snap(buttons[0]), previous: snap(buttons[1]), next: snap(buttons[2]) };
  });
  const differences = Object.fromEntries(["width", "height"].map(key => [key, local.today.rect[key] - reference.button.rect[key]]));
  await fs.writeFile(path.join(out, "paired-calendar-toolbar-geometry.json"), JSON.stringify({ reference, navigationReference, local, differences, errors, certificate: false, reason: "Measured toolbar components only. Reference capture is JPEG; no whole-image or overall parity score." }, null, 2));
  await page.screenshot({ path: path.join(out, "local-calendar-toolbar.png") });
  assert.deepEqual(errors, []);
  for (const [key, delta] of Object.entries(differences)) assert.ok(Math.abs(delta) <= 0.02, `Today ${key}: ${delta}px`);
  for (const key of ["border", "radius", "padding", "bg", "color", "shadow"]) assert.equal(local.today[key], reference.button[key], `Today ${key}`);
  assert.equal(local.today.fontSize, "12px");
  assert.equal(local.today.lineHeight, "16px");
  assert.equal(local.today.fontWeight, "400");
  // Raw reference source: calendarDatePicker width164, fullMonth width150,
  // date-navigation arrows32px square, toolbar56px tall.
  assert.equal(local.month.rect.width, navigationReference.picker.rect.width);
  assert.equal(local.month.rect.height, navigationReference.picker.rect.height);
  assert.equal(local.toolbar.rect.height, navigationReference.toolbar.rect.height);
  assert.equal(local.today.rect.x - local.month.rect.right, reference.button.rect.x - navigationReference.picker.rect.right);
  assert.equal(local.today.rect.y - local.toolbar.rect.y, reference.button.rect.y - navigationReference.toolbar.rect.y);
  for (const key of ["previous", "next"]) {
    const arrow = navigationReference.arrows[key === "previous" ? 0 : 1];
    assert.equal(local[key].rect.width, arrow.rect.width);
    assert.equal(local[key].rect.height, arrow.rect.height);
    assert.equal(local[key].radius, "6px");
  }
  console.log(JSON.stringify({ differences, local, errors, certificate: false }, null, 2));
} finally {
  await browser.close();
}
