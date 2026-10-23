// Production UI and isolated synthetic fixture data. No live account writes.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { calendarDurationSummary, calendarDurationLabel } from "../ui/src/lib/desktop-calendar-summary.ts";
const require = createRequire(import.meta.url);
const engines = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const engine = process.env.SIDEBAR_ENGINE || "chromium";
const port = Number(process.env.SIDEBAR_PORT || 5271);
const origin = `http://127.0.0.1:${port}`;
const output = process.env.SIDEBAR_OUTPUT || `artifacts/premium-app/sidebar-compact-${engine}`;
const server = spawn(process.execPath, ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`, ...(process.env.SIDEBAR_DIST ? [`--dist=${process.env.SIDEBAR_DIST}`] : [])], { stdio: ["ignore", "pipe", "pipe"] });
let browser;
const evidence = { fixture: "synthetic, isolated, production UI", browsers: [], checks: [] };
try {
  await fs.mkdir(output, { recursive: true });
  await new Promise((resolve, reject) => { server.stdout.once("data", resolve); server.once("error", reject); server.once("exit", code => reject(Error(`Preview exited ${code}`))); });
  browser = await engines[engine].launch({ headless: true, ...(engine === "chromium" ? {channel: "msedge"} : {executablePath: process.env.SIDEBAR_EXECUTABLE}) });
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 820 }, { width: 1440, height: 900 }]) {
    const page = await browser.newPage({ viewport, colorScheme: "light" });
    const errors = [];
    let injectedActivityId;
    await page.route(url => url.pathname === '/api/training-context' || url.searchParams.get('__api_route') === 'training-context', async route => {
      const response = await route.fetch(), data = await response.json();
      const linked = [...(data.history || []), ...(data.planned || [])].find(row => row.id === 'event:9003' && row.activity_id);
      if (linked) {
        injectedActivityId = `activity:${linked.activity_id}`;
        data.history = [...data.history, {...linked, id: injectedActivityId, workout_summary: {...linked.workout_summary, planned: null}}];
      }
      await route.fulfill({response, json: data});
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const visibleStart = await page.locator(".calendar-week-summary[data-summary-start]").evaluateAll(elements => elements.find(element => { const bounds = element.getBoundingClientRect(); return bounds.top >= 0 && bounds.top < innerHeight && bounds.right <= innerWidth; })?.getAttribute("data-summary-start"));
    assert.ok(visibleStart, "The selected week has a visible sidebar");
    const summary = page.locator(`.calendar-week-summary[data-summary-start="${visibleStart}"]`);
    await summary.waitFor({ state: "visible" });
    assert.ok(injectedActivityId, "Fixture exercised a linked plan plus its raw recording alias");
    assert.equal(await page.locator(`.calendar-workout-card[data-workout-id="${injectedActivityId}"]`).count(), 0, "Linked raw recording does not create a duplicate calendar card");
    assert.equal(await page.locator('.calendar-workout-card[data-workout-id="event:9003"]').count(), 1);
    const start = await summary.getAttribute("data-summary-start");
    const end = new Date(Date.parse(`${start}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
    const response = await page.request.get(`${origin}/api/training-context?scope=full`);
    assert.ok(response.ok());
    const context = await response.json();
    const totals = calendarDurationSummary([...context.history, ...context.planned], { start, end });
    assert.deepEqual(await summary.locator("thead th").allTextContents(), ["Sport", "Planned", "Completed"]);
    const totalRows = await summary.locator(".calendar-summary-duration-totals td").allTextContents();
    assert.deepEqual(totalRows, [calendarDurationLabel(totals.planned), calendarDurationLabel(totals.completed)]);
    assert.equal(await summary.locator("tfoot td").nth(0).getAttribute("aria-label"), `Total planned: ${totalRows[0]}`);
    assert.equal(await summary.locator("tfoot td").nth(1).getAttribute("aria-label"), `Total completed: ${totalRows[1]}`);
    const sportRows = await summary.locator(".calendar-summary-sport-row").evaluateAll(rows => rows.map(row => Array.from(row.children, cell => cell.textContent)));
    assert.deepEqual(sportRows, totals.rows.map(row => [row.sport, calendarDurationLabel(row.planned), calendarDurationLabel(row.completed)]));
    const dimensions = await summary.evaluate(element => ({ width: element.clientWidth, height: element.getBoundingClientRect().height, durationHeight: element.querySelector('.calendar-summary-sports').getBoundingClientRect().height, scrollWidth: element.scrollWidth, documentWidth: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.ok(dimensions.scrollWidth <= dimensions.width + 1, JSON.stringify(dimensions));
    assert.ok(dimensions.documentWidth <= dimensions.viewport, JSON.stringify(dimensions));
    assert.ok(dimensions.height < 460, `Four-sport summary should stay compact: ${JSON.stringify(dimensions)}`);
    const rowBounds = await summary.locator("tbody tr").evaluateAll(rows => rows.map(row => row.getBoundingClientRect().height));
    assert.ok(rowBounds.every(height => height <= 30), `Each sport uses one row: ${rowBounds}`);
    const card = page.locator('.calendar-workout-card').filter({has: page.locator('.calendar-workout-options')}).first();
    if (engine === "chromium") {
      await card.hover();
      await page.waitForFunction(element => getComputedStyle(element).opacity === '1', await card.locator('.calendar-workout-options').elementHandle(), {timeout: 1500});
    }
    const railWidth = await page.locator('.desktop-navigation-shell').evaluate(element => element.getBoundingClientRect().width);
    assert.equal(railWidth, 64);
    assert.deepEqual(errors, []);
    await page.mouse.move(80, 25);
    await page.screenshot({ path: `${output}/${viewport.width}.png` });
    evidence.browsers.push({ browser: engine, viewport, start, end, rows: sportRows, totals: totalRows, dimensions, errors });
    await page.goto(`${origin}/workout-reports`, {waitUntil: "networkidle"});
    assert.equal(await page.locator('.desktop-navigation-shell').evaluate(element => element.getBoundingClientRect().width), railWidth, "Rail must not jump between Calendar and Reports");
    assert.deepEqual(errors, []);
    await page.close();
  }
  evidence.checks.push("Visible Planned/Completed column headers, one row per sport and labeled totals match the canonical aggregation.");
  evidence.checks.push("Injected same-day linked activity alias produces one card and unchanged totals.");
  evidence.checks.push("No root/sidebar horizontal overflow or app-owned console/page errors at 1024, 1280 and 1440px; stable 64px rail between Calendar and Reports.");
  await fs.writeFile(`${output}/evidence.json`, JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
