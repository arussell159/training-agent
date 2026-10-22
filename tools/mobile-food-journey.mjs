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
const origin = process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:5296",
  out =
    "artifacts/mobile-stability/food" +
    (process.env.MOBILE_BROWSER_ENGINE ? "-" + process.env.MOBILE_BROWSER_ENGINE : "");
await fs.mkdir(out, { recursive: true });
const browser = await playwright[process.env.MOBILE_BROWSER_ENGINE || "chromium"].launch({
    headless: true,
    ...(process.env.MOBILE_BROWSER_ENGINE ? {} : { channel: "msedge" }),
    ...(process.env.MOBILE_BROWSER_EXECUTABLE
      ? { executablePath: process.env.MOBILE_BROWSER_EXECUTABLE }
      : {}),
  }),
  checks = [];
let currentPage, currentWrites;
const api = (url) => url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
try {
  for (const width of [320, 390, 844, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 844 ? 390 : 844 },
      isMobile: width < 768 || width === 844,
      hasTouch: width !== 1440,
      timezoneId: "America/Chicago",
      serviceWorkers: "block",
    });
    let failSearch = false,
      loseSave = false,
      rejectSave = false;
    const writes = [],
      errors = [];
    await context.route("**/*", async (route) => {
      const req = route.request(),
        url = new URL(req.url()),
        name = api(url);
      if (url.origin !== origin) return route.abort();
      if (name === "nutrition/search" && failSearch)
        return route.fulfill({
          status: 429,
          contentType: "application/json",
          body: JSON.stringify({ error: "FatSecret request limit reached. Retry shortly." }),
        });
      if (name === "nutrition/search" && url.searchParams.get("q") === "oats")
        await new Promise((r) => setTimeout(r, 700));
      if (name === "nutrition/entries" && req.method() === "POST") {
        writes.push(req.postDataJSON());
        console.log(
          JSON.stringify({
            write: writes.length,
            action: req.postDataJSON().action,
            rejectSave,
            loseSave,
          })
        );
        if (rejectSave) {
          rejectSave = false;
          return route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ error: "Synthetic save unavailable. Retry." }),
          });
        }
        if (loseSave) {
          loseSave = false;
          await route.fetch();
          return route.abort("connectionreset");
        }
      }
      return route.continue();
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.addEventListener("click", (event) => {
        const button = event.target.closest?.("button");
        if (!/^Add (breakfast|lunch|dinner|snacks)$/.test(button?.getAttribute("aria-label") || "")) return;
        window.__foodAddFocus = {
          trusted: event.isTrusted,
          searchActive: document.activeElement?.matches('input[placeholder="Search foods or brands"]'),
        };
      });
    });
    currentPage = page;
    currentWrites = writes;
    page.on("pageerror", (e) => errors.push(e.message));
    page.setDefaultTimeout(12000);
    await page.goto(origin + "/nutrition", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add breakfast", exact: true }).waitFor();
    const salmonBefore = await page.getByRole("button", { name: /^Edit Salmon Grilled$/i }).count();
    await page.getByRole("button", { name: "Add breakfast", exact: true }).click();
    const search = page.getByPlaceholder("Search foods or brands");
    await search.waitFor();
    if (width !== 1440) {
      assert.equal(await search.evaluate(input => document.activeElement === input), true);
      assert.deepEqual(await page.evaluate(() => window.__foodAddFocus), {trusted:true,searchActive:true}, "Search focuses within the original mobile Add tap");
    }
    assert.equal(
      await page.getByRole("tab", { name: "All", exact: true }).getAttribute("aria-selected"),
      "true"
    );
    await page.getByRole("tab", { name: "Type", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.locator(".nutrition-screen").waitFor({ state: "detached" });
    await page.getByRole("button", { name: "Add breakfast", exact: true }).click();
    if (width !== 1440) {
      assert.equal(await search.evaluate(input => document.activeElement === input), true);
      await page.keyboard.type("oats");
      assert.equal(await search.inputValue(), "oats", "Typing works immediately without tapping Search");
    }
    assert.equal(
      await page.getByRole("tab", { name: "All", exact: true }).getAttribute("aria-selected"),
      "true"
    );
    await search.fill("oats");
    await page.waitForTimeout(300);
    await search.fill("chicken");
    await page
      .getByRole("button", { name: "Details for Grilled chicken breast", exact: true })
      .waitFor();
    await page.waitForTimeout(800);
    assert.equal(
      await page.getByRole("button", { name: "Details for Rolled oats", exact: true }).count(),
      0
    );
    failSearch = true;
    await search.fill("rice");
    await page.getByRole("alert").filter({ hasText: "request limit" }).waitFor();
    assert.equal(await page.getByText("No complete matches found", { exact: true }).count(), 0);
    failSearch = false;
    await page.getByRole("button", { name: "Retry search", exact: true }).click();
    await page.getByRole("button", { name: "Details for White rice cooked", exact: true }).click();
    await page.getByLabel("Portion amount", { exact: true }).fill("1.25");
    rejectSave = true;
    await page.getByRole("button", { name: "Add to Breakfast", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Synthetic save unavailable" }).waitFor();
    assert.equal(await page.getByLabel("Portion amount", { exact: true }).inputValue(), "1.25");
    await page.getByRole("button", { name: "Add to Breakfast", exact: true }).click();
    await search.waitFor();
    assert.equal(
      writes.at(-1).operationId,
      writes.at(-2).operationId,
      "Retry must preserve operation identity"
    );
    await page
      .locator(".app-toast")
      .filter({ hasText: /Added White rice cooked to Breakfast/i })
      .waitFor();
    await page.screenshot({ path: path.join(out, `confirmation-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.locator(".nutrition-screen").waitFor({ state: "detached" });
    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByRole("button", { name: /^Edit White Rice Cooked$/i })
      .last()
      .waitFor();
    // Commit succeeds but transport response is lost. Reload must retry exact ID.
    await page.getByRole("button", { name: "Add breakfast", exact: true }).click();
    await search.fill("salmon");
    const add = page.getByRole("button", {
      name: "Add one serving of Salmon grilled",
      exact: true,
    });
    await add.waitFor();
    loseSave = true;
    await add.click();
    await page
      .getByRole("alert")
      .filter({ hasText: /failed|network|fetch|connection|request|respond/i })
      .waitFor();
    const lost = writes.at(-1);
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(
      () => !Object.keys(localStorage).some((k) => k.startsWith("nutrition-write-pending:"))
    );
    assert.equal(writes.at(-1).operationId, lost.operationId);
    assert.equal(
      await page.getByRole("button", { name: /^Edit Salmon Grilled$/i }).count(),
      salmonBefore + 1
    );
    // Offline retains local foods and settles search into an explicit failure.
    await page.getByRole("button", { name: "Add breakfast", exact: true }).click();
    await context.setOffline(true);
    await search.fill("offline search");
    await page
      .getByRole("alert")
      .filter({ hasText: /offline/i })
      .waitFor();
    await context.setOffline(false);
    await page.getByRole("button", { name: "Clear food search", exact: true }).click();
    await page.getByText(/Recent foods ·/).waitFor();
    await page.goBack();
    await page.locator(".nutrition-screen").waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.getElementById("root").inert), false);
    assert.equal(await page.getByRole("button", {name:"Add breakfast",exact:true}).evaluate(button=>document.activeElement===button), true, "Back returns focus to the Add button");
    assert.deepEqual(errors, []);
    checks.push({
      width,
      passed: true,
      writes: writes.length,
      checks: [
        ...(width !== 1440 ? ["Mobile Add focuses search within trusted tap; keyboard typing needs no second tap"] : []),
        "All on fresh open after Type",
        "debounce/stale search",
        "429 explicit retry",
        "failed save preserves portion and operation",
        "named success",
        "reload persistence",
        "lost response reload recovery without duplicate",
        "offline and clear restores recent",
        "Back restores body/focus",
      ],
    });
    console.log(JSON.stringify(checks.at(-1)));
    await context.close();
  }
} catch (error) {
  if (currentPage) {
    console.log("Failure: " + error.message);
    await fs.writeFile(
      path.join(out, "failure.txt"),
      await currentPage.locator("body").innerText()
    );
    await currentPage
      .screenshot({ path: path.join(out, "failure.png"), timeout: 2000 })
      .catch(() => {});
    console.log(
      JSON.stringify({
        writes: currentWrites,
        body: (await currentPage.locator("body").innerText()).slice(-2500),
      })
    );
  }
  throw error;
} finally {
  await fs.writeFile(path.join(out, "journeys.json"), JSON.stringify(checks, null, 2));
  await browser.close();
}
