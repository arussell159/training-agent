// Real mouse/native HTML5 drag coverage against the disposable local preview.
// Start: node tools/desktop-preview.mjs --calendar-edits --port=5197
// Run after building: node tools/workout-drag-check.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { browserNetworkEvidence } from "./browser-network-evidence.mjs";

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
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5197";
assert.ok(
  ["127.0.0.1", "localhost"].includes(new URL(origin).hostname),
  "Synthetic localhost preview only"
);
const output = path.resolve(process.env.APP_TEST_OUTPUT || "artifacts/workout-parity");
await fs.mkdir(output, { recursive: true });
const server =
  process.env.APP_START_PREVIEW === "1"
    ? spawn(
        process.execPath,
        ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${new URL(origin).port}`],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
      )
    : null;
if (server) {
  process.on("exit", () => server.kill());
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(Error("Preview startup timed out")), 10000);
    server.on("error", reject);
    server.stdout.on("data", (value) => {
      if (String(value).includes(origin)) {
        clearTimeout(deadline);
        resolve();
      }
    });
    server.stderr.on("data", (value) => {
      clearTimeout(deadline);
      reject(Error(String(value)));
    });
  });
}
const browser = await playwright.chromium.launch({
  headless: true,
  channel: process.env.APP_TEST_BROWSER || "msedge",
});
const context = await browser.newContext({
  viewport: { width: 1673, height: 741 },
  colorScheme: "light",
});
const page = await context.newPage();
const nativeDragDiagnostic = process.env.APP_DIAGNOSTIC_CANCEL_HTML_DRAG === "1";
const overflowDiagnostic = process.env.APP_DIAGNOSTIC_RESET_DRAG_OVERFLOW || "";
assert.ok(
  ["", "1", "display"].includes(overflowDiagnostic),
  "Overflow diagnostics accept1(clip) ordisplay; leave unset for acceptance"
);
const dragDiagnosticSession = nativeDragDiagnostic ? await context.newCDPSession(page) : null;
const network = browserNetworkEvidence();
network.attach(context);
page.setDefaultTimeout(10000);
const errors = [];
const checks = [];
let keyboardPaletteVerified = false;
const resetRepeats = Number(process.env.APP_DRAG_RESET_REPEATS || "1");
assert.ok(
  Number.isInteger(resetRepeats) && resetRepeats >= 1 && resetRepeats <= 10,
  "Use1–10 bounded reset cycles"
);
const scrollTrace = [];
await page.exposeFunction("__recordDragResetTrace", (entry) => scrollTrace.push(entry));
await page.addInitScript(() => {
  const scrolling = Object.getOwnPropertyDescriptor(Element.prototype, "scrollLeft");
  Object.defineProperty(Element.prototype, "scrollLeft", {
    ...scrolling,
    set(value) {
      if (window.__dragResetTraceActive && this.matches?.(".dtb-chart-scroll"))
        window.__recordDragResetTrace({
          at: performance.now(),
          cycle: window.__dragResetTraceActive,
          event: "script-scroll-write",
          value,
          stack: new Error().stack,
        });
      return scrolling.set.call(this, value);
    },
  });
  const snapshot = (event, phase) => {
    if (!window.__dragResetTraceActive) return;
    const viewport = document.querySelector(".dtb-chart-scroll"),
      target = event.target;
    if (!viewport) return;
    window.__recordDragResetTrace({
      at: performance.now(),
      cycle: window.__dragResetTraceActive,
      event: event.type,
      phase,
      key: event.key || null,
      target:
        target?.getAttribute?.("aria-label") ||
        target?.className?.baseVal ||
        target?.className ||
        null,
      x: event.clientX ?? null,
      y: event.clientY ?? null,
      scrollLeft: viewport.scrollLeft,
      clientWidth: viewport.clientWidth,
      scrollWidth: viewport.scrollWidth,
      plotWidth: viewport.querySelector("svg")?.getBoundingClientRect().width,
      feedback: Boolean(document.querySelector(".dtb-profile-drag-feedback")),
      marker: Boolean(document.querySelector(".dtb-profile-drop-marker")),
      visibility: document.visibilityState,
    });
  };
  for (const type of [
    "dragstart",
    "dragend",
    "dragover",
    "drop",
    "keydown",
    "pointerdown",
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "mousedown",
    "mouseup",
    "click",
    "scroll",
  ])
    document.addEventListener(
      type,
      (event) => {
        if (type === "scroll" && !event.target?.matches?.(".dtb-chart-scroll")) return;
        snapshot(event, "event");
        if (type === "click") requestAnimationFrame(() => snapshot(event, "next-animation-frame"));
      },
      true
    );
});
page.on("pageerror", (error) => errors.push(error.message));
const title = `Actual drag verification ${Date.now()}`;
const apiPath = (url) => new URL(url).searchParams.get("__api_route") || new URL(url).pathname;
const root = () => page.locator(".we-tp-desktop");
const details = () => root().locator(".dtb-details");
const cards = () => details().locator(".dtb-step-card");
const card = (label) =>
  cards().filter({
    has: page.locator(`input[aria-label="Step title"][value="${label}"]`),
  });
const profile = () => root().locator(".we-profile-segment rect[role='button']");
const feedback = () => root().locator(".dtb-profile-drag-feedback");
const marker = () => root().locator(".dtb-profile-drop-marker");
const screenshot = (name) =>
  page.screenshot({ path: path.join(output, `drag-${name}.png`), animations: "disabled" });
async function blocks() {
  return details()
    .locator("fieldset")
    .first()
    .evaluate((fieldset) =>
      [...fieldset.children]
        .filter((node) => node.matches(".dtb-step-card,.dtb-repeat"))
        .map((node) => ({
          kind: node.matches(".dtb-repeat") ? "repeat" : "step",
          repetitions: node.querySelector('[aria-label="Repetitions"]')?.value ?? null,
          steps: [...node.querySelectorAll('[aria-label="Step title"]')].map((input) => {
            const row = input.closest(".dtb-step-card");
            return Object.fromEntries(
              [
                ...row.querySelectorAll(
                  "input[aria-label],select[aria-label],textarea[aria-label],[role='switch']"
                ),
              ].map((field) => [
                field.getAttribute("aria-label") || "lap",
                field.getAttribute("role") === "switch"
                  ? field.getAttribute("aria-checked")
                  : field.value,
              ])
            );
          }),
        }))
    );
}
const labels = (snapshot) =>
  snapshot.map((block) => (block.kind === "repeat" ? "Repeat" : block.steps[0]["Step title"]));
async function assertOrder(expected) {
  await page.waitForFunction((expected) => {
    const fieldset = document.querySelector(".we-tp-desktop .dtb-details fieldset");
    const actual = [...fieldset.children]
      .filter((node) => node.matches(".dtb-step-card,.dtb-repeat"))
      .map((node) =>
        node.matches(".dtb-repeat")
          ? "Repeat"
          : node.querySelector('[aria-label="Step title"]').value
      );
    return JSON.stringify(actual) === JSON.stringify(expected);
  }, expected);
  assert.deepEqual(labels(await blocks()), expected);
}
async function pointInPlot(fraction) {
  const box = await root().locator(".dtb-chart-scroll").boundingBox();
  if (fraction === "end") {
    const svg = await root().locator("svg[data-workout-profile]").boundingBox();
    assert.ok(
      Math.abs(svg.x + svg.width - box.x - box.width) < 2,
      "Append tail must be at the visible true plot end"
    );
    return { x: svg.x + svg.width + 15, y: svg.y + svg.height / 2 };
  }
  if (typeof fraction === "object") return fraction;
  return { x: box.x + box.width * fraction, y: box.y + 100 };
}
async function insideSegment(locator) {
  const box = await locator.boundingBox();
  // The right half must still insert before this root; midpoint insertion is wrong.
  return { x: box.x + box.width * 0.9, y: box.y + box.height / 2 };
}
async function startDrag(locator, point) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 8, from.y + 4, { steps: 3 });
  await page.mouse.move(point.x, point.y, { steps: 15 });
  // Chromium begins HTML5 drag after the first move; a second move updates its target.
  await page.mouse.move(point.x + 1, point.y, { steps: 2 });
}
async function assertHeldFeedback(name) {
  await feedback().waitFor({ state: "visible" });
  await marker().waitFor({ state: "attached" });
  assert.ok(
    await marker().evaluate(
      (node) => node.getBBox().height > 0 && getComputedStyle(node).stroke !== "none"
    ),
    `${name}: insertion marker must have a painted vertical stroke`
  );
  await root().locator(".dtb-profile-drag-ghost").waitFor({ state: "visible" });
  const box = await feedback().boundingBox();
  const viewport = await root().locator(".dtb-chart-scroll").boundingBox();
  assert.ok(
    box.x >= viewport.x - 1 && box.x + box.width <= viewport.x + viewport.width + 1,
    `${name}: drag details must stay within the visible chart`
  );
  assert.ok(
    box.y >= viewport.y - 1 && box.y + box.height <= viewport.y + viewport.height + 1,
    `${name}: drag details must stay within the chart vertically`
  );
  const text = await feedback().innerText();
  assert.match(text, /Starting at:/);
  assert.match(text, /Ending at:/);
  await screenshot(name);
}
async function paletteDrag(name, fraction, expected) {
  const before = await blocks();
  await startDrag(
    page.getByRole("button", { name: `Add ${name}`, exact: true }),
    await pointInPlot(fraction)
  );
  await assertHeldFeedback(`palette-${name.replaceAll(" ", "-").toLowerCase()}`);
  assert.deepEqual(await blocks(), before, "Palette drag preview must not commit before release");
  await page.mouse.up();
  await assertOrder(expected);
  await feedback().waitFor({ state: "hidden" });
  checks.push(`palette-${name}`);
}
async function reorder(locator, fraction, expected, name) {
  const before = await blocks();
  await startDrag(locator, await pointInPlot(fraction));
  await assertHeldFeedback(name);
  assert.deepEqual(await blocks(), before, "Existing drag preview must not commit before release");
  await page.mouse.up();
  await assertOrder(expected);
  await feedback().waitFor({ state: "hidden" });
  checks.push(name);
}
try {
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  // Establish user-owned scrolling before leaving the calendar's initial
  // today alignment, as a person scrolling to the requested day would.
  await page.mouse.wheel(0, 1);
  const day = new Date();
  day.setDate(day.getDate() + 3);
  const plus = page.getByRole("button", {
    name: `Add workout for ${day.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    exact: true,
  });
  await plus.evaluate((node) => node.scrollIntoView({ block: "center" }));
  const plusBox = await plus.boundingBox();
  await page.mouse.move(plusBox.x + plusBox.width / 2, plusBox.y + plusBox.height / 2);
  await page.waitForFunction(label => {
    const node = [...document.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === label);
    return node && getComputedStyle(node).pointerEvents !== "none";
  }, await plus.getAttribute("aria-label"));
  await plus.click();
  await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
  await page.getByLabel("Workout title", { exact: true }).fill(title);
  await page.getByRole("button", { name: "Build Workout", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  for (const key of ["Enter", "Space"]) {
    const active = page.getByRole("button", { name: "Add Active", exact: true });
    await active.focus();
    await active.press(key);
    await cards().first().waitFor({ state: "visible" });
    assert.equal(
      await cards().count(),
      1,
      "Keyboard palette activation must append exactly one block"
    );
    await root().getByLabel("Workout title", { exact: true }).press("Shift+F10");
    await root()
      .locator(".desktop-workout-context-popover")
      .getByRole("button", { name: "Undo", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".we-tp-desktop .dtb-step-card").length === 0
    );
  }
  keyboardPaletteVerified = true;
  await paletteDrag("Active", 0.5, ["Active"]);
  await cards().first().getByLabel("Step title", { exact: true }).fill("Rich interval");
  await card("Rich interval").getByLabel("Step duration", { exact: true }).fill("00:05:00");
  await card("Rich interval").getByLabel("Target shape", { exact: true }).selectOption("range");
  await card("Rich interval").getByLabel("Range from", { exact: true }).fill("96.4");
  await card("Rich interval").getByLabel("Range to", { exact: true }).fill("115");
  await card("Rich interval")
    .getByRole("button", { name: /Add cadence range/ })
    .click();
  await card("Rich interval").getByLabel("Minimum cadence", { exact: true }).fill("80");
  await card("Rich interval").getByLabel("Maximum cadence", { exact: true }).fill("95");
  await card("Rich interval").getByRole("switch").check();
  await card("Rich interval")
    .getByLabel("Step notes", { exact: true })
    .fill("Preserve notes, range, cadence and lap ending while moving.");
  const rich = (await blocks())[0];
  await profile().first().hover();
  assert.equal(await marker().count(), 0, "Ordinary hover must not show a drag insertion marker");
  assert.equal(await feedback().count(), 0, "Ordinary hover must not show drag details");
  checks.push("ordinary-hover-no-drag-feedback");
  await paletteDrag("Warm up", 0.01, ["Warm up", "Rich interval"]);
  await paletteDrag("Recovery", await insideSegment(profile().last()), [
    "Warm up",
    "Recovery",
    "Rich interval",
  ]);
  await paletteDrag("Cool down", "end", ["Warm up", "Recovery", "Rich interval", "Cool down"]);
  for (const label of ["Recovery", "Cool down"])
    await card(label).getByLabel("Step duration", { exact: true }).fill("00:05:00");
  await card("Warm up").getByLabel("Step duration", { exact: true }).fill("00:20:00");
  await reorder(
    profile().nth(2),
    "end",
    ["Warm up", "Recovery", "Cool down", "Rich interval"],
    "existing-step-to-end"
  );
  assert.deepEqual((await blocks()).at(-1), rich);
  await page.getByRole("button", { name: "Add Three Step Repeats", exact: true }).click();
  const repeat = (await blocks()).at(-1);
  assert.equal(repeat.kind, "repeat");
  await reorder(
    profile().nth(5),
    0.01,
    ["Repeat", "Warm up", "Recovery", "Cool down", "Rich interval"],
    "repeat-child-moves-whole-group"
  );
  assert.deepEqual((await blocks())[0], repeat);
  await reorder(
    profile().nth(1),
    "end",
    ["Warm up", "Recovery", "Cool down", "Rich interval", "Repeat"],
    "repeat-group-to-end"
  );
  await page.getByRole("button", { name: "Zoom in workout profile", exact: true }).click();
  const beforeHiddenTail = await blocks();
  const viewportBeforePan = await root().locator(".dtb-chart-scroll").boundingBox();
  await startDrag(page.getByRole("button", { name: "Add Active", exact: true }), {
    x: viewportBeforePan.x + viewportBeforePan.width + 15,
    y: viewportBeforePan.y + 90,
  });
  await page.mouse.up();
  assert.deepEqual(
    await blocks(),
    beforeHiddenTail,
    "Viewport gap cannot append while the true plot end is offscreen"
  );
  checks.push("hidden-plot-tail-rejects-drop");
  for (let cycle = 1; cycle <= resetRepeats; cycle++)
    for (const kind of ["palette", "reorder"]) {
      await page.evaluate((cycle) => {
        window.__dragResetTraceActive = cycle;
      }, `${cycle}:${kind}`);
      const beforeEdge = await blocks();
      const edge = await root().locator(".dtb-chart-scroll").boundingBox();
      const source =
        kind === "palette"
          ? page.getByRole("button", { name: "Add Active", exact: true })
          : profile().first();
      await startDrag(source, { x: edge.x + edge.width - 10, y: edge.y + 90 });
      await feedback().waitFor({ state: "visible" });
      const markerBefore = await marker().evaluate((node) => node.getBoundingClientRect().x);
      const scrollBefore = await root()
        .locator(".dtb-chart-scroll")
        .evaluate((node) => node.scrollLeft);
      await page.waitForFunction(
        (start) => document.querySelector(".dtb-chart-scroll").scrollLeft > start + 100,
        scrollBefore
      );
      const markerAfter = await marker().evaluate((node) => node.getBoundingClientRect().x);
      assert.notEqual(
        markerAfter,
        markerBefore,
        "Insertion marker must update while the chart auto-pans"
      );
      await screenshot(`${kind}-edge-autopan`);
      const focusedBeforeCancel = await page.evaluateHandle(() => document.activeElement);
      await page.keyboard.press("Escape");
      await page.mouse.up();
      if (dragDiagnosticSession) await dragDiagnosticSession.send("Input.cancelDragging");
      if (overflowDiagnostic)
        await page.evaluate((mode) => {
          const viewport = document.querySelector(".dtb-chart-scroll");
          const property = mode === "display" ? "display" : "overflow";
          const previous = viewport.style[property],
            left = viewport.scrollLeft;
          viewport.style[property] = mode === "display" ? "none" : "clip";
          viewport.getBoundingClientRect();
          viewport.style[property] = previous;
          viewport.scrollTo({ left, behavior: "instant" });
        }, overflowDiagnostic);
      assert.equal(
        await focusedBeforeCancel.evaluate(
          (element) => element.isConnected && element === document.activeElement
        ),
        true,
        "Canceling a drag must preserve the focused DOM element"
      );
      await focusedBeforeCancel.dispose();
      assert.deepEqual(
        await blocks(),
        beforeEdge,
        "Canceling edge auto-pan must leave the model unchanged"
      );
      await page.getByRole("button", { name: "Zoom out workout profile", exact: true }).click();
      await page.getByRole("button", { name: "Zoom in workout profile", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".dtb-chart-scroll").scrollLeft === 0
      );
      const stableScroll = await page.evaluate(async () => {
        const positions = [];
        for (let frame = 0; frame < 12; frame++) {
          await new Promise((resolve) => requestAnimationFrame(resolve));
          positions.push(document.querySelector(".dtb-chart-scroll").scrollLeft);
        }
        return positions;
      });
      assert.deepEqual(
        stableScroll,
        Array(12).fill(0),
        "Canceled auto-pan must stay stopped after zoom reset, without a surviving animation loop"
      );
      checks.push(`${kind}-edge-autopan-cancel`);
      await page.evaluate(() => {
        window.__dragResetTraceActive = false;
      });
    }
  for (let count = 0; count < 3; count++) {
    const pan = page.getByRole("button", { name: "Scroll workout profile forward", exact: true });
    if (!(await pan.count())) break;
    await pan.click();
    await page.waitForTimeout(750);
  }
  await reorder(
    profile().last(),
    0.05,
    ["Warm up", "Recovery", "Repeat", "Cool down", "Rich interval"],
    "repeat-reorder-zoomed-and-panned"
  );
  assert.deepEqual((await blocks())[2], repeat);
  await page.getByRole("button", { name: "Zoom out workout profile", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".dtb-chart-scroll").scrollLeft === 0);
  const beforeCancel = await blocks();
  await startDrag(profile().last(), await pointInPlot(0.01));
  await assertHeldFeedback("existing-cancel-escape");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await blocks(), beforeCancel);
  await startDrag(profile().last(), { x: 30, y: 30 });
  await page.mouse.up();
  assert.deepEqual(await blocks(), beforeCancel);
  await startDrag(
    page.getByRole("button", { name: "Add Active", exact: true }),
    await pointInPlot(0.5)
  );
  await assertHeldFeedback("palette-cancel-escape");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await blocks(), beforeCancel);
  await startDrag(page.getByRole("button", { name: "Add Active", exact: true }), { x: 30, y: 30 });
  await page.mouse.up();
  assert.deepEqual(await blocks(), beforeCancel);
  checks.push("escape-and-outside-drop-cancel");
  const final = await blocks();
  assert.deepEqual(final.at(-1), rich);
  await screenshot("final-before-save");
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      apiPath(response.url()).replace(/^\/api\//, "") === "workout-commits"
  );
  await root().getByRole("button", { name: "Save & Close", exact: true }).click();
  const accepted = await saved;
  assert.equal(accepted.ok(), true);
  const receipt = await accepted.json();
  assert.equal(receipt.accepted, true);
  const deadline = Date.now() + 20000;
  let verified;
  do {
    const response = await page.request.get(origin + "/api/preview/workout-commits");
    const journal = await response.json();
    verified = journal.workouts?.find(
      (row) => row.workoutId === receipt.workoutId && row.syncStatus === "synced"
    );
    if (verified) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  assert.ok(
    verified,
    "The durable drag save must be verified against the synthetic provider before reopening."
  );
  await root().waitFor({ state: "hidden" });
  await page.getByText(title, { exact: true }).click();
  await page.getByRole("button", { name: "Workout actions", exact: true }).click();
  await page
    .locator(".desktop-workout-toolbar-popover")
    .getByRole("button", { name: /Edit workout/i })
    .click();
  await card("Rich interval")
    .getByLabel("Step title", { exact: true })
    .waitFor({ state: "visible" });
  assert.deepEqual(
    await blocks(),
    final,
    "Saved/reopened drag order and all prescriptions must match"
  );
  checks.push("drag-save-reopen-preserves-all-fields");
  await screenshot("saved-reopened");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      { checks, errors, acceptanceEligible: !nativeDragDiagnostic && !overflowDiagnostic },
      null,
      2
    )
  );
} catch (error) {
  await screenshot("failure");
  console.error(
    JSON.stringify({ checks, errors, blocks: await blocks().catch(() => []) }, null, 2)
  );
  throw error;
} finally {
  await fs.writeFile(
    path.join(output, "network-drag.json"),
    JSON.stringify(network.entries, null, 2)
  );
  await fs.writeFile(
    path.join(output, "drag-results.json"),
    JSON.stringify(
      {
        checks,
        errors,
        keyboardPaletteVerified,
        browser: process.env.APP_TEST_BROWSER || "msedge",
        browserVersion: browser.version(),
        diagnosticNativeDragCancel: nativeDragDiagnostic,
        diagnosticOverflowReset: overflowDiagnostic,
        acceptanceEligible: !nativeDragDiagnostic && !overflowDiagnostic,
      },
      null,
      2
    )
  );
  await fs.writeFile(
    path.join(output, "drag-scroll-trace.json"),
    JSON.stringify({ resetRepeats, trace: scrollTrace }, null, 2)
  );
  await browser.close();
  server?.kill();
}
