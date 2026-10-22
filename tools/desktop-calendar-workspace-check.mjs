// Isolated synthetic preview only. Never connect this test to a live account.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
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
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5395";
assert.ok(
  ["localhost", "127.0.0.1"].includes(new URL(origin).hostname),
  "Synthetic localhost preview required"
);
const output = path.resolve("artifacts/desktop-calendar-workspace");
await fs.mkdir(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, channel: "msedge" });
const errors = [],
  checks = [],
  requests = [],
  blocked = [];
try {
  for (const [width, height] of [
    [1024, 768],
    [1280, 720],
    [1148, 669],
    [1440, 900],
    [1920, 1080],
  ]) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: "light" });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      blocked.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api/"))
        requests.push({ width, path: new URL(r.url()).pathname, method: r.method() });
    });
    await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
    assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.waitForFunction(() => {
      const day = document.querySelector("[data-calendar-today=true]")?.getBoundingClientRect(),
        header = document.querySelector(".calendar-weekday-header")?.getBoundingClientRect();
      return day && header && Math.abs(day.top - header.bottom) < 1;
    });
    const geometry = await page.evaluate(() => {
      const bounds = (selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom };
      };
      const pane = document.querySelector(".training-calendar");
      return {
        tokens: {
          header: getComputedStyle(document.querySelector(".desktop-calendar-topbar"))
            .backgroundColor,
          activeNavigation: getComputedStyle(
            document.querySelector('.desktop-calendar-topbar [aria-current="page"]')
          ).backgroundColor,
          inactiveText: getComputedStyle(
            document.querySelector(".desktop-calendar-topbar nav > button")
          ).color,
          rail: getComputedStyle(document.querySelector(".desktop-calendar-library-rail"))
            .backgroundColor,
        },
        header: bounds(".desktop-calendar-topbar"),
        rail: bounds(".desktop-calendar-library-rail"),
        toolbar: bounds(".calendar-desktop-toolbar"),
        weekdays: bounds(".calendar-weekday-header"),
        pane: bounds(".training-calendar"),
        scrollTop: pane.scrollTop,
        scrollY,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    assert.equal(geometry.header.height, 40);
    assert.deepEqual(geometry.tokens, {
      header: "rgb(1, 15, 49)",
      activeNavigation: "rgb(22, 30, 46)",
      inactiveText: "rgb(151, 166, 186)",
      rail: "rgb(255, 255, 255)",
    });
    assert.equal(geometry.header.width, width);
    assert.equal(geometry.rail.width, 64);
    assert.equal(geometry.toolbar.y, 40);
    assert.equal(geometry.toolbar.height, 56);
    assert.equal(geometry.weekdays.height, 28);
    assert.equal(geometry.weekdays.bottom, 124);
    assert.equal(geometry.scrollY, 0);
    assert.ok(geometry.scrollTop > 0);
    assert.ok(geometry.overflow <= 1);
    const card = page.locator(".calendar-workout-card").filter({ visible: true }).first();
    const dataReads = () =>
      requests.filter((r) =>
        /workout-(?:values|comments|editor)|\/activities\/|\/workouts\//.test(r.path)
      ).length;
    const beforeHover = dataReads();
    await card.hover();
    await card.focus();
    await page.waitForTimeout(200);
    assert.equal(dataReads(), beforeHover, "Hover/focus must not fetch workout data");
    const options = card.getByRole("button", { name: /^Options for / });
    if (await options.count()) {
      await options.click();
      await page.getByRole("menuitem", { name: "Edit", exact: true }).waitFor();
      assert.equal(
        await page.locator('[data-slot="dialog-content"]:visible').count(),
        0,
        "Opening card options must not also open the workout"
      );
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Upload activity", exact: true }).click();
    await page
      .locator(".workout-file-dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page.getByRole("button", { name: "Search workouts", exact: true }).click();
    await page.getByLabel("Search loaded workouts", { exact: true }).fill("Editable bike workout");
    await page
      .locator(".calendar-search-results")
      .getByRole("button", { name: /Editable bike workout/ })
      .waitFor();
    await page
      .getByLabel("Search loaded workouts", { exact: true })
      .fill("no-fixture-matches-this");
    await page.getByText("No matching loaded workouts.", { exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.locator(".calendar-workout-search").waitFor({ state: "hidden" });
    for (const [label, attribute] of [
      ["Workout profiles", "data-calendar-profiles"],
      ["Daily metrics", "data-calendar-metrics"],
    ]) {
      await page.getByRole("button", { name: "Calendar settings", exact: true }).click();
      await page.getByRole("menuitemcheckbox", { name: label, exact: true }).click();
      assert.equal(await page.locator(".training-calendar").getAttribute(attribute), "hidden");
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "Calendar settings", exact: true }).click();
      await page.getByRole("menuitemcheckbox", { name: label, exact: true }).click();
      assert.equal(await page.locator(".training-calendar").getAttribute(attribute), "visible");
      await page.keyboard.press("Escape");
    }
    assert.equal(
      dataReads(),
      beforeHover,
      "Search, settings and cancelled upload must not fetch workout data"
    );
    assert.equal(
      requests.filter((r) => r.path === "/api/config").length,
      0,
      "Calendar display preferences must not query Supabase-backed config"
    );
    const pane = page.locator(".training-calendar");
    await pane.hover();
    await page.mouse.wheel(0, 600);
    await page.waitForFunction(
      (old) => document.querySelector(".training-calendar").scrollTop > old,
      geometry.scrollTop
    );
    assert.equal(await page.evaluate(() => scrollY), 0, "Only the Calendar pane scrolls");
    const pinned = await page.locator(".calendar-desktop-toolbar").boundingBox();
    assert.equal(pinned.y, 40);
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.getByRole("button", { name: "Next calendar week", exact: true }).click();
    await page.getByRole("button", { name: "Previous calendar week", exact: true }).click();
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector("[data-calendar-today=true]").getBoundingClientRect().top - 124
        ) < 1
    );
    const todayCell = page.locator('[data-calendar-today="true"]');
    await todayCell.hover();
    await todayCell.locator(".calendar-day-add-workout").click();
    const chooser = page.locator(".calendar-add-dialog");
    await chooser.waitFor();
    await page.waitForFunction(
      () =>
        Math.abs(
          document.querySelector(".calendar-add-dialog").getBoundingClientRect().width - 768
        ) < 0.05
    );
    const chooserBounds = await chooser.boundingBox();
    assert.equal(chooserBounds.width, 768);
    assert.ok(chooserBounds.height <= height - 64);
    assert.equal(await chooser.getByRole("button", { name: "Sauna", exact: true }).count(), 0);
    assert.equal(
      await chooser.getByRole("button", { name: "Upload File", exact: true }).count(),
      1
    );
    assert.equal(
      await chooser.locator(".calendar-add-options").first().getByRole("button").count(),
      14
    );
    await page.screenshot({ path: path.join(output, `add-menu-${width}x${height}.png`) });
    await chooser.getByRole("button", { name: "Upload File", exact: true }).click();
    await page
      .locator(".workout-file-dialog")
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.screenshot({ path: path.join(output, `calendar-${width}x${height}.png`) });
    if (width === 1280) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator(".desktop-calendar-topbar").waitFor({ state: "hidden" });
      await page.setViewportSize({ width, height });
      await page.locator(".desktop-calendar-topbar").waitFor({ state: "visible" });
      await page.waitForFunction(
        () =>
          Math.abs(
            document.querySelector('[data-calendar-today="true"]').getBoundingClientRect().top - 124
          ) < 1
      );
      checks.push({ name: "resize-preserves-current-week-and-scroll-owner" });
    }
    // The reference layout is limited to Calendar. Navigating away restores the existing shell.
    await page
      .locator(".desktop-calendar-topbar")
      .getByRole("button", { name: "Home", exact: true })
      .click();
    await page.waitForFunction(
      () => !document.documentElement.hasAttribute("data-calendar-workspace")
    );
    assert.equal(await page.locator(".desktop-calendar-topbar").count(), 0);
    assert.equal(await page.locator('aside[aria-label="Desktop sidebar"]').count(), 1);
    if (width === 1280) {
      await page
        .locator('aside[aria-label="Desktop sidebar"]')
        .getByRole("button", { name: "Calendar", exact: true })
        .click();
      await page.locator(".desktop-calendar-account").click();
      await page.getByRole("menuitem", { name: "Nutrition", exact: true }).click();
      await page.waitForFunction(
        () => !document.documentElement.hasAttribute("data-calendar-workspace")
      );
      assert.equal(await page.locator(".desktop-calendar-topbar").count(), 0);
      assert.equal(await page.locator('aside[aria-label="Desktop sidebar"]').count(), 1);
      assert.notEqual(
        await page.evaluate(() => getComputedStyle(document.body).overflowY),
        "hidden"
      );
      checks.push({ name: "nutrition-restores-original-shell-and-body-scrolling" });
    }
    checks.push({
      name: `desktop-${width}x${height}`,
      geometry,
      hoverWorkoutDataReads: dataReads() - beforeHover,
      displayPreferenceConfigRequests: requests.filter((r) => r.path === "/api/config").length,
    });
    await context.close();
  }
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${origin}/calendar?theme=light`, { waitUntil: "networkidle" });
  await page
    .getByRole("button", { name: /^Open / })
    .first()
    .waitFor();
  assert.equal(await page.locator(".desktop-calendar-topbar").count(), 0);
  assert.equal(await page.locator(".calendar-day-add-workout:visible").count(), 0);
  assert.notEqual(
    await page.locator(".training-calendar").evaluate((e) => getComputedStyle(e).overflowY),
    "auto"
  );
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(output, "calendar-mobile-390.png") });
  checks.push({ name: "mobile-original-layout" });
  await context.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, []);
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify({ checks, errors, requests, blocked }, null, 2)
  );
  console.log(JSON.stringify({ checks, errors, requestCount: requests.length, output }, null, 2));
} catch (error) {
  await fs.writeFile(path.join(output, "errors.json"), JSON.stringify(errors, null, 2));
  for (const context of browser.contexts())
    for (const page of context.pages()) {
      await page.screenshot({ path: path.join(output, "failure.png") }).catch(() => {});
      await fs.writeFile(path.join(output, "failure.html"), await page.content()).catch(() => {});
    }
  throw error;
} finally {
  await browser.close();
}
