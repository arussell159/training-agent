// Browser regression coverage against the disposable desktop preview.
// Start: node tools/desktop-preview.mjs --calendar-edits --port=5196
// Run after building: node tools/workout-parity-check.mjs
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
  playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
}
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5196";
if (!["127.0.0.1", "localhost"].includes(new URL(origin).hostname)) throw new Error("Use the disposable local preview only.");
const output = path.resolve("artifacts/workout-parity");
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.APP_TEST_BROWSER || "msedge" });
const context = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: "light" });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const errors = [];
const writes = [];
page.on("pageerror", error => errors.push(error.message));
page.on("request", request => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) {
    writes.push({ method: request.method(), url: request.url() });
  }
});
const results = [];
const title = `Workout parity ${Date.now()}`;
const longDescription = Array.from({ length: 16 }, (_, i) => `SET ${i + 1} — UPPER BODY + TRUNK\n35 minutes including warm-up, rests and transitions. Keep the effort controlled and record how every exercise feels.\nSource: STRENGTH_WORKOUT_REFERENCE.md version 1.0.0.\n`).join("\n");
const providerPuts = entries => entries.filter(item => item.method === "PUT" && /\/(editor|planned-values)(?:$|[?&])/.test(decodeURIComponent(item.url)));
const apiPath = url => new URL(url).searchParams.get("__api_route") || new URL(url).pathname;
async function waitValue(locator, expected) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await locator.inputValue() === expected) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(await locator.inputValue(), expected);
}
async function downloadedText(download) {
  assert.equal(await download.failure(), null);
  return fs.readFile(await download.path(), "utf8");
}
async function clickCalendarPlus(targetPage, addLabel) {
  const plus = targetPage.getByRole("button", { name: addLabel, exact: true });
  await plus.evaluate(node => node.scrollIntoView({ block: "center", inline: "nearest" }));
  const box = await plus.boundingBox();
  assert.ok(box, "Calendar plus is rendered");
  // Desktop reveals the plus when its day is hovered. Move into the day before
  // testing the real click; do not bypass its pointer-events with a forced click.
  await targetPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await targetPage.waitForFunction(label => {
    const node = [...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === label);
    return node && getComputedStyle(node).pointerEvents !== "none";
  }, addLabel);
  await plus.click();
}
async function calendarEntryChecks(dayKey, addLabel) {
  for (const [width, height] of [[1280,820],[768,820],[390,844]]) {
    const checkContext = await browser.newContext({ viewport: { width, height }, colorScheme: "light" });
    const check = await checkContext.newPage();
    check.setDefaultTimeout(10000);
    check.on("pageerror", error => errors.push(error.message));
    await check.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
    const cell = check.locator(`.calendar-day-cell[data-calendar-date="${dayKey}"]`);
    await cell.scrollIntoViewIfNeeded();
    for (const selector of [".calendar-day-cell", ".calendar-day-workouts"]) {
      const target = selector === ".calendar-day-cell" ? cell
        : check.locator(".calendar-day-cell[data-calendar-today='true']");
      await target.scrollIntoViewIfNeeded();
      const point = await target.evaluate((root, selector) => {
        const node = selector === ".calendar-day-cell" ? root : root.querySelector(selector);
        const box = node.getBoundingClientRect();
        const plus = root.querySelector(".calendar-day-add-workout")?.getBoundingClientRect();
        for (let y = Math.max(1, box.top + 2); y < Math.min(innerHeight - 1, box.bottom - 2); y += 3)
          for (let x = Math.max(1, box.left + 2); x < Math.min(innerWidth - 1, box.right - 2); x += 3)
            if (!(plus && x >= plus.left && x <= plus.right && y >= plus.top && y <= plus.bottom)
                && document.elementFromPoint(x, y) === node) return { x, y };
        return null;
      }, selector);
      assert.ok(point, `${width}: no visible blank area found in ${selector}`);
      await check.mouse.click(point.x, point.y);
      await check.waitForTimeout(120);
      assert.equal(await check.getByRole("dialog").count(), 0, `${width}: a blank calendar click opened a dialog`);
    }
    await clickCalendarPlus(check, addLabel);
    if (width >= 768)
      await check.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).waitFor({ state: "visible" });
    else await check.locator(".we-dialog").waitFor({ state: "visible" });
    await check.screenshot({ path: path.join(output, `plus-entry-${width}.png`), animations: "disabled" });
    results.push({ name: `plus-only-entry-${width}`, blankCellInert: true, workoutSpacingInert: true, plusOpened: true });
    await checkContext.close();
  }
}
async function openEditor() {
  await page.getByRole("button", { name: "Workout actions", exact: true }).click();
  await page.locator(".desktop-workout-toolbar-popover").getByRole("button", { name: /Edit workout/i }).click();
}

