// Exercise textarea fitting when the report popup reveals its Summary tab.
// This uses disposable preview data and never saves edits or calls providers.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {spawn} from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const require = createRequire(import.meta.url);
const playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const engine = process.env.RESIZE_ENGINE || "webkit";
const port = Number(process.env.RESIZE_PORT || 5432);
const origin = `http://127.0.0.1:${port}`;
const dist = process.env.RESIZE_DIST || "ui/dist";
const output = `artifacts/premium-app/description-resize-${engine}.json`;
const server = spawn(process.execPath, ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`, `--dist=${dist}`], {stdio: ["ignore", "pipe", "pipe"]});
const result = {engine, dist, checks: [], errors: []};
let browser;

try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", code => reject(Error(`Preview exited ${code}`)));
  });
  browser = await playwright[engine].launch({
    headless: true,
    ...(engine === "chromium" ? {channel: "msedge"} : {executablePath: process.env.RESIZE_EXECUTABLE || path.join(os.homedir(), "AppData/Local/ms-playwright/webkit-2359/Playwright.exe")}),
  });
  result.version = browser.version();
  const context = await browser.newContext({viewport: {width: 1280, height: 820}, reducedMotion: "reduce", serviceWorkers: "block"});
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.on("pageerror", error => result.errors.push(error.message));
  page.on("console", message => {if (message.type() === "error") result.errors.push(message.text());});
  await page.goto(`${origin}/workout-reports`, {waitUntil: "networkidle"});
  const title = "Threshold intervals — recorded power and route";
  await page.locator('[aria-label="Workout report table"]').getByRole("link", {name: new RegExp(title)}).click();
  const popup = page.getByRole("dialog", {name: title, exact: true});
  await popup.locator(".analysis-inspector-primary").waitFor();
  const input = popup.getByRole("textbox", {name: "Workout description", exact: true});
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  const checkFit = async (name) => {
    await settle();
    const fit = await input.evaluate(node => ({
      clientHeight: node.clientHeight,
      scrollHeight: node.scrollHeight,
      width: node.getBoundingClientRect().width,
      inlineHeight: node.style.height,
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
    }));
    assert.ok(fit.width > 100, `${name}: visible description has usable width`);
    assert.ok(fit.clientHeight >= fit.scrollHeight - 1, `${name}: textarea contains its text without an inner scrollbar: ${JSON.stringify(fit)}`);
    assert.ok(fit.pageOverflow <= 1, `${name}: no root horizontal overflow`);
    assert.deepEqual(result.errors, [], `${name}: no console errors or page errors`);
    result.checks.push({name, ...fit});
    return fit;
  };
  for (const width of [1280, 1024, 1440]) {
    await page.setViewportSize({width, height: 820});
    for (let pass = 0; pass < 3; pass++) {
      await popup.getByRole("button", {name: "Summary", exact: true}).click();
      await input.waitFor();
      await checkFit(`Reveal Summary at ${width}, pass ${pass + 1}`);
      await popup.getByRole("button", {name: "Analyze", exact: true}).click();
      await popup.locator(".analysis-inspector-primary").waitFor();
    }
  }
  await popup.getByRole("button", {name: "Summary", exact: true}).click();
  await input.fill("Short disposable draft");
  const short = await checkFit("Short draft fits immediately");
  await input.fill(Array.from({length: 12}, (_, index) => `Disposable line ${index + 1}: keep the workout description readable as the dialog changes width.`).join("\n"));
  const long = await checkFit("Long draft expands the textarea");
  assert.ok(long.clientHeight > short.clientHeight * 2, "Long draft must expand, not clip");
  await page.setViewportSize({width: 1024, height: 820});
  await checkFit("Long draft still fits after narrowing the viewport");
  await input.fill("Short again");
  const shrunk = await checkFit("Shortening the draft shrinks the textarea");
  assert.ok(shrunk.clientHeight < long.clientHeight, "Removing lines releases vertical space");
  result.passed = true;
} catch (error) {
  result.passed = false;
  result.failure = String(error.stack || error);
  process.exitCode = 1;
} finally {
  await fs.writeFile(output, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await browser?.close();
  server.kill();
}
