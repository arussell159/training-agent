// Run against the isolated navigation fixture after starting its Vite server.
// Synthetic API responses exercise late route success, empty GPS and failure.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5177";
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.APP_TEST_BROWSER || "msedge" });
const results = [];
const geometry = () => {
  const map = document.querySelector(".workout-mobile-map")?.getBoundingClientRect();
  const sheet = document.querySelector(".workout-mobile-sheet")?.getBoundingClientRect();
  return { mapHeight: map?.height, sheetTop: sheet?.top, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
};

try {
  for (const mode of ["ready", "empty", "error"]) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === origin && !url.pathname.startsWith("/api/") ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/tests/navigation.html`, { waitUntil: "networkidle" });
    await page.evaluate((mode) => {
      const fixtureFetch = window.fetch;
      window.fetch = async (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        const api = url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
        if (mode !== "ready" && api.includes("/route")) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          if (mode === "error") throw new Error("Route fixture offline");
          return Response.json({ points: [] });
        }
        const response = await fixtureFetch(input, init);
        if (mode !== "ready" && api.includes("/analysis")) {
          const data = await response.json();
          data.points = data.points.map(({ latitude, longitude, ...point }) => point);
          return Response.json(data);
        }
        return response;
      };
    }, mode);
    await page.locator('.mobile-dashboard-workout[aria-label="Open Completed run fixture"]').click();
    await page.locator(".workout-mobile-sheet").waitFor();
    await page.getByText("Loading activity map", { exact: true }).waitFor({ state: "attached" });
    const pending = await page.evaluate(geometry);
    const samples = [pending];
    for (let index = 0; index < 30; index++) {
      samples.push(await page.evaluate(geometry));
      await page.waitForTimeout(75);
    }
    assert.deepEqual(errors, [], `${mode}: ${errors}`);
    assert.ok(samples.every((sample) => sample.mapHeight > 0 && !sample.overflow), `${mode}: invalid map slot or horizontal overflow`);
    const mapSpread = Math.max(...samples.map((sample) => sample.mapHeight)) - Math.min(...samples.map((sample) => sample.mapHeight));
    const sheetSpread = Math.max(...samples.map((sample) => sample.sheetTop)) - Math.min(...samples.map((sample) => sample.sheetTop));
    assert.ok(mapSpread <= 1, `${mode}: map changed height by ${mapSpread}px`);
    assert.ok(sheetSpread <= 1, `${mode}: summary moved by ${sheetSpread}px`);
    if (mode === "empty") await page.getByText("No GPS route recorded.", { exact: true }).waitFor();
    if (mode === "error") await page.getByText("Map couldn’t load.", { exact: true }).waitFor();
    if (mode === "ready") await page.locator(".workout-mobile-map > .relative").waitFor();
    const settled = await page.evaluate(geometry);
    assert.deepEqual(settled, pending, `${mode}: settled map and summary geometry must match pending`);
    const output = path.resolve("artifacts/reliability");
    await fs.mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, `workout-${mode}-390.png`), fullPage: true });
    results.push({ mode, pending, settled, mapSpread, sheetSpread, errors });
    await context.close();
  }
  await fs.writeFile(path.resolve("artifacts/reliability/workout-layout-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
