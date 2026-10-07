// Start the isolated Vite server before running this check. Every API is mocked.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); }
catch { playwright = require(path.join(os.homedir(), ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright")); }
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5177";
const browser = await playwright.chromium.launch({ headless: true, channel: process.env.APP_TEST_BROWSER || "msedge" });
const output = path.resolve("artifacts/reliability");
await fs.mkdir(output, { recursive: true });
const results = [];
const session = (recent = false) => ({
  configured: true, authenticated: true, hasPasskey: true, passkeysSupported: true,
  expiresAt: Date.now() + 86_400_000, verifiedAt: Date.now() - (recent ? 0 : 1_200_000),
  recentlyVerified: recent, remember: true,
  passkeys: [{ id: "fixture-passkey", name: "Fixture key", created: Date.now() - 86_400_000 }],
});
const gate = () => {
  let enter, release;
  return {
    entered: new Promise((resolve) => { enter = resolve; }),
    released: new Promise((resolve) => { release = resolve; }),
    enter: () => enter(), release: () => release(),
  };
};

async function fixture(mode, search = "") {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await context.addInitScript(() => { window.__authFixtureIntercepted = true; });
  const requests = [], errors = [], unexpected = [], held = gate();
  let sessionReads = 0;
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/")) return route.continue();
    const api = url.searchParams.get("__api_route") || url.pathname.slice(5);
    requests.push(api);
    let body;
    if (api === "auth/session") {
      sessionReads++;
      if (mode.startsWith("cold") && sessionReads === 1) { held.enter(); await held.released; }
      body = session();
    } else if (api === "reliability-fixture") {
      held.enter(); await held.released; body = { value: "protected fixture ready" };
    } else if (api === "auth/password") {
      held.enter(); await held.released; body = session(true);
    } else if (api === "auth/passkeys/remove") body = { ok: true };
    else { unexpected.push(api); return route.abort(); }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/tests/auth.html${search}`, { waitUntil: "domcontentloaded" });
  return { context, page, requests, errors, unexpected, held };
}

try {
  const current = await fixture("refresh");
  await current.page.locator("#fixture-workspace").waitFor();
  await current.page.locator("#fixture-api-load").click();
  await current.held.entered;
  await current.page.locator("#fixture-session-refresh").click();
  await current.page.waitForFunction(() => document.querySelector("#fixture-refresh-result")?.textContent === "complete");
  current.held.release();
  await current.page.waitForFunction(() => document.querySelector("#fixture-api-result")?.textContent === "200:protected fixture ready");
  assert.equal(current.requests.filter((api) => api === "auth/session").length, 2);
  assert.equal(current.requests.filter((api) => api === "reliability-fixture").length, 1);
  assert.deepEqual(current.errors, []);
  assert.deepEqual(current.unexpected, []);
  results.push({ scenario: "refresh-preserves-inflight-request", requests: current.requests, errors: current.errors });
  await current.context.close();

  for (const event of ["app-auth-required", "storage"]) {
    const current = await fixture(event);
    await current.page.locator("#fixture-workspace").waitFor();
    await current.page.locator("#verify-password").fill("isolated fixture password");
    await current.page.getByRole("button", { name: "Remove", exact: true }).click();
    await current.held.entered;
    await current.page.evaluate((event) => {
      if (event === "storage") window.dispatchEvent(new StorageEvent("storage", { key: "training-app-signed-out", newValue: "fixture" }));
      else window.dispatchEvent(new Event(event));
    }, event);
    await current.page.locator("#fixture-workspace").waitFor({ state: "detached" });
    current.held.release();
    await current.page.waitForTimeout(250);
    assert.equal(await current.page.locator("#fixture-workspace").count(), 0, `${event}: pending confirmation reopened private app`);
    assert.equal(current.requests.filter((api) => api === "auth/passkeys/remove").length, 0, `${event}: passkey action continued after signout`);
    assert.equal(current.requests.filter((api) => api === "auth/password").length, 1);
    assert.deepEqual(current.errors, []);
    assert.deepEqual(current.unexpected, []);
    await current.page.screenshot({ path: path.join(output, `auth-${event}.png`), fullPage: true });
    results.push({ scenario: `pending-confirmation-${event}`, requests: current.requests, errors: current.errors });
    await current.context.close();
  }

  const cold = await fixture("cold-signout");
  await cold.held.entered;
  await cold.page.evaluate(() => window.dispatchEvent(new StorageEvent("storage", { key: "training-app-signed-out", newValue: "fixture" })));
  cold.held.release();
  await cold.page.getByText("Your training starts here", { exact: true }).waitFor();
  await cold.page.waitForTimeout(100);
  assert.equal(await cold.page.locator("#fixture-workspace").count(), 0, "Initial stale session reopened app after cross-tab signout");
  assert.equal(await cold.page.locator("[aria-busy=true]").count(), 0, "Initial cross-tab signout stranded startup loading");
  assert.deepEqual(cold.errors, []);
  assert.deepEqual(cold.unexpected, []);
  results.push({ scenario: "cold-signout-does-not-strand-loading", requests: cold.requests, errors: cold.errors });
  await cold.context.close();

  for (const valid of [true, false]) {
    const target = { kind: "weekly", startDate: valid ? "2024-02-29" : "2026-02-31" };
    const current = await fixture("cold-report", `?report=${encodeURIComponent(JSON.stringify(target))}`);
    await current.held.entered;
    await current.page.getByLabel(valid ? "Loading report" : "Loading dashboard", { exact: true }).waitFor();
    assert.equal(await current.page.getByLabel(valid ? "Loading dashboard" : "Loading report", { exact: true }).count(), 0);
    current.held.release();
    results.push({ scenario: valid ? "valid-report-startup-placeholder" : "invalid-report-default-placeholder", requests: current.requests });
    await current.context.close();
  }

  await fs.writeFile(path.join(output, "auth-results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); }
