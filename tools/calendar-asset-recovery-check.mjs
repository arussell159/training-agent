// Disposable desktop-preview only; never touches a live account or Supabase.
// APP_TEST_ORIGIN=http://127.0.0.1:5327 node tools/calendar-asset-recovery-check.mjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5337";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(origin).hostname));
const output = path.resolve("artifacts/calendar-asset-recovery");
await fs.mkdir(output, { recursive: true });
const server = process.env.APP_TEST_ORIGIN
  ? null
  : spawn(process.execPath, ["tools/desktop-preview.mjs", "--calendar-edits", "--port=5337"], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
if (server) {
  process.on("exit", () => server.kill());
  await new Promise((resolve, reject) => {
    const deadline = setTimeout(() => reject(Error("Local preview did not start")), 10000);
    server.on("error", reject);
    server.stdout.on("data", (value) => {
      if (String(value).includes("http://127.0.0.1:5337")) {
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
const browser = await playwright.chromium.launch({ headless: true, channel: "msedge" });
const context = await browser.newContext({
  viewport: { width: 1280, height: 820 },
  colorScheme: "light",
  serviceWorkers: "block",
});
const page = await context.newPage();
page.setDefaultTimeout(15000);
const evidence = {
  conditions:
    "production build, local disposable preview, injected editor CSS 503; zero live provider/database requests",
  stylesheetAttempts: 0,
  externalRequests: [],
  bootstrapRequests: [],
  providerWrites: [],
  checks: [],
};
let missing = true;
await context.route("**/*", (route) => {
  const request = route.request(),
    url = new URL(request.url());
  if (url.origin !== origin) {
    evidence.externalRequests.push(url.origin);
    return route.abort();
  }
  if (/\/assets\/workout-editor-[\w-]+\.css$/.test(url.pathname)) {
    evidence.stylesheetAttempts++;
    if (missing)
      return route.fulfill({
        status: 503,
        contentType: "text/plain",
        body: "Simulated retired stylesheet",
      });
  }
  if (request.method() !== "GET" && url.pathname.startsWith("/api/")) {
    const routeName = url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
    if (routeName === "training-live") evidence.bootstrapRequests.push(routeName);
    else evidence.providerWrites.push(routeName);
  }
  return route.continue();
});
try {
  await page.goto(origin + "/calendar?theme=light");
  const add = page.getByRole("button", { name: /^Add workout for / }).first();
  const addLabel = await add.getAttribute("aria-label");
  await page
    .locator(".calendar-day-cell")
    .filter({ has: page.getByRole("button", { name: addLabel, exact: true }) })
    .locator(".mobile-calendar-day-heading")
    .hover();
  await add.click();
  await page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click();
  await page.getByLabel("Workout title", { exact: true }).fill("Retain this unsaved title");
  await page
    .getByLabel("Workout description", { exact: true })
    .fill("Retain this unsaved description");
  await page
    .locator(".desktop-new-workout-build")
    .getByRole("button", { name: "Build Workout", exact: true })
    .click();
  await page.getByRole("heading", { name: "Workout editor couldn’t load" }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "This view couldn’t load" }).count(), 0);
  await page.screenshot({
    path: path.join(output, "contained-failure.png"),
    animations: "disabled",
  });
  evidence.checks.push(
    "Missing editor CSS is contained to editor overlay; Calendar and parent form remain mounted."
  );
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  assert.equal(
    await page.getByRole("button", { name: "Try again", exact: true }).isDisabled(),
    true
  );
  evidence.checks.push(
    "One explicit retry settles without a reload loop when CSS is still unavailable."
  );
  await page.getByRole("button", { name: "Return to workout", exact: true }).click();
  assert.equal(
    await page.getByLabel("Workout title", { exact: true }).inputValue(),
    "Retain this unsaved title"
  );
  assert.equal(
    await page.getByLabel("Workout description", { exact: true }).inputValue(),
    "Retain this unsaved description"
  );
  evidence.checks.push(
    "Returning from failure preserves title and description without provider writes."
  );
  missing = false;
  await page
    .locator(".desktop-new-workout-build")
    .getByRole("button", { name: "Build Workout", exact: true })
    .click();
  await page.locator(".dtb-workspace").waitFor({ state: "visible" });
  const styles = await page.evaluate(() =>
    [...document.querySelectorAll('link[rel="stylesheet"]')]
      .filter((link) => /\/workout-editor-[\w-]+\.css$/.test(link.href))
      .map((link) => ({ href: link.href, loaded: Boolean(link.sheet) }))
  );
  assert.ok(styles.length && styles.every((style) => style.loaded));
  assert.equal(await page.getByRole("heading", { name: "This view couldn’t load" }).count(), 0);
  evidence.checks.push("A subsequent open restores the stylesheet before the editor renders.");
  await page.screenshot({
    path: path.join(output, "recovered-builder.png"),
    animations: "disabled",
  });
  assert.equal(evidence.providerWrites.length, 0, JSON.stringify(evidence.providerWrites));
  assert.equal(evidence.externalRequests.length, 0);
  evidence.checks.push(
    "All typing, error handling and recovery produced zero provider/database writes and zero external requests."
  );
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(evidence, null, 2));
  await Promise.all(
    ["failure.json", "failure.png"].map((name) => fs.rm(path.join(output, name), { force: true }))
  );
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, "failure.png"), animations: "disabled" });
  await fs.writeFile(
    path.join(output, "failure.json"),
    JSON.stringify(
      { ...evidence, error: error.message, body: await page.locator("body").innerText() },
      null,
      2
    )
  );
  throw error;
} finally {
  await browser.close();
  server?.kill();
}
