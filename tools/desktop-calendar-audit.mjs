// Run on a fresh disposable desktop-preview instance, never a live account.
// APP_TEST_ORIGIN=http://127.0.0.1:5208 node tools/desktop-calendar-audit.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require("playwright");
} catch {
  playwright = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    )
  );
}
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5208";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = path.resolve("artifacts/desktop-calendar-audit");
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({
  viewport: { width: 1280, height: 820 },
  colorScheme: "light",
});
const page = await context.newPage();
page.setDefaultTimeout(12000);
const errors = [],
  checks = [],
  blocked = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.route("**/*", (route) => {
  if (new URL(route.request().url()).origin === origin) return route.continue();
  blocked.push(route.request().url());
  return route.abort();
});
const button = (name) => page.getByRole("button", { name, exact: true });
const dialog = () => page.locator('[data-slot="dialog-content"]');
const screenshot = (name) => page.screenshot({ path: path.join(output, `${name}.png`) });
async function fit(name) {
  // Viewport changes can occur during the popup's short CSS transition.
  await page.waitForFunction(() => {
    const node = document.querySelector('[data-slot="dialog-content"]');
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const analysis = node.classList.contains("desktop-workout-analysis-dialog");
    const full360 = node.classList.contains("desktop-workout-360-dialog");
    const width = analysis
      ? innerWidth - 40
      : full360
        ? innerWidth - 30
        : Math.min(700, innerWidth - 32);
    const height = analysis
      ? innerHeight - 60
      : full360
        ? innerHeight - 40
        : Math.min(innerHeight * 0.92, innerHeight - 52);
    return (
      rect.x >= -1 &&
      rect.y >= -1 &&
      rect.right <= innerWidth + 1 &&
      rect.bottom <= innerHeight + 1 &&
      Math.abs(rect.width - width) <= 1 &&
      Math.abs(rect.height - height) <= 1 &&
      Math.abs(rect.x + rect.width / 2 - innerWidth / 2) <= 10
    );
  });
  const geometry = await dialog().evaluate((node) => {
    const r = node.getBoundingClientRect(),
      footer = node.querySelector("footer,.desktop-workout-dialog-footer")?.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
      viewport: [innerWidth, innerHeight],
      footerBottom: footer?.bottom,
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
    };
  });
  assert.ok(
    geometry.x >= -1 &&
      geometry.y >= -1 &&
      geometry.right <= geometry.viewport[0] + 1 &&
      geometry.bottom <= geometry.viewport[1] + 1,
    `${name}: dialog outside viewport ${JSON.stringify(geometry)}`
  );
  assert.ok(geometry.footerBottom <= geometry.viewport[1] + 1, `${name}: footer is clipped`);
  assert.ok(geometry.documentOverflow <= 1, `${name}: horizontal document overflow`);
  checks.push({ name, geometry });
}
async function openRecording(title) {
  await page.getByRole("button", { name: new RegExp(`^${title} Duration`) }).press("Enter");
  await button("Analyze").click();
  await page.locator(".analysis-signal-svg").waitFor({ state: "visible" });
}
try {
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  await button("Today").click();
  await page.waitForFunction(() => {
    const day = document.querySelector('[data-calendar-today="true"]')?.getBoundingClientRect();
    const header = document.querySelector(".calendar-weekday-header")?.getBoundingClientRect();
    return day && header && Math.abs(day.top - header.bottom) < 3;
  });
  for (const name of [
    "Next calendar week",
    "Previous calendar week",
    "Previous calendar week",
    "Next calendar week",
    "Today",
  ])
    await button(name).click();
  await button("Collapse weekly summary").click();
  await button("Expand weekly summary").click();
  await button("Refresh Intervals.icu").click();
  checks.push({ name: "calendar-navigation-today-summary-refresh" });
  const today = new Date(),
    day = new Date(today);
  day.setDate(day.getDate() + 4);
  const dayLabel = `Add workout for ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  await page.waitForFunction(
    (label) =>
      [...document.querySelectorAll("button")].some(
        (node) => node.getAttribute("aria-label") === label && !node.disabled
      ),
    dayLabel
  );
  await button(dayLabel).press("Enter");
  await dialog().getByRole("button", { name: "Run", exact: true }).click();
  await page.waitForFunction(
    () => document.activeElement?.getAttribute("aria-label") === "Workout title"
  );
  const title = `Audit walk ${Date.now()}`;
  await page.getByLabel("Workout title", { exact: true }).fill(title);
  await page.getByLabel("Workout sport", { exact: true }).selectOption("Walk");
  await page.getByLabel("Planned duration", { exact: true }).fill("invalid");
  await button("Save").click();
  await page.getByRole("alert").waitFor({ state: "visible" });
  assert.equal(await page.getByLabel("Planned duration", { exact: true }).inputValue(), "invalid");
  const rejected = await (await page.request.get(`${origin}/api/preview/provider-records`)).json();
  assert.ok(!rejected.events.some((event) => event.name === title));
  checks.push({ name: "invalid-creation-retains-draft-and-makes-no-provider-event" });
  await page.getByLabel("Planned duration", { exact: true }).fill("0:20:00");
  await page.getByRole("alert").waitFor({ state: "hidden" });
  for (const [width, height] of [
    [1280, 820],
    [1024, 720],
    [768, 820],
  ]) {
    await page.setViewportSize({ width, height });
    await fit(`creator-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 820 });
  const appearance = await page.locator(".desktop-workout-preview").evaluate((node) => {
    const s = getComputedStyle(node);
    return {
      width: node.getBoundingClientRect().width,
      radius: s.borderRadius,
      shadow: s.boxShadow,
      lineHeight: s.lineHeight,
      color: s.color,
    };
  });
  assert.equal(appearance.width, 700);
  assert.equal(appearance.radius, "8px");
  assert.equal(appearance.shadow, "rgba(26, 32, 46, 0.3) 0px 16px 32px 0px");
  assert.equal(appearance.color, "rgb(26, 32, 46)");
  checks.push({ name: "measured-reference-dialog-styles", appearance });
  const unobstructed = await page.locator(".desktop-workout-save-close").evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return [rect.left + 3, rect.left + rect.width / 2, rect.right - 3].every((x) =>
      node.contains(document.elementFromPoint(x, rect.top + rect.height / 2))
    );
  });
  assert.equal(unobstructed, true, "Calendar status must not cover the save button");
  checks.push({ name: "calendar-status-does-not-cover-save-actions" });
  await screenshot("creator");
  await button("Save & Close").click();
  await dialog().waitFor({ state: "hidden" });
  await page.getByText(title, { exact: true }).click();
  assert.equal(await page.getByLabel("Planned duration", { exact: true }).inputValue(), "0:20:00");
  await button("Cancel").click();
  const provider = await (await page.request.get(`${origin}/api/preview/provider-records`)).json();
  const walk = provider.events.find((event) => event.name === title);
  assert.equal(walk.type, "Walk");
  assert.equal(walk.workout_doc.steps[0].duration, 1200);
  assert.equal(walk.workout_doc.steps[0].power, undefined);
  assert.doesNotMatch(
    walk.description,
    /Workout editor v1|training-agent-.*-v1|"version":|"duration_seconds":/
  );
  await fs.writeFile(path.join(output, "clean-provider-description.txt"), walk.description);
  checks.push({ name: "walk-create-provider-confirm-and-reopen" });

  for (const title of [
    "Aerobic run — recorded route and laps",
    "Threshold intervals — recorded power and route",
    "Completed swim — near target",
  ]) {
    await openRecording(title);
    const controls = await page.locator(".analysis-signal-controls button").all();
    for (const control of controls) {
      const before = await control.getAttribute("aria-pressed");
      await control.click();
      assert.notEqual(await control.getAttribute("aria-pressed"), before);
      await control.click();
      assert.equal(await control.getAttribute("aria-pressed"), before);
    }
    await button("Dist").click();
    await page.getByRole("button", { name: /^Lap 2 / }).click();
    await button("Zoom to selected range").click();
    assert.equal(await button("Unzoom to full workout").isEnabled(), true);
    await button("Unzoom to full workout").click();
    assert.equal(
      await page.getByRole("button", { name: /^Lap 2 / }).getAttribute("aria-pressed"),
      "true"
    );
    await button("Time").click();
    await page.getByRole("button", { name: /^Entire workout / }).click();
    const stats = page.getByRole("table", { name: /^Minimum, time-weighted/ });
    const originalStats = await stats.innerText();
    await page.getByRole("slider", { name: "Graph smoothing in seconds" }).press("End");
    assert.equal(
      await stats.innerText(),
      originalStats,
      "Smoothing cannot change recorded statistics"
    );
    await page.locator(".analysis-signal-svg").press("ArrowRight");
    await page.getByRole("button", { name: /^Peak (pace|power)$/ }).click();
    if (await button("Segments").count()) await button("Segments").click();
    else
      assert.equal(
        title,
        "Completed swim — near target",
        "Only the indoor swim fixture lacks route segments"
      );
    await button("Laps").click();
    for (const [width, height] of [
      [1280, 820],
      [1024, 720],
      [768, 820],
    ]) {
      await page.setViewportSize({ width, height });
      await fit(`${title.split(" ")[0]}-analysis-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 820 });
    await screenshot(`${title.split(" ")[0]}-analyze`);
    checks.push({
      name: `${title}: all signals, smoothing, cursor, units, laps, peaks, segments and zoom`,
    });
    if (title.startsWith("Threshold")) {
      await button("Analyze 360").click();
      await page.getByRole("tab", { name: "Power", exact: true }).click();
      await page
        .getByRole("tabpanel", { name: "Power", exact: true })
        .waitFor({ state: "visible" });
      assert.doesNotMatch(
        await page.getByRole("tabpanel", { name: "Power", exact: true }).innerText(),
        /No recorded power channel/
      );
      await page.getByRole("tab", { name: "Lap Comparison", exact: true }).click();
      const panel = page.getByRole("tabpanel", { name: "Lap Comparison", exact: true });
      await panel.getByRole("checkbox", { name: "Select Lap 1", exact: true }).check();
      await panel.getByRole("checkbox", { name: "Select Lap 2", exact: true }).check();
      await page
        .getByRole("region", { name: "Lap Compare", exact: true })
        .waitFor({ state: "visible" });
      await button("Library").click();
      for (const name of [
        "Single Channel Chart",
        "Multi-Channel Chart",
        "Stacked Channel Chart",
        "Time in Zones",
        "Aerobic Efficiency Multi-Channel Chart",
        "Force Profile Multi-Channel Chart",
        "Ride Profile Stacked Channel Chart",
      ]) {
        await button(name).click();
        assert.equal(
          await page
            .getByRole("tab", { name: "Analyze", exact: true })
            .getAttribute("aria-selected"),
          "true",
          "New charts must be visible when added from another tab"
        );
        await page.getByLabel("Tile Name", { exact: true }).fill(`Audit ${name}`);
        await button("Back to chart library").click();
      }
      await button("Close analysis side panel").click();
      const cardCount = await page.locator(".a360-tile").count();
      await page
        .getByRole("button", { name: "Remove Audit Single Channel Chart card", exact: true })
        .click();
      assert.equal(await page.locator(".a360-tile").count(), cardCount - 1);
      await button("Undo").click();
      assert.equal(await page.locator(".a360-tile").count(), cardCount);
      await button("Remove Map card").click();
      await button("Library").click();
      await button("Map").click();
      await button("Back to chart library").click();
      assert.equal(await button("Undo").isDisabled(), true, "Undo cannot duplicate a replacement Map card");
      assert.equal(await page.locator(".a360-tile").filter({ has: button("Remove Map card") }).count(), 1);
      await button("Close analysis side panel").click();
      checks.push({ name: "analyze360-replacement-map-prevents-invalid-singleton-undo" });
      await button("Toggle workout summary").click();
      await button("Toggle workout summary").click();
      for (const [width, height] of [
        [1280, 820],
        [1024, 720],
        [768, 820],
      ]) {
        await page.setViewportSize({ width, height });
        await fit(`analyze360-${width}`);
      }
      await screenshot("bike-analyze360");
      checks.push({
        name: "analyze360-power-lap-compare-all-supported-chart-presets-remove-undo-summary",
      });
      await page.setViewportSize({ width: 1280, height: 820 });
      await button("Library").click();
      while (await page.locator(".a360-tile").count() < 24) {
        await button("Single Channel Chart").click();
        await button("Back to chart library").click();
      }
      for (const name of ["Single Channel Chart", "Multi-Channel Chart", "Stacked Channel Chart", "Time in Zones", "Aerobic Efficiency Multi-Channel Chart", "Force Profile Multi-Channel Chart", "Ride Profile Stacked Channel Chart"])
        assert.equal(await button(name).isDisabled(), true, `${name} must respect the persistent workspace capacity`);
      await button("Close Analyze 360").click();
      await dialog().waitFor({ state: "hidden" });
      await openRecording(title);
      await button("Analyze 360").click();
      await page.waitForFunction(() => document.querySelectorAll(".a360-tile").length === 24);
      assert.equal(await page.locator(".a360-tile").count(), 24, "Reopening must preserve all 24 configured cards");
      checks.push({ name: "analyze360-card-limit-and-reopen-preserve-valid-layout" });
      await button("Close Analyze 360").click();
    } else await button("Close workout details").click();
    await dialog().waitFor({ state: "hidden" });
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, [], "No external calls are permitted in QA");
} catch (error) {
  await screenshot("failure");
  console.error((await page.getByRole("dialog").allInnerTexts()).join("\n").slice(-5000));
  throw error;
} finally {
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ checks, errors, blocked }, null, 2)
  );
  console.log(
    JSON.stringify({ checks: checks.map((check) => check.name), errors, blocked }, null, 2)
  );
  await browser.close();
}
