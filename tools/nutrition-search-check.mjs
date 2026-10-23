// Run against tests/nutrition-readability.vite.config.ts. All writes stay in memory.
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
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5193";
const engine = process.env.APP_TEST_ENGINE || "chromium";
const output = path.resolve(
  process.env.APP_TEST_OUTPUT ||
    (engine === "chromium" ? "artifacts/reliability" : `artifacts/reliability-${engine}`)
);
await fs.mkdir(output, { recursive: true });
const browser = await playwright[engine].launch({
  headless: true,
  ...(engine === "chromium" ? { channel: process.env.APP_TEST_BROWSER || "msedge" } : {}),
  ...(process.env.APP_TEST_EXECUTABLE ? { executablePath: process.env.APP_TEST_EXECUTABLE } : {}),
});
let currentPage;
try {
  for (const width of [320, 390, 430, 844, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 844 ? 390 : 844 },
      hasTouch: width !== 1440,
      isMobile: width !== 1440,
      timezoneId: "America/Chicago",
    });
    const blocked = [],
      errors = [];
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
      blocked.push(url.href);
      return route.abort();
    });
    const page = await context.newPage();
    currentPage = page;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/tests/nutrition-readability.html?flow=1`, {
      waitUntil: "networkidle",
    });
    await page.getByRole("heading", { name: "Your meals", exact: true }).waitFor();
    const positions = await page.evaluate(() => {
      const top = (selector) => document.querySelector(selector).getBoundingClientRect().top;
      return [
        top(".nutrition-progress-card"),
        top(".nutrition-meals"),
        top(".nutrition-week-card"),
      ];
    });
    if (width < 768) assert.ok(positions[0] < positions[1] && positions[1] < positions[2]);
    await page.screenshot({
      path: path.join(output, `nutrition-layout-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Add breakfast", exact: true }).click();
    const search = page.getByPlaceholder("Search foods or brands");
    await search.fill("oats");
    const add = page.getByRole("button", { name: "Add one serving of Oats 1", exact: true });
    await add.click();
    await page
      .getByRole("region", { name: "Notifications" })
      .getByText("Added Oats 1 to Breakfast.", { exact: true })
      .waitFor();
    assert.equal(await search.inputValue(), "oats");
    assert.equal(await page.locator(".nutrition-result").count(), 12);
    await add.click();
    await page.waitForFunction(() => window.__nutritionFixture.operations.length === 2);
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Add one serving of Oats 1"]').disabled
    );
    let operations = await page.evaluate(() => window.__nutritionFixture.operations);
    assert.notEqual(operations[0].operationId, operations[1].operationId);
    assert.notEqual(operations[0].entries[0].id, operations[1].entries[0].id);

    // Review a result lower down, change its portion, and return to the same search position.
    const details = page.getByRole("button", { name: "Details for Oats 9", exact: true });
    await details.scrollIntoViewIfNeeded();
    const scroll = await page
      .locator(".nutrition-screen-scroll")
      .evaluate((node) => node.scrollTop);
    await details.click();
    await page.getByLabel("Portion amount", { exact: true }).fill("0");
    await page.getByLabel("Portion amount", { exact: true }).blur();
    assert.equal(await page.getByLabel("Portion amount", { exact: true }).inputValue(), "0");
    assert.equal(
      await page.getByRole("button", { name: "Add to Breakfast", exact: true }).isDisabled(),
      true
    );
    await page
      .getByRole("alert")
      .filter({ hasText: "Enter an amount greater than zero" })
      .waitFor();
    await page.getByLabel("Portion amount", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Add to Breakfast", exact: true }).click();
    await search.waitFor();
    await page
      .getByRole("region", { name: "Notifications" })
      .getByText("Added Oats 9 to Breakfast.", { exact: true })
      .waitFor();
    assert.equal(await search.inputValue(), "oats");
    assert.equal(
      await page.getByRole("tab", { name: "All", exact: true }).getAttribute("aria-selected"),
      "true"
    );
    assert.equal(await page.locator(".nutrition-result").count(), 12);
    assert.ok(
      Math.abs(
        (await page.locator(".nutrition-screen-scroll").evaluate((node) => node.scrollTop)) - scroll
      ) < 2
    );
    operations = await page.evaluate(() => window.__nutritionFixture.operations);
    assert.equal(operations[2].entries[0].quantity, 2);
    assert.equal(operations[2].entries[0].calories, 400);
    assert.equal(
      await page.evaluate(
        () => window.__nutritionFixture.calls.filter((route) => route === "nutrition/search").length
      ),
      1
    );
    await page.screenshot({ path: path.join(output, `nutrition-search-return-${width}.png`) });

    // A failed detail save stays editable; retry reuses its operation ID.
    await details.click();
    await page.getByLabel("Portion amount", { exact: true }).fill("3");
    await page.evaluate(() => {
      window.__nutritionFixture.failNext = true;
    });
    await page.getByRole("button", { name: "Add to Breakfast", exact: true }).click();
    await page
      .locator(".nutrition-screen [role=alert]")
      .filter({ hasText: "Could not save fixture food" })
      .waitFor();
    assert.equal(await page.getByLabel("Portion amount").inputValue(), "3");
    await page.getByRole("button", { name: "Add to Breakfast", exact: true }).click();
    await search.waitFor();
    operations = await page.evaluate(() => window.__nutritionFixture.operations);
    assert.equal(operations[3].operationId, operations[4].operationId);

    // Library additions retain their selected tab and filter, too.
    await page.getByRole("tab", { name: "Favorites", exact: true }).click();
    await page.getByRole("button", { name: "Details for Saved oats", exact: true }).click();
    await page.getByRole("button", { name: "Add to Breakfast", exact: true }).click();
    await search.waitFor();
    assert.equal(await search.inputValue(), "oats");
    assert.equal(
      await page.getByRole("tab", { name: "Favorites", exact: true }).getAttribute("aria-selected"),
      "true"
    );
    await page.getByRole("button", { name: "Add one serving of Saved oats", exact: true }).click();
    await page
      .getByRole("region", { name: "Notifications" })
      .getByText("Added Saved oats to Breakfast.", { exact: true })
      .waitFor();
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Add one serving of Saved oats"]').disabled
    );
    await page.keyboard.press("Escape");
    await page.locator(".nutrition-screen").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Edit Coffee With Steamed Milk", exact: true }).click();
    await page.getByLabel("Portion amount").fill("2");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.locator(".nutrition-screen").waitFor({ state: "detached" });
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1),
      false
    );
    assert.deepEqual(blocked, []);
    assert.deepEqual(errors, []);
    console.log(
      `${width}px: repeated plus/detail additions, portions, search/scroll retention, retry, favorites, and diary editing passed`
    );
    await context.close();
  }
} catch (error) {
  if (currentPage) {
    console.error(await currentPage.locator("body").innerText());
    console.error(await currentPage.evaluate(() => window.__nutritionFixture));
    await currentPage.screenshot({ path: path.join(output, "nutrition-search-failure.png") });
  }
  throw error;
} finally {
  await browser.close();
}
