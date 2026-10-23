// Exercises first-use lazy controls on disposable production-preview data.
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
const port = 5402,
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let browser;
const result = { checks: [], errors: [] };
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
  const page = await context.newPage();
  page.on("pageerror", (e) => result.errors.push(e.message));
  page.on("console", (e) => {
    if (e.type() === "error") result.errors.push(e.text());
  });
  const requests = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto(origin + "/calendar", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Open Editable run workout", exact: true }).waitFor();
  assert.ok(
    !requests.some((u) => u.includes("framework7-core")),
    "Calendar must not load Framework7 before a control needs it"
  );
  result.checks.push("Populated calendar loads without the Framework7 runtime");
  await page.route("**/framework7-core-*.js", async (route) => {
    await new Promise((r) => setTimeout(r, 600));
    await route.continue();
  });
  const trigger = page.getByRole("button", { name: "Jump to calendar date", exact: true });
  await trigger.click();
  await page.getByText("Loading calendar…", { exact: true }).waitFor();
  assert.equal(await page.getByLabel("Calendar month", { exact: true }).isDisabled(), true);
  await trigger.click();
  await page.locator(".mobile-calendar-picker-layer").waitFor({ state: "detached" });
  await page.waitForTimeout(700);
  assert.equal(await page.locator(".calendar-jump-inline").count(), 0);
  result.checks.push("Closing during first-use loading leaves no orphan date picker");
  await trigger.click();
  await page.locator(".calendar-jump-inline .calendar-day").first().waitFor();
  assert.equal(await page.getByLabel("Calendar month", { exact: true }).isEnabled(), true);
  const previous = await page.getByLabel("Calendar month", { exact: true }).inputValue();
  await page.getByRole("button", { name: "Next month", exact: true }).click();
  await page.waitForFunction(
    (old) => document.querySelector('select[aria-label="Calendar month"]').value !== old,
    previous
  );
  await trigger.click();
  await page.locator(".mobile-calendar-picker-layer").waitFor({ state: "detached" });
  result.checks.push("Reopening initializes one picker with working month controls");
  // A real scroll releases the calendar's initial today anchor before we inspect
  // another day's workout; programmatic scroll alone intentionally does not.
  await page.mouse.wheel(0, 100);
  const runCard = page.getByRole("button", { name: "Open Editable run workout", exact: true });
  await runCard.scrollIntoViewIfNeeded();
  const centerIncludesPreview = await runCard.evaluate(node => {
    const cardBounds = node.getBoundingClientRect();
    const previewBounds = node.querySelector("[data-workout-profile]").getBoundingClientRect();
    const centerY=cardBounds.y+cardBounds.height/2;
    return centerY >= previewBounds.y && centerY <= previewBounds.bottom;
  });
  assert.ok(centerIncludesPreview,"Card-center tap must exercise the chart preview");
  await runCard.tap();
  await page.getByRole("button", { name: "Edit Editable run workout", exact: true }).waitFor();
  await page.goBack();
  await runCard.getByText("Editable run workout", { exact: true }).tap();
  await page.getByRole("button", { name: "Edit Editable run workout", exact: true }).waitFor();
  await page.goBack();
  result.checks.push("Mobile calendar chart-center and workout-title touch taps both open the intended details");

  await page.getByRole("button", { name: "Open Editable run workout", exact: true }).click();
  await page.getByRole("button", { name: "Edit Editable run workout", exact: true }).click();
  await page.getByLabel("Workout name", { exact: true }).waitFor();
  assert.equal(
    await page.getByLabel("Workout name", { exact: true }).inputValue(),
    "Editable run workout"
  );
  await page.getByRole("button", { name: "Cancel workout editing", exact: true }).click();
  await page.getByRole("button", { name: "Edit Editable run workout", exact: true }).waitFor();
  result.checks.push(
    "First mobile run editor opens with saved fields and cancels back to its workout"
  );
  await page.goBack();
  const completed = page.getByRole("button", { name: /^Open .+, completed$/ }).first();
  await completed.click();
  const detailsTrigger = page.getByRole("button", { name: "Workout Details", exact: true });
  await detailsTrigger.waitFor();
  const detailUrl = page.url();
  await detailsTrigger.click();
  const detailsSheet = page.getByRole("dialog", { name: "Workout Details", exact: true });
  await detailsSheet.waitFor();
  await page.waitForFunction(() => !document.querySelector(".detail-row-sheet")?.hasAttribute("data-starting-style"));
  await detailsSheet.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished)));
  const sheetBounds = await detailsSheet.boundingBox();
  result.actualSheetStyles = await detailsSheet.evaluate(node => {const style=getComputedStyle(node);return {transform:style.transform,translate:style.translate,top:style.top,left:style.left,bottom:style.bottom,inset:style.inset,html:node.outerHTML.slice(0,1200)};});
  assert.ok(sheetBounds.y >= 0 && sheetBounds.y + sheetBounds.height <= 845, JSON.stringify(sheetBounds));
  await page.goBack();
  await detailsSheet.waitFor({ state: "hidden" });
  assert.equal(page.url(), detailUrl, "Back dismisses only the completed details sheet");
  await detailsTrigger.click();
  await detailsSheet.waitFor();
  await page.keyboard.press("Escape");
  await detailsSheet.waitFor({ state: "hidden" });
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === "Workout Details");
  assert.equal(await page.evaluate(() => getComputedStyle(document.body).overflow === "hidden"), false);
  result.checks.push("Actual completed-workout sheet preserves underlying route, focus and scrolling after Back/Escape, including after Framework7 has loaded");
  await page.goto(origin + "/", { waitUntil: "networkidle" });
  const homeCard=page.locator(".home-session-tile").first();
  await homeCard.waitFor();
  const homeTitle=await homeCard.locator("h3").innerText();
  await homeCard.tap();
  await page.waitForURL(url=>url.searchParams.has("workout"));
  const homeDestination=page.url();
  await page.goBack();
  await homeCard.locator("h3").tap();
  await page.waitForURL(homeDestination);
  result.checks.push(`Actual mobile Home card center and title taps both open ${homeTitle}`);
  assert.deepEqual(result.errors, []);
  result.passed = true;
} finally {
  await fs.mkdir("artifacts/premium-app", { recursive: true });
  await fs.writeFile(
    "artifacts/premium-app/lazy-controls.json",
    JSON.stringify(result, null, 2) + "\n"
  );
  console.log(JSON.stringify(result, null, 2));
  await browser?.close();
  server.kill();
}
