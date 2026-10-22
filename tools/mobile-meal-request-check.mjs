// Production UI with disposable local APIs only. Never writes to user/provider accounts.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url),
  playwright = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    )
  );
const origin = process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:5399",
  out = "artifacts/mobile-stability/meal-request-economy";
await fs.mkdir(out, { recursive: true });
const browser = await playwright[process.env.MOBILE_BROWSER_ENGINE || "chromium"].launch({
  headless: true,
  ...(process.env.MOBILE_BROWSER_ENGINE ? {} : { channel: "msedge" }),
});
const checks = [];
let currentPage;
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
    timezoneId: "America/Chicago",
  });
  const page = await context.newPage(),
    calls = [],
    errors = [];
  currentPage = page;
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("Browser console: " + message.text());
  });
  await page.route("**/*", (route) => {
    const request = route.request(),
      url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    const api = url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
    if (api.startsWith("nutrition"))
      calls.push({ api, method: request.method(), body: request.postDataJSON() });
    return route.continue();
  });
  await page.goto(origin + "/nutrition", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Add lunch", exact: true }).click();
  const search = page.getByPlaceholder("Search foods or brands");
  await search.waitFor();
  const baseline = calls.filter((call) => call.api === "nutrition" && call.method === "GET").length;
  const foods = [
    ["rolled oats", "Rolled oats"],
    ["grilled chicken", "Grilled chicken breast"],
    ["white rice", "White rice cooked"],
    ["salmon", "Salmon grilled"],
    ["apple", "Apple"],
    ["whole milk", "Whole milk"],
  ];
  for (const [query, name] of foods) {
    await search.fill(query);
    const add = page.getByRole("button", { name: `Add one serving of ${name}`, exact: true });
    await add.waitFor();
    await add.click();
    await page
      .locator(".app-toast")
      .filter({ hasText: new RegExp(`Added ${name} to Lunch`, "i") })
      .waitFor();
    await page.waitForFunction(
      () => !Object.keys(localStorage).some((key) => key.startsWith("nutrition-write-pending:"))
    );
  }
  const mealCalls = [...calls],
    diaryReads = mealCalls.filter(
      (call) => call.api === "nutrition" && call.method === "GET"
    ).length;
  assert.equal(diaryReads, baseline, "Adding foods must not rehydrate the entire diary/history");
  assert.equal(
    mealCalls.filter((call) => call.api === "nutrition/entries" && call.method === "POST").length,
    6
  );
  assert.equal(mealCalls.filter((call) => call.api === "nutrition/search").length, 6);
  assert.equal(mealCalls.filter((call) => call.api === "nutrition/product").length, 6);
  await page.screenshot({ path: path.join(out, "six-food-meal.png") });
  await page.keyboard.press("Escape");
  await page.locator(".nutrition-screen").waitFor({ state: "detached" });
  // Independently read the disposable server, rather than claiming a device cache proves persistence.
  const date = await page.evaluate(
    () => JSON.parse(localStorage.getItem("training-agent-nutrition-startup-v1")).view.date
  );
  const persisted = await (
    await context.request.get(`${origin}/api/nutrition?date=${date}`)
  ).json();
  for (const [, name] of foods)
    assert.equal(
      persisted.day.entries.filter(
        (entry) =>
          entry.meal === "lunch" && entry.name.toLowerCase().split(" · ")[0] === name.toLowerCase()
      ).length,
      1
    );
  await page.reload({ waitUntil: "networkidle" });
  for (const [, name] of foods)
    await page.getByRole("button", { name: new RegExp(`^Edit ${name}(?: · .*)?$`, "i") }).waitFor();
  const reloadReads =
    calls.filter((call) => call.api === "nutrition" && call.method === "GET").length - diaryReads;
  assert.equal(
    reloadReads,
    0,
    "A fresh confirmed device snapshot must not start another provider diary fetch on reload"
  );
  assert.deepEqual(errors, []);
  checks.push({
    width: 390,
    foods: 6,
    normalSaveRequests: 6,
    searchRequests: 6,
    detailRequests: 6,
    diaryReadsDuringMeal: diaryReads - baseline,
    diaryReadsOnReload: reloadReads,
    providerWrites: false,
    persistence: "Independent disposable backend read confirmed each food exactly once",
    errors,
  });
  console.log(JSON.stringify(checks[0]));
  await context.close();
} catch (error) {
  if (currentPage) {
    const body = await currentPage.locator("body").innerText();
    console.log(body.slice(-3000));
    await fs.writeFile(path.join(out, "failure.txt"), body);
    await currentPage.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  await fs.writeFile(path.join(out, "checks.json"), JSON.stringify(checks, null, 2));
  await browser.close();
}
