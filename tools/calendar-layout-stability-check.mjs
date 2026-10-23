// Production UI, isolated synthetic fixtures, no live account or provider data.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const port = Number(process.env.CALENDAR_LAYOUT_PORT || 5277);
const origin = `http://127.0.0.1:${port}`;
const phase = process.env.CALENDAR_LAYOUT_PHASE || "before";
const samples = Number(process.env.CALENDAR_LAYOUT_SAMPLES || 3);
const output = path.resolve("artifacts/premium-app/calendar-layout", phase);
const server = spawn(process.execPath, ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`, ...(process.env.CALENDAR_LAYOUT_DIST ? [`--dist=${process.env.CALENDAR_LAYOUT_DIST}`] : [])], { stdio: ["ignore", "pipe", "pipe"] });
let browser;
const result = { phase, viewport: { width: 1440, height: 844 }, cpu: "unthrottled", network: "loopback, no throttle", sampleCount: samples, methodology: "Chromium layout-shift entries excluding hadRecentInput; CLS is largest session window with <1s between entries and <5s total; capture through 1500ms after networkidle. New browser context for each sample; warm Home in same context before calendar document navigation; reduced motion. Lab synthetic data, not field CWV.", runs: [] };
try {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve, reject) => { server.stdout.once("data", resolve); server.once("error", reject); server.once("exit", code => reject(Error(`Preview exited ${code}`))); });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  result.browser = browser.version();
  for (let sample = 0; sample < samples; sample++) {
    const context = await browser.newContext({ viewport: result.viewport, reducedMotion: "reduce" });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(() => {
      const label = node => node instanceof Element ? `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ""}.${String(node.className).replaceAll(" ", ".").slice(0, 180)}` : null;
      window.__calendarLayout = { shifts: [], scrolls: [], mounts: [] };
      addEventListener("scroll", () => window.__calendarLayout.scrolls.push({ time: performance.now(), y: scrollY }), { passive: true });
      new MutationObserver(records => {
        for (const record of records) if (record.target instanceof Element && record.target.hasAttribute("data-calendar-week")) window.__calendarLayout.mounts.push({ time: performance.now(), week: record.target.getAttribute("data-calendar-week"), mounted: record.target.getAttribute("data-calendar-mounted") });
      }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-calendar-mounted"] });
      new PerformanceObserver(list => {
        for (const entry of list.getEntries()) window.__calendarLayout.shifts.push({ time: entry.startTime, value: entry.value, hadRecentInput: entry.hadRecentInput, scrollY, sources: entry.sources.map(source => ({ node: label(source.node), week: source.node?.closest?.("[data-calendar-week]")?.getAttribute("data-calendar-week"), previousRect: source.previousRect.toJSON(), currentRect: source.currentRect.toJSON() })) });
      }).observe({ type: "layout-shift", buffered: true });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/?benchmark=1`, { waitUntil: "networkidle" });
    await page.goto(`${origin}/calendar?benchmark=1`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const data = await page.evaluate(() => ({ ...window.__calendarLayout, scrollY, weeks: [...document.querySelectorAll("[data-calendar-week]")].map(element => ({ week: element.getAttribute("data-calendar-week"), mounted: element.getAttribute("data-calendar-mounted"), top: element.getBoundingClientRect().top, height: element.getBoundingClientRect().height })), documentWidth: document.documentElement.scrollWidth }));
    let first = 0, last = 0, session = 0, cls = 0;
    for (const shift of data.shifts.filter(entry => !entry.hadRecentInput)) {
      if (session && shift.time - last < 1000 && shift.time - first < 5000) session += shift.value;
      else { session = shift.value; first = shift.time; }
      last = shift.time;
      cls = Math.max(cls, session);
    }
    result.runs.push({ sample, cls, ...data, errors });
    assert.deepEqual(errors, []);
    assert.ok(data.documentWidth <= result.viewport.width);
    if (phase === "after") assert.ok(cls <= 0.1, `Desktop calendar CLS ${cls} exceeds 0.1`);
    if (sample === 0) await page.screenshot({ path: path.join(output, "calendar.png") });
    console.log(JSON.stringify({ sample, cls, shifts: data.shifts.length, scrollY: data.scrollY, errors }));
    await context.close();
  }
} finally {
  await fs.writeFile(path.join(output, "trace.json"), JSON.stringify(result, null, 2));
  await browser?.close();
  server.kill();
}
