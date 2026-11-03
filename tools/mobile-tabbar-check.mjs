// Native touch, layout and accessibility checks against the synthetic preview.
// Run after building: node tools/desktop-preview.mjs --calendar-edits --port=5350
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium, webkit } = require(
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  )
);
const origin = process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:5350";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const engine = process.env.TABBAR_BROWSER || "chromium";
const browser = await (engine === "webkit"
  ? webkit.launch({
      headless: true,
      ...(process.env.TABBAR_WEBKIT_EXECUTABLE
        ? { executablePath: process.env.TABBAR_WEBKIT_EXECUTABLE }
        : {}),
    })
  : chromium.launch({ headless: true, channel: "msedge" }));
const output = "artifacts/native-menu";
await fs.mkdir(output, { recursive: true });
const results = [],
  errors = [],
  writes = [];
const pages = ["Home", "Calendar", "Coach", "ATP", "More"];
const routes = ["/", "/calendar", "/coach", "/annual-plan", "/settings"];
let currentPage;
try {
  for (const [width, theme] of [
    [320, "light"],
    [390, "light"],
    [402, "light"],
    [430, "light"],
    [402, "dark"],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height: 874 },
      deviceScaleFactor: width === 402 ? 3 : 1,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
      colorScheme: theme,
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await context.addInitScript(() => {
      window.tabNavigations = [];
      const push = history.pushState.bind(history);
      history.pushState = (...args) => {
        window.tabNavigations.push(String(args[2]));
        return push(...args);
      };
    });
    const page = await context.newPage();
    currentPage = page;
    page.setDefaultTimeout(7000);
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("request", (request) => {
      if (
        ["POST", "PUT", "DELETE", "PATCH"].includes(request.method()) &&
        /workouts\/editor|calendar\/entries|nutrition\/entries|workout-commits/.test(request.url())
      )
        writes.push(request.url());
    });
    await page.goto(`${origin}/?theme=${theme}`, { waitUntil: "networkidle" });
    const nav = page.getByRole("navigation", { name: "Primary navigation", exact: true });
    const pane = nav.getByRole("tablist");
    await nav.waitFor();
    const dimensions = await nav.evaluate((node) => {
      const pane = node.querySelector(".toolbar-pane"),
        tab = pane.querySelector("button"),
        label = tab.querySelector(".tabbar-label"),
        icon = tab.querySelector("svg"),
        lens = pane.querySelector(".tab-link-highlight");
      const box = pane.getBoundingClientRect();
      return {
        height: box.height,
        left: box.left,
        right: innerWidth - box.right,
        bottom: innerHeight - box.bottom,
        font: getComputedStyle(label).fontSize,
        lineHeight: getComputedStyle(label).lineHeight,
        weight: getComputedStyle(label).fontWeight,
        icon: icon.getBoundingClientRect().width,
        lensWidth: lens.getBoundingClientRect().width,
        lensSurfaceWidth: parseFloat(getComputedStyle(lens, "::before").width),
        lensSurfaceHeight: parseFloat(getComputedStyle(lens, "::before").height),
        trackWidth: pane.querySelector(".mobile-tab-track").getBoundingClientRect().width,
        firstCenter: tab.getBoundingClientRect().left + tab.getBoundingClientRect().width / 2,
        width: box.width,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    assert.equal(dimensions.height, 62);
    assert.equal(dimensions.left, 21);
    assert.equal(dimensions.right, 21);
    assert.equal(dimensions.bottom, 21);
    assert.equal(dimensions.font, "11px");
    assert.equal(dimensions.lineHeight, "13px");
    assert.equal(dimensions.icon, 28);
    assert.equal(dimensions.trackWidth, dimensions.width - 16);
    assert.ok(Math.abs(dimensions.lensWidth - dimensions.trackWidth / 5) < 0.1);
    assert.ok(Math.abs(dimensions.lensSurfaceWidth - (dimensions.trackWidth / 5 + 8)) < 0.1);
    assert.equal(dimensions.lensSurfaceHeight, 54);
    assert.ok(Math.abs(dimensions.firstCenter - (21 + 8 + dimensions.trackWidth / 10)) < 0.1);
    assert.equal(dimensions.overflow, false);
    const tab = (index) => nav.getByRole("tab", { name: pages[index], exact: true });
    async function selected(index) {
      await page.waitForURL((url) => url.pathname === routes[index]);
      assert.equal(await tab(index).getAttribute("aria-selected"), "true");
      assert.equal(await nav.locator('[role="tab"][aria-selected="true"]').count(), 1);
      assert.equal(await nav.locator('[role="tab"][tabindex="0"]').count(), 1);
      assert.equal(await nav.locator(".tab-link-highlight").count(), 1);
    }
    // Calendar initializes the lazy Framework7 touch runtime before more taps.
    let glass;
    const headerDimensions = [];
    for (const index of [1, 2, 3, 4, 0]) {
      await tab(index).tap();
      await selected(index);
      const background = await nav
        .locator(".liquid-glass-filter-layer")
        .evaluate((node) => getComputedStyle(node).backgroundColor);
      if (glass) assert.equal(background, glass, "Every route uses the same glass material");
      glass = background;
      const controls = page.locator(".mobile-site-navbar:visible .mobile-navbar-action:visible");
      await controls.first().waitFor();
      const header = await controls.evaluateAll((nodes) =>
        nodes.map((node) => {
          const rect = node.getBoundingClientRect(),
            style = getComputedStyle(node),
            icon = node.querySelector("svg");
          return {
            width: rect.width,
            height: rect.height,
            icon: icon?.getBoundingClientRect().width,
            pill: node.matches(".mobile-navbar-action-with-text, .calendar-month-picker-button"),
            fill: style.backgroundColor,
            blur: style.backdropFilter || style.webkitBackdropFilter,
            radius: style.borderRadius,
          };
        })
      );
      for (const control of header) {
        assert.equal(control.height, 44, "Header circles use the reference 44pt diameter");
        if (!control.pill) assert.equal(control.width, 44);
        else assert.ok(control.width >= 44);
        assert.equal(control.icon, 22);
        assert.equal(control.fill, background, "Header buttons and tab bar share the glass tint");
        assert.ok(control.blur.includes("blur(10px)"));
      }
      headerDimensions.push({ page: pages[index], controls: header });
    }
    if (width === 402)
      await page
        .locator(".mobile-site-navbar:visible")
        .first()
        .screenshot({ path: `${output}/header-${engine}-${theme}.png`, scale: "css" });
    const cdp = engine === "chromium" ? await context.newCDPSession(page) : null;
    async function contact(index) {
      const box = await tab(index).boundingBox();
      const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
      return point;
    }
    if (cdp) {
      for (const movement of [7, -7, 12]) {
        const point = await contact(1);
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x: point.x + movement, y: point.y }],
        });
        await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await selected(1);
        await tab(0).tap();
        await selected(0);
      }
      const start = await contact(0),
        target = await tab(3).boundingBox();
      const before = await page.evaluate(() => window.tabNavigations.length);
      for (let step = 1; step <= 12; step++) {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [
            { x: start.x + ((target.x + target.width / 2 - start.x) * step) / 12, y: start.y },
          ],
        });
      }
      assert.equal(new URL(page.url()).pathname, "/", "Dragging previews without navigating");
      assert.equal(await pane.getAttribute("data-dragging"), "true");
      assert.equal(await tab(3).getAttribute("data-highlighted"), "true");
      assert.equal(await tab(0).getAttribute("aria-selected"), "true");
      if (width === 402 && theme === "light")
        await nav.screenshot({ path: `${output}/pressed-${engine}.png` });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await selected(3);
      assert.equal(
        await page.evaluate(() => window.tabNavigations.length),
        before + 1,
        "A scrub commits once; its compatibility click must not navigate again"
      );
      const cancelStart = await contact(3);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: cancelStart.x - 70, y: cancelStart.y }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
      await selected(3);
      assert.equal(await pane.getAttribute("data-contact"), null);
      const outside = await contact(3);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: outside.x - 80, y: outside.y }],
      });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: outside.x - 80, y: outside.y - 90 }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await selected(3);
      const vertical = await contact(1);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: vertical.x, y: vertical.y - 80 }],
      });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await selected(3);
      await tab(4).tap();
      await selected(4);
      await page.goBack();
      await selected(3);
      await page.waitForFunction(() => {
        const lens = document.querySelector(".mobile-navbar .tab-link-highlight");
        const pane = lens.parentElement.getBoundingClientRect(),
          rect = lens.getBoundingClientRect();
        return Math.abs(rect.left - pane.left - pane.width * 0.6) < 0.5;
      });
    }
    if (!cdp) {
      // WebKit has native touch taps but no CDP touchMove. Native mouse pointer
      // events exercise scrub capture and release in that engine.
      const start = await tab(0).boundingBox(),
        target = await tab(3).boundingBox();
      await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
      await page.mouse.down();
      await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
        steps: 12,
      });
      await page.waitForFunction(
        () => document.getElementById("mobile-tab-annual-plan").dataset.highlighted === "true"
      );
      assert.equal(new URL(page.url()).pathname, "/");
      assert.equal(await tab(3).getAttribute("data-highlighted"), "true");
      await page.mouse.up();
      await selected(3);
    }
    await tab(0).focus();
    await tab(0).press("End");
    await selected(4);
    assert.equal(await tab(4).evaluate((node) => node === document.activeElement), true);
    await tab(4).press("ArrowRight");
    await selected(0);
    await tab(0).press("ArrowLeft");
    await selected(4);
    await tab(4).press("Home");
    await selected(0);
    await tab(0).tap(); // Leave keyboard focus styling out of the visual sample.
    await tab(0).evaluate((node) => node.blur());
    await page.waitForFunction(() => {
      const lens = document.querySelector(".mobile-navbar .tab-link-highlight");
      return (
        Math.abs(
          lens.getBoundingClientRect().left - lens.parentElement.getBoundingClientRect().left
        ) < 0.5
      );
    });
    await nav.screenshot({ path: `${output}/tabs-${engine}-${width}-${theme}.png`, scale: "css" });
    if (width === 402) await page.screenshot({ path: `${output}/app-${engine}-${theme}.png` });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(
      await nav
        .locator(".tab-link-highlight")
        .evaluate((node) => getComputedStyle(node).transitionDuration),
      "0s"
    );
    await tab(1).tap();
    await selected(1);
    results.push({
      width,
      theme,
      dimensions,
      headerDimensions,
      checks:
        "native taps, one selected tab, keyboard, reduced motion" +
        (cdp
          ? ", small finger movement, scrub, cancel, release outside, vertical scroll, browser Back"
          : ", pointer scrub"),
    });
    await context.close();
  }
  const desktop = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await desktop.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  await desktop.goto(origin, { waitUntil: "networkidle" });
  assert.equal(await desktop.locator(".native-glass-tabs").count(), 0);
  await desktop.close();
} catch (error) {
  if (currentPage && !currentPage.isClosed())
    await currentPage.screenshot({ path: `${output}/failure-${engine}.png` });
  throw error;
} finally {
  await browser.close();
  await fs.writeFile(
    `${output}/checks-${engine}.json`,
    JSON.stringify({ results, errors, writes }, null, 2)
  );
}
assert.deepEqual(errors, []);
assert.deepEqual(writes, []);
console.log(JSON.stringify({ passed: true, engine, results, errors, writes }, null, 2));
