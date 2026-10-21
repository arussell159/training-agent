// Repeatable lab samples. Production UI, disposable APIs, no provider requests.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);
const { chromium } = require(
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  )
);
const dist = process.env.PERF_DIST || "ui/dist",
  phase = process.env.PERF_PHASE || "after";
const n = Number(process.env.PERF_SAMPLES || 12),
  coldSamples = Number(process.env.PERF_COLD_SAMPLES ?? n),
  port = Number(process.env.PERF_PORT || 5297),
  origin = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`, `--dist=${dist}`],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let browser;
const result = {
  conditions: {
    dist,
    n,
    coldSamples,
    viewport: { width: 390, height: 844 },
    network:
      "40ms RTT,40Mbps down/10Mbps up; 4x CPU slowdown; local uncompressed production build + in-memory synthetic backend; no service worker; new context per cold sample",
    method:
      "Cold useful=populated .home-athlete-name + next frame. Add opening=trusted click to enabled search input + next frame. LCP/CLS lab observers; no field INP measurement.",
  },
  coldUseful: [],
  lcp: [],
  cls: [],
  warmAdd: [],
};
async function prepare(page) {
  await page
    .context()
    .route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: 5_000_000,
    uploadThroughput: 1_250_000,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(() => {
    window.__vitals = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__vitals.lcp = e.startTime;
    }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
}
try {
  await new Promise((res, rej) => {
    server.stdout.once("data", res);
    server.once("error", rej);
    server.once("exit", (c) => rej(Error(`preview exited ${c}`)));
  });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  result.conditions.browser = browser.version();
  result.conditions.cpu = os.cpus()[0]?.model;
  for (let i = 0; i < coldSamples; i++) {
    const ctx = await browser.newContext({
        viewport: result.conditions.viewport,
        isMobile: true,
        hasTouch: true,
        serviceWorkers: "block",
      }),
      page = await ctx.newPage();
    await prepare(page);
    await page.goto(origin + "/?benchmark=1", { waitUntil: "domcontentloaded" });
    await page.locator(".home-athlete-name").waitFor();
    result.coldUseful.push(
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => r(performance.now())))
      )
    );
    await page.waitForLoadState("networkidle");
    const vitals = await page.evaluate(() => window.__vitals);
    result.lcp.push(vitals.lcp);
    result.cls.push(vitals.cls);
    await ctx.close();
    console.log(`cold ${i + 1}/${n}`);
  }
  const ctx = await browser.newContext({
      viewport: result.conditions.viewport,
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    }),
    page = await ctx.newPage();
  await prepare(page);
  await page.goto(origin + "/nutrition", { waitUntil: "networkidle" });
  // Resolve first-open code/control initialization before measuring warm opens.
  await page.getByRole("button", { name: "Add breakfast", exact: true }).click();
  await page.getByPlaceholder("Search foods or brands").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".nutrition-screen").waitFor({ state: "detached" });
  for (let i = 0; i < n; i++) {
    await page.evaluate(() => {
      window.__openMs = null;
      document.addEventListener(
        "click",
        () => {
          const start = performance.now(),
            check = () => {
              const e = document.querySelector('input[placeholder="Search foods or brands"]');
              if (e && !e.disabled)
                requestAnimationFrame(() => {
                  window.__openMs = performance.now() - start;
                });
              else requestAnimationFrame(check);
            };
          check();
        },
        { once: true, capture: true }
      );
    });
    await page.getByRole("button", { name: "Add breakfast", exact: true }).click();
    await page.waitForFunction(() => window.__openMs !== null);
    result.warmAdd.push(await page.evaluate(() => window.__openMs));
    await page.keyboard.press("Escape");
    await page.locator(".nutrition-screen").waitFor({ state: "detached" });
  }
  for (const key of ["coldUseful", "lcp", "cls", "warmAdd"]) {
    const values = [...result[key]].sort((a, b) => a - b);
    result[key + "Summary"] = {
      median: values[Math.floor(values.length / 2)],
      p95: values[Math.ceil(values.length * 0.95) - 1],
      min: values[0],
      max: values.at(-1),
    };
  }
  console.log(
    JSON.stringify(
      Object.fromEntries(Object.entries(result).filter(([k]) => k.endsWith("Summary")))
    )
  );
  assert.equal(result.coldUseful.length, coldSamples);
} finally {
  await fs.mkdir("artifacts/mobile-stability", { recursive: true });
  await fs.writeFile(
    `artifacts/mobile-stability/performance-${phase}.json`,
    JSON.stringify(result, null, 2) + "\n"
  );
  await browser?.close();
  server.kill();
}
