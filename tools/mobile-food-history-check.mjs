// Isolated partial-history and first-account states against the production UI.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  )
);
const origin = process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:5296",
  checks = [];
const browser = await chromium.launch({ headless: true, channel: "msedge" });
try {
  for (const mode of ["partial", "empty"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    });
    let reads = 0,
      searches = 0;
    await context.route("**/*", async (route) => {
      const url = new URL(route.request().url()),
        api = url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
      if (url.origin !== origin) return route.abort();
      if (api === "nutrition/search") searches++;
      if (api === "nutrition" || (mode === "empty" && api === "nutrition/library")) {
        const response = await route.fetch(),
          body = await response.json();
        if (api === "nutrition") {
          reads++;
          if (mode === "partial") {
            body.week[0] = {
              ...body.week[0],
              logged: true,
              totals: null,
              unavailable: true,
              error: "Synthetic historical provider failure.",
            };
            body.recentDays = [];
          } else {
            body.day.entries = [];
            body.recentDays = [];
            body.week = body.week.map((d) => ({
              ...d,
              logged: false,
              totals: { calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 },
            }));
          }
        } else body.items = [];
        return route.fulfill({ response, json: body });
      }
      return route.continue();
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin + "/nutrition", { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Your meals", exact: true }).waitFor();
    if (mode === "partial") {
      await page.getByText(/Some previous days could not load/).waitFor();
      assert.ok(await page.getByRole("button", { name: /food totals unavailable/ }).count());
      await page
        .locator(".nutrition-week-card")
        .screenshot({ path: "artifacts/mobile-stability/partial-history-390.png" });
      const average = await page
        .getByLabel("Average daily nutrition over the last 7 days", { exact: true })
        .innerText();
      assert.equal(
        /\d/.test(average),
        false,
        "Unknown history must not show numeric complete averages"
      );
      const count = reads;
      await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).searchParams.get("__api_route") === "nutrition" ||
            new URL(r.url()).pathname === "/api/nutrition"
        ),
        page.getByRole("button", { name: "Retry previous days", exact: true }).click(),
      ]);
      assert.ok(reads > count);
    }
    await page.getByRole("button", { name: "Add breakfast", exact: true }).click();
    const input = page.getByPlaceholder("Search foods or brands");
    await input.waitFor();
    assert.equal(
      await page.getByRole("tab", { name: "All", exact: true }).getAttribute("aria-selected"),
      "true"
    );
    assert.equal(searches, 0, "Opening All does not request a catalog search");
    await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).searchParams.get("__api_route") === "nutrition/search" ||
          new URL(r.url()).pathname === "/api/nutrition/search"
      ),
      input.fill("banana"),
    ]);
    await page.locator(".nutrition-result").first().waitFor();
    assert.ok(searches > 0);
    assert.deepEqual(errors, []);
    checks.push({ mode, passed: true, reads, searches });
    console.log(JSON.stringify(checks.at(-1)));
    await context.close();
  }
} finally {
  await fs.mkdir("artifacts/mobile-stability", { recursive: true });
  await fs.writeFile("artifacts/mobile-stability/history.json", JSON.stringify(checks, null, 2));
  await browser.close();
}