async function screenshot(name) {
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" });
}
async function geometry(name) {
  const value = await page.locator('.desktop-workout-preview, .we-tp-desktop').last().evaluate(root => {
    const box = root.getBoundingClientRect();
    return {
      width: box.width, height: box.height,
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      descendants: [...root.querySelectorAll("*")].filter(node => {
        const style = getComputedStyle(node), rect = node.getBoundingClientRect();
        return style.display !== "none" && rect.width > 0 && (rect.right > box.right + 1 || rect.left < box.left - 1);
      }).map(node => ({ tag: node.tagName, class: node.className, label: node.getAttribute("aria-label") })).slice(0, 20),
      description: (() => {
        const node = root.querySelector('textarea[aria-label="Workout description"]');
        return node && { scrollWidth: node.scrollWidth, clientWidth: node.clientWidth, scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
      })(),
      overview: (() => {
        const overview = root.querySelector(".dtb-overview");
        if (!overview) return null;
        const rect = overview.getBoundingClientRect();
        const totals = [...overview.querySelectorAll("strong")].map(node => {
          const bounds = node.getBoundingClientRect();
          return { text: node.textContent, right: bounds.right, top: bounds.top };
        });
        const upload = [...root.querySelectorAll(".dtb-view-actions button")].find(node => node.textContent.includes("Upload"));
        return { right: rect.right, totals, upload: upload && { color: getComputedStyle(upload).color, background: getComputedStyle(upload).backgroundColor } };
      })(),
    };
  });
  results.push({ name, ...value });
  assert.ok(value.horizontalOverflow <= 1, `${name}: dialog horizontally overflows by ${value.horizontalOverflow}px`);
  assert.ok(value.descendants.length === 0, `${name}: elements escape dialog: ${JSON.stringify(value.descendants)}`);
  if (value.description) {
    assert.ok(value.description.scrollWidth <= value.description.clientWidth + 1, `${name}: description scrolls sideways`);
    assert.ok(value.description.scrollHeight <= value.description.clientHeight + 2, `${name}: description has internal scrolling`);
  }
  if (value.overview) {
    assert.ok(value.overview.totals.every(total => total.right <= value.overview.right - 33), `${name}: totals collide with export icon`);
    assert.notEqual(value.overview.upload.color, value.overview.upload.background, `${name}: Upload text invisible`);
    if (name.endsWith("-768")) assert.ok(value.overview.totals.at(-1).top > value.overview.totals[0].top, "Narrow summary should wrap TSS");
  }
}
async function timelineGeometry(name) {
  const ticks = await page.locator(".we-tp-desktop .we-chart-ticks").evaluate(root => {
    const plot = root.closest(".dtb-chart-scroll").getBoundingClientRect();
    const labels = [...root.querySelectorAll("span")].map(node => {
      const rect = node.getBoundingClientRect();
      return { text: node.textContent, left: rect.left, right: rect.right };
    });
    return { left: plot.left, right: plot.right, labels };
  });
  for (let i = 0; i < ticks.labels.length; i++) {
    const label = ticks.labels[i];
    assert.ok(label.left >= ticks.left - 1 && label.right <= ticks.right + 1, `${name}: timeline label outside plot: ${JSON.stringify(label)}`);
    if (i) assert.ok(label.left > ticks.labels[i - 1].right, `${name}: timeline labels overlap`);
  }
  results.push({ name: `${name}-timeline`, ...ticks });
}
try {
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true, "Synthetic preview guard required");
  const day = new Date();
  day.setDate(day.getDate() + 3);
  const dayKey = day.toLocaleDateString("en-CA");
  const addLabel = `Add workout for ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  await calendarEntryChecks(dayKey, addLabel);
  await clickCalendarPlus(page, addLabel);
  if (process.argv.includes("--inspect")) {
    console.log(await page.getByRole("dialog").innerText());
    await screenshot("inspect");
  } else {
    await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
    await screenshot("create-blank");
    await page.getByLabel("Workout title", { exact: true }).fill(title);
    await page.getByLabel("Planned duration", { exact: true }).fill("0:35:00");
    await page.getByRole("textbox", { name: "Private Notes", exact: true }).fill("Private parity note");
    await page.getByLabel("Workout equipment", { exact: true }).fill("Parity running shoes");
    await page.getByRole("button", { name: "Add tag", exact: true }).click();
    await page.getByRole("textbox", { name: "New tag", exact: true }).fill("parity");
    await page.getByRole("textbox", { name: "New tag", exact: true }).press("Enter");
    await page.getByRole("textbox", { name: "Workout description", exact: true }).fill(longDescription);
    const draftAttachments = ["create-draft.txt", "builder-draft.txt"];
    await page.locator('.desktop-workout-attachments input[type="file"]').setInputFiles({
      name: draftAttachments[0], mimeType: "text/plain", buffer: Buffer.from("Attachment added before opening the builder."),
    });
    await page.getByRole("button", { name: `Remove attachment ${draftAttachments[0]}`, exact: true }).waitFor({ state: "visible" });
    for (const [width, height] of [[1280,820],[1024,768],[768,820]]) {
      await page.setViewportSize({ width, height });
      await page.getByRole("button", { name: "Description", exact: true }).click();
      await page.locator(".desktop-workout-dialog-body").evaluate(node => { node.scrollTop = 0; });
      await geometry(`create-${width}`);
      await screenshot(`create-${width}`);
    }
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.getByRole("button", { name: "Build Workout", exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Private Notes", exact: true }).inputValue(), "Private parity note");
    assert.equal(await page.getByLabel("Workout equipment", { exact: true }).inputValue(), "Parity running shoes");
    assert.equal(await page.getByRole("button", { name: "Remove tag parity", exact: true }).count(), 1);
    await page.getByRole("button", { name: `Remove attachment ${draftAttachments[0]}`, exact: true }).waitFor({ state: "visible" });
    await page.locator('.desktop-workout-attachments input[type="file"]').setInputFiles({
      name: draftAttachments[1], mimeType: "text/plain", buffer: Buffer.from("Attachment added inside the builder."),
    });
    await page.getByRole("button", { name: `Remove attachment ${draftAttachments[1]}`, exact: true }).waitFor({ state: "visible" });
    const continueSetup = page.getByRole("button", { name: "Continue", exact: true });
    if (await continueSetup.count()) await continueSetup.click();
    await page.getByRole("button", { name: "Add Two Step Repeats", exact: true }).click();
    await page.getByLabel("Repetitions", { exact: true }).last().fill("3");
    const step = page.locator(".dtb-step-card").filter({ has: page.getByLabel("Step title", { exact: true }) }).last();
    await step.getByLabel("Step title", { exact: true }).fill("Hard");
    await step.getByLabel("Interval type", { exact: true }).selectOption("active");
    await step.getByLabel("Target shape", { exact: true }).selectOption("range");
    await step.getByLabel("Range from", { exact: true }).fill("96.4");
    await step.getByLabel("Range to", { exact: true }).fill("115");
    await step.getByRole("button", { name: /Add cadence range/ }).click();
    await step.getByLabel("Minimum cadence", { exact: true }).fill("80");
    await step.getByLabel("Maximum cadence", { exact: true }).fill("95");
    await step.getByRole("switch").check();
    await step.getByLabel("Step notes", { exact: true }).fill("Controlled work interval");
    await page.locator('.we-profile-segment rect[role="button"]').last().hover();
    await page.locator(".we-profile-tooltip").waitFor({ state: "visible" });
    assert.match(await page.locator(".we-profile-tooltip").innerText(), /Hard/);
    await screenshot("builder-chart-hover");
    await page.getByLabel("Workout title", { exact: true }).hover();
    await page.locator(".we-profile-tooltip").waitFor({ state: "hidden" });
    for (const format of ["txt", "fit"]) {
      await page.getByRole("button", { name: "Export workout", exact: true }).click();
      const fileDialog = page.locator(".workout-file-dialog");
      await fileDialog.getByLabel("Workout export format").selectOption(format);
      const downloaded = page.waitForEvent("download");
      await fileDialog.getByRole("button", { name: "Download", exact: true }).click();
      const download = await downloaded;
      assert.equal(await download.failure(), null);
      const contents = await fs.readFile(await download.path());
      if (format === "txt") assert.match(contents.toString("utf8"), /Hard/);
      else assert.equal(contents.toString("ascii", 8, 12), ".FIT");
      results.push({ name: `export-${format}`, bytes: contents.length });
    }
    for (const [width, height] of [[1280,820],[1024,768],[768,820]]) {
      await page.setViewportSize({ width, height });
      await step.getByLabel("Step title", { exact: true }).scrollIntoViewIfNeeded();
      await geometry(`builder-${width}`);
      await timelineGeometry(`builder-${width}`);
      await screenshot(`builder-${width}`);
    }
    assert.equal(await page.getByText(/Distance steps without a convertible pace/).count(), 0, "Unknown-duration implementation warning must be absent");
    const personalFailure = async route => {
      if (route.request().method() === "PUT") return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic personal save failure" }) });
      return route.continue();
    };
    const draftPersonalRoute = url => /^workouts\/draft[^/]+\/personal$/.test(apiPath(url.href));
    await page.route(draftPersonalRoute, personalFailure);
    const beforeFailedSave = writes.length;
    await page.locator(".we-tp-desktop").getByRole("button", { name: "Save & Close", exact: true }).click();
    await page.getByText("Synthetic personal save failure", { exact: true }).first().waitFor({ state: "visible" });
    assert.equal(writes.slice(beforeFailedSave).filter(item => item.method === "POST" && apiPath(item.url) === "workouts/editor").length, 0);
    await page.unroute(draftPersonalRoute, personalFailure);
    const creationResponse = page.waitForResponse(response => response.request().method() === "POST" && apiPath(response.url()) === "workouts/editor");
    await page.locator(".desktop-workout-preview, .we-tp-desktop").last().getByRole("button", { name: "Save & Close", exact: true }).click();
    const created = await creationResponse;
    assert.equal(created.ok(), true);
    assert.notEqual(created.request().postDataJSON().reconcileOnly, true, "Pre-provider personal failure must permit first creation");
    results.push({ name: "pre-provider-personal-retry", createdOnce: true });
    await page.locator(".desktop-workout-preview, .we-tp-desktop").waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 1280, height: 820 });
    await page.getByText(title, { exact: true }).click();
    assert.equal(await page.getByRole("textbox", { name: "Workout description", exact: true }).inputValue(), longDescription);
    await waitValue(page.getByRole("textbox", { name: "Private Notes", exact: true }), "Private parity note");
    for (const filename of draftAttachments)
      await page.getByRole("button", { name: `Remove attachment ${filename}`, exact: true }).waitFor({ state: "visible" });
    results.push({ name: "create-builder-attachments-migrated", attachments: draftAttachments });
    assert.equal(await page.getByLabel("Workout equipment", { exact: true }).inputValue(), "Parity running shoes");
    assert.equal(await page.getByRole("button", { name: "Remove tag parity", exact: true }).count(), 1);
    await page.getByRole("button", { name: "Description", exact: true }).click();
    await geometry("saved-long-description");
    await screenshot("saved-long-description");
    const attachment = { name: "parity-notes.txt", mimeType: "text/plain", buffer: Buffer.from("Workout parity attachment\nPersisted across browser contexts.\n") };
    await page.locator('.desktop-workout-attachments input[type="file"]').setInputFiles(attachment);
    await page.getByRole("button", { name: `Remove attachment ${attachment.name}`, exact: true }).waitFor({ state: "visible" });
    const attachmentDownload = page.waitForEvent("download");
    await page.getByRole("button", { name: new RegExp(`^${attachment.name}`) }).click();
    assert.equal(await downloadedText(await attachmentDownload), attachment.buffer.toString());
    await page.getByRole("textbox", { name: "Private Notes", exact: true }).fill("Updated private parity note");
    const writesBefore = writes.length;
    await page.locator(".desktop-workout-preview").getByRole("button", { name: "Save & Close", exact: true }).click();
    await page.locator(".desktop-workout-preview").waitFor({ state: "hidden" });
    assert.equal(providerPuts(writes.slice(writesBefore)).length, 0, "Personal-only edit must not send a provider PUT");
    assert.equal(writes.slice(writesBefore).filter(item => item.method === "PUT" && apiPath(item.url).includes("/personal")).length, 1);
    const freshContext = await browser.newContext({ viewport: { width: 1280, height: 820 }, colorScheme: "light" });
    const fresh = await freshContext.newPage();
    await fresh.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
    await fresh.getByText(title, { exact: true }).click();
    await waitValue(fresh.getByRole("textbox", { name: "Private Notes", exact: true }), "Updated private parity note");
    assert.equal(await fresh.getByLabel("Workout equipment", { exact: true }).inputValue(), "Parity running shoes");
    assert.equal(await fresh.getByRole("button", { name: "Remove tag parity", exact: true }).count(), 1);
    await fresh.getByRole("button", { name: `Remove attachment ${attachment.name}`, exact: true }).waitFor({ state: "visible" });
    for (const filename of draftAttachments)
      await fresh.getByRole("button", { name: `Remove attachment ${filename}`, exact: true }).waitFor({ state: "visible" });
    await fresh.getByRole("textbox", { name: "Private Notes", exact: true }).scrollIntoViewIfNeeded();
    await fresh.screenshot({ path: path.join(output, "fresh-context-personal.png"), animations: "disabled" });
    await freshContext.close();
    results.push({ name: "fresh-context-personal", notes: true, tags: true, equipment: true, attachment: true });
    await page.getByText(title, { exact: true }).click();
    await waitValue(page.getByRole("textbox", { name: "Private Notes", exact: true }), "Updated private parity note");
    await openEditor();
    assert.equal(await page.locator(".dtb-draft-recovery").count(), 0, "Saved draft should not show a recovery banner");
    const savedStep = page.locator(".we-tp-desktop .dtb-step-card").filter({ has: page.getByRole("textbox", { name: "Step title", exact: true }) }).last();
    assert.equal(await savedStep.getByLabel("Step title", { exact: true }).inputValue(), "Hard");
    assert.equal(await savedStep.getByLabel("Interval type", { exact: true }).inputValue(), "active");
    assert.equal(await savedStep.getByLabel("Range from", { exact: true }).inputValue(), "96.4");
    assert.equal(await savedStep.getByLabel("Range to", { exact: true }).inputValue(), "115");
    assert.equal(await savedStep.getByLabel("Minimum cadence", { exact: true }).inputValue(), "80");
    assert.equal(await savedStep.getByLabel("Maximum cadence", { exact: true }).inputValue(), "95");
    assert.equal(await savedStep.getByRole("switch").isChecked(), true);
    assert.equal(await page.getByLabel("Repetitions", { exact: true }).inputValue(), "3");
    await page.locator(".we-tp-desktop").getByRole("textbox", { name: "Private Notes", exact: true }).fill("Builder private parity note");
    const builderWritesBefore = writes.length;
    await page.locator(".we-tp-desktop").getByRole("button", { name: "Save & Close", exact: true }).click();
    await page.locator(".desktop-workout-preview, .we-tp-desktop").waitFor({ state: "hidden" });
    assert.equal(providerPuts(writes.slice(builderWritesBefore)).length, 0, "Personal-only builder edit must not send a provider PUT");
    await page.getByText(title, { exact: true }).click();
    await waitValue(page.getByRole("textbox", { name: "Private Notes", exact: true }), "Builder private parity note");
    await openEditor();
    assert.equal(await page.locator(".dtb-draft-recovery").count(), 0, "Personal-only save should clear draft recovery");
    await page.getByLabel("Repetitions", { exact: true }).fill("4");
    const editResponse = page.waitForResponse(response => response.request().method() === "PUT" && decodeURIComponent(response.url()).includes("/editor"));
    await page.locator(".we-tp-desktop").getByRole("button", { name: "Save & Close", exact: true }).click();
    assert.equal((await editResponse).ok(), true, "Existing interval edit must be accepted");
    await page.locator(".desktop-workout-preview, .we-tp-desktop").waitFor({ state: "hidden" });
    await page.getByText(title, { exact: true }).click();
    await openEditor();
    assert.equal(await page.getByLabel("Repetitions", { exact: true }).inputValue(), "4");
    await page.getByRole("button", { name: "Close workout builder", exact: true }).click();
    await page.locator(".we-tp-desktop").waitFor({ state: "hidden" });
    await page.getByRole("button", { name: `Remove attachment ${attachment.name}`, exact: true }).click();
    await page.getByRole("button", { name: `Remove attachment ${attachment.name}`, exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Workout recurrence", exact: true }).click();
    const repeat = page.locator(".workout-recurrence-dialog");
    await repeat.getByRole("switch", { name: "Repeat this item" }).check();
    await repeat.getByLabel("Repeat frequency").selectOption("daily");
    await repeat.getByLabel("Repeat end condition").selectOption("count");
    await repeat.getByLabel("Repeat occurrences").fill("3");
    await screenshot("recurrence-settings");
    const recurrenceSaved = page.waitForResponse(response => response.request().method() === "PUT" && apiPath(response.url()).includes("/recurrence"));
    await repeat.getByRole("button", { name: "Done", exact: true }).click();
    const firstSeries = await (await recurrenceSaved).json();
    assert.equal(firstSeries.verified, true);
    assert.equal(firstSeries.series.occurrences.filter(item => item.state === "scheduled").length, 2);
    await repeat.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Workout recurrence", exact: true }).click();
    await waitValue(repeat.getByLabel("Repeat occurrences"), "3");
    await repeat.getByLabel("Repeat interval").fill("2");
    const recurrenceEdited = page.waitForResponse(response => response.request().method() === "PUT" && apiPath(response.url()).includes("/recurrence"));
    await repeat.getByRole("button", { name: "Done", exact: true }).click();
    const editedSeries = await (await recurrenceEdited).json();
    assert.equal(editedSeries.verified, true);
    assert.equal(editedSeries.series.rule.interval, 2);
    await repeat.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "Workout recurrence", exact: true }).click();
    await repeat.getByRole("switch", { name: "Repeat this item" }).uncheck();
    const recurrenceCancelled = page.waitForResponse(response => response.request().method() === "DELETE" && apiPath(response.url()).includes("/recurrence"));
    await repeat.getByRole("button", { name: "Done", exact: true }).click();
    const cancelled = await (await recurrenceCancelled).json();
    assert.equal(cancelled.verified, true);
    assert.equal(cancelled.series.status, "cancelled");
    await repeat.waitFor({ state: "hidden" });
    assert.equal(await page.getByRole("button", { name: "Workout recurrence", exact: true }).innerText(), "Does not repeat");
    results.push({ name: "recurrence-schedule-edit-cancel", initial: firstSeries.series, edited: editedSeries.series, cancelled: cancelled.series.status });
    await page.locator(".desktop-workout-preview").getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
    await page.locator(".desktop-workout-preview").waitFor({ state: "hidden" });
    await page.getByText(title, { exact: true }).waitFor({ state: "hidden" });
    await page.getByText("Editable swim workout", { exact: true }).click();
    await openEditor();
    const swimSteps = page.locator(".we-tp-desktop .dtb-step-card");
    await swimSteps.first().waitFor({ state: "visible" });
    const revertedTitle = `Temporary swim title ${Date.now()}`;
    const swimTitle = page.locator(".we-tp-desktop").getByLabel("Workout title", { exact: true });
    await swimTitle.fill(revertedTitle);
    await page.waitForFunction(title => Object.keys(localStorage).some(key => localStorage.getItem(key)?.includes(title)), revertedTitle);
    await swimTitle.fill("Editable swim workout");
    await page.getByRole("button", { name: "Close workout builder", exact: true }).click();
    await page.locator(".we-tp-desktop").waitFor({ state: "hidden" });
    await openEditor();
    await swimSteps.first().waitFor({ state: "visible" });
    assert.equal(await swimTitle.inputValue(), "Editable swim workout");
    assert.equal(await page.locator(".dtb-draft-recovery").count(), 0, "Reverting a title before closing must not leave stale draft recovery");
    results.push({ name: "reverted-title-no-stale-recovery", verified: true });
    const lapStates = await swimSteps.getByRole("switch").all();
    assert.ok((await Promise.all(lapStates.map(control => control.isChecked()))).filter(Boolean).length >= 2, "Provider until_lap_press must import both swim flags");
    const rest = swimSteps.filter({ has: page.locator('select[aria-label="Interval type"] option[value="rest"]:checked') }).first();
    await rest.getByLabel("Step duration", { exact: true }).fill("00:00:30");
    const swimSaved = page.waitForResponse(response => response.request().method() === "PUT" && apiPath(response.url()).endsWith("/editor"));
    await page.locator(".we-tp-desktop").getByRole("button", { name: "Save & Close", exact: true }).click();
    assert.equal((await swimSaved).ok(), true);
    await page.locator(".desktop-workout-preview, .we-tp-desktop").waitFor({ state: "hidden" });
    await page.getByText("Editable swim workout", { exact: true }).click();
    await openEditor();
    await swimSteps.first().waitFor({ state: "visible" });
    await waitValue(rest.getByLabel("Step duration", { exact: true }), "00:00:30");
    assert.ok((await Promise.all((await swimSteps.getByRole("switch").all()).map(control => control.isChecked()))).filter(Boolean).length >= 2);
    await screenshot("existing-swim-lap-save");
    await page.getByRole("button", { name: "Close workout builder", exact: true }).click();
    await page.locator(".desktop-workout-preview").getByRole("button", { name: "Cancel", exact: true }).click();
    results.push({ name: "existing-swim-provider-lap-edit", savedRestSeconds: 30, lapFlagsRetained: true });
    await clickCalendarPlus(page, addLabel);
    await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
    await page.getByLabel("Workout title", { exact: true }).fill(`${title} upload`);
    await page.getByLabel("Planned duration", { exact: true }).fill("0:10:00");
    await page.getByRole("button", { name: "Workout recurrence", exact: true }).click();
    await repeat.getByRole("switch", { name: "Repeat this item" }).check();
    await repeat.getByLabel("Repeat frequency").selectOption("daily");
    await repeat.getByLabel("Repeat end condition").selectOption("count");
    await repeat.getByLabel("Repeat occurrences").fill("2");
    await repeat.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Build Workout", exact: true }).click();
    const setup = page.getByRole("button", { name: "Continue", exact: true });
    await setup.click();
    assert.match(await page.getByRole("button", { name: "Workout recurrence", exact: true }).innerText(), /Daily/);
    await page.getByRole("button", { name: "Add Active", exact: true }).click();
    await page.locator('.desktop-workout-attachments input[type="file"]').setInputFiles({
      name: "attachment-only.txt", mimeType: "text/plain", buffer: Buffer.from("Only personal content is this attachment."),
    });
    await page.getByRole("button", { name: "Remove attachment attachment-only.txt", exact: true }).waitFor({ state: "visible" });
    const createdRecurrence = page.waitForResponse(response => response.request().method() === "PUT" && apiPath(response.url()).includes("/recurrence"));
    await page.locator(".we-tp-desktop").getByRole("button", { name: "Save & Close", exact: true }).click();
    assert.equal((await (await createdRecurrence).json()).verified, true);
    await page.locator(".desktop-workout-preview, .we-tp-desktop").waitFor({ state: "hidden" });
    await page.getByText(`${title} upload`, { exact: true }).first().click();
    await page.getByRole("button", { name: "Remove attachment attachment-only.txt", exact: true }).waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Workout recurrence", exact: true }).click();
    await waitValue(repeat.getByLabel("Repeat occurrences"), "2");
    await repeat.getByRole("switch", { name: "Repeat this item" }).uncheck();
    await repeat.getByRole("button", { name: "Done", exact: true }).click();
    await repeat.waitFor({ state: "hidden" });
    results.push({ name: "draft-recurrence-and-attachment-only-builder", verified: true });
    await page.getByRole("button", { name: "Upload", exact: true }).click();
    const uploadDialog = page.locator(".workout-file-dialog");
    await uploadDialog.getByLabel("Activity recording").setInputFiles({ name: "parity-recording.tcx", mimeType: "application/xml", buffer: Buffer.from(`<?xml version="1.0"?><TrainingCenterDatabase><Notes>${title}</Notes></TrainingCenterDatabase>`) });
    const uploaded = page.waitForResponse(response => response.request().method() === "POST" && apiPath(response.url()).includes("workout-files/upload"));
    await uploadDialog.getByRole("button", { name: "Upload", exact: true }).click();
    const uploadResponse = await uploaded;
    const uploadReceipt = await uploadResponse.json();
    assert.equal(uploadReceipt.verified, true);
    await uploadDialog.getByRole("status").filter({ hasText: "uploaded and verified" }).waitFor({ state: "visible" });
    const retryReceipt = await page.evaluate(async ({ url, body }) => {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });
      return response.json();
    }, { url: uploadResponse.url(), body: uploadResponse.request().postData() });
    assert.equal(retryReceipt.verified, true);
    assert.deepEqual(retryReceipt.activityIds, uploadReceipt.activityIds);
    await screenshot("upload-verified");
    results.push({ name: "upload-recording-idempotent", verified: true, activityIds: uploadReceipt.activityIds });
    assert.deepEqual(errors, [], `Browser errors: ${errors.join("; ")}`);
    console.log(JSON.stringify({ checks: results.map(item => item.name), errors, writeRequests: writes.length }, null, 2));
  }
} catch (error) {
  await screenshot("failure");
  console.error((await page.locator('[role="dialog"]').allInnerTexts()).join("\n").slice(0, 12000));
  throw error;
} finally {
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify({ results, errors, writes }, null, 2));
  await browser.close();
}
