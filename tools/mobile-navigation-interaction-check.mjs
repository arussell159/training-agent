import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"));
const origin = process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:5332";
const output = "artifacts/mobile-interaction";
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "msedge" });
const results = [];
let currentPage, currentErrors;
try {
  for (const width of [320, 390, 430]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true, serviceWorkers: "block", timezoneId: "America/Chicago" });
    const page = await context.newPage(), errors = [], writes = [];
    currentPage = page; currentErrors = errors;
    await context.addInitScript(() => {
      window.interactionErrors = [];
      window.addEventListener("error", event => {
        const describe = value => value instanceof Error ? { message: value.message, stack: value.stack, cause: value.cause ? describe(value.cause) : undefined } : String(value);
        window.interactionErrors.push(describe(event.error));
      });
    });
    page.setDefaultTimeout(10000);
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", async message => {
      if (message.type() !== "error") return;
      for (const argument of message.args()) {
        const value = await argument.evaluate(value => value instanceof Error ? { message: value.message, stack: value.stack, cause: value.cause instanceof Error ? { message: value.cause.message, stack: value.cause.stack } : value.cause } : String(value)).catch(() => message.text());
        errors.push(value);
      }
    });
    page.on("request", request => { if (request.method() === "POST" && /nutrition\/entries|workout-commits|calendar\/entries/.test(request.url())) writes.push(request.url()); });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin, { waitUntil: "networkidle" });
    await page.locator(".home-athlete-name").waitFor();
    const header = await page.evaluate(() => {
      const h = document.querySelector(".mobile-site-navbar"), title = h.querySelector(".title"), control = h.querySelector("select");
      const t = title.getBoundingClientRect(), c = control.getBoundingClientRect();
      return { titleCenter: t.x + t.width / 2, viewportCenter: innerWidth / 2, titleRight: t.right, menuLeft: c.left, width: h.getBoundingClientRect().width, height: h.getBoundingClientRect().height, documentWidth: document.documentElement.scrollWidth, pageAnimation: getComputedStyle(document.querySelector(".mobile-page-tab.tab-active")).animationName };
    });
    assert.equal(header.documentWidth, width);
    assert.equal(header.height, 56);
    assert.ok(Math.abs(header.titleCenter - header.viewportCenter) <= 2, JSON.stringify(header));
    assert.ok(header.titleRight <= header.menuLeft, "title must not cover its menu");
    assert.equal(header.pageAnimation, "none");
    await page.locator(".dashboard-history-grid").scrollIntoViewIfNeeded();
    const historyTabs = page.getByRole("tablist", { name: "Filter training history by sport", exact: true });
    await historyTabs.waitFor();
    await historyTabs.getByRole("tab").nth(1).click();
    assert.equal(await historyTabs.getByRole("tab").nth(1).getAttribute("aria-selected"), "true");
    const fitnessTabs = page.getByRole("tablist", { name: "Fitness history sport", exact: true });
    await fitnessTabs.waitFor();
    await fitnessTabs.getByRole("tab").nth(1).click();
    assert.equal(await fitnessTabs.getByRole("tab").nth(1).getAttribute("aria-selected"), "true");
    await page.evaluate(() => scrollTo(0, 640));
    await page.getByRole("tab", { name: "Calendar", exact: true }).click();
    await page.locator(".calendar-date-number").first().waitFor();
    assert.equal(await page.locator(".mobile-navbar .tab-link-highlight").count(), 1);
    const calendarHighlight = await page.locator(".mobile-navbar .tab-link-highlight").evaluate(element => getComputedStyle(element).transform);
    await page.getByRole("button", { name: "Jump to calendar date", exact: true }).click();
    await page.locator(".mobile-calendar-picker-panel .calendar-day").first().waitFor();
    await page.getByRole("button", { name: "Next month", exact: true }).click();
    await page.getByRole("button", { name: "Jump to calendar date", exact: true }).click();
    await page.locator(".mobile-calendar-picker-layer").waitFor({ state: "detached" });
    await page.goBack();
    await page.locator(".home-athlete-name").waitFor();
    await page.waitForFunction(() => Math.abs(scrollY - 640) <= 2);
    await page.getByRole("tab", { name: "Calendar", exact: true }).click();
    await page.locator(".calendar-date-number").first().waitFor();
    await page.getByLabel("Options", { exact: true }).selectOption("add-workout");
    await page.getByRole("button", { name: "Cancel workout editing", exact: true }).waitFor();
    await page.getByRole("button", { name: "Cancel workout editing", exact: true }).click();
    await page.getByRole("button", { name: "Cancel workout editing", exact: true }).waitFor({ state: "detached" });
    assert.equal(await page.locator(".mobile-navbar .tab-link-highlight").count(), 1, "lazy framework runtime must not duplicate navigation markup");
    await page.getByRole("tab", { name: "More", exact: true }).click();
    await page.waitForURL("**/settings");
    await page.getByRole("tab", { name: "More", exact: true }).focus();
    await page.getByRole("tab", { name: "More", exact: true }).press("Home");
    await page.locator(".home-athlete-name").waitFor();
    await page.waitForFunction(() => scrollY === 0);
    assert.equal(await page.getByRole("tab", { name: "Home", exact: true }).getAttribute("aria-selected"), "true");
    await page.evaluate(() => {
      for (const id of ["calendar", "settings", "home"]) document.getElementById(`mobile-tab-${id}`).click();
    });
    await page.waitForURL(origin + "/");
    await page.locator(".home-athlete-name").waitFor();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("training-write-feedback", { detail: { operation: "navigation-test-only", state: "success", title: "Synthetic interaction confirmed" } })));
    await page.getByText("Synthetic interaction confirmed", { exact: true }).waitFor();
    await page.screenshot({ path: `${output}/navigation-${width}.png` });
    assert.deepEqual(errors, []);
    assert.deepEqual(writes, []);
    results.push({ width, header, calendarHighlight, homeChartFilters: true, datePicker: true, editorCancel: true, keyboardNavigation: true, rapidNavigation: true, historyScrollRestored: 640, freshNavigationScroll: 0, writes: writes.length, errors });
    await context.close();
  }
  await fs.writeFile(`${output}/navigation.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} catch (error) {
  console.error(JSON.stringify({ message: error.message, errors: currentErrors, detailedErrors: await currentPage?.evaluate(() => window.interactionErrors), url: currentPage?.url(), body: await currentPage?.locator("body").innerText() }, null, 2));
  await currentPage?.screenshot({ path: `${output}/navigation-failure.png` });
  throw error;
} finally { await browser.close(); }
