// Disposable, synthetic production-preview benchmark. Never accesses provider data.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
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
const dist = process.env.PERF_DIST || "ui/dist";
const output = process.env.PERF_OUTPUT || "artifacts/performance-2026-10-21/after.json";
const samples = Number(process.env.PERF_SAMPLES || 40),
  port = Number(process.env.PERF_PORT || 5243);
assert.ok(samples >= 2 && samples <= 100);
const server = spawn(
  process.execPath,
  ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`, `--dist=${dist}`],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let browser;
const results = {
  conditions: {
    dist,
    samples,
    viewport: { width: 1280, height: 820 },
    deviceScaleFactor: 1,
    network:
      "CDP 40ms latency; 40Mbps down / 10Mbps up; no CPU throttle; HTTP no compression; localhost synthetic preview",
    cache:
      "Cold: new browser context per sample; warm: same page and module/cache after first open",
    method:
      "Cold: navigation start to populated calendar cards + next animation frame (paint proxy). Interaction: trusted click event to predicate of interactive content and next animation frame, excluding Playwright actionability waiting.",
  },
  coldLoad: [],
  warmSummary: [],
  warmNewWorkout: [],
  calendarWeek: [],
};
async function network(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: 40_000_000 / 8,
    uploadThroughput: 10_000_000 / 8,
  });
}
async function measure(page, trigger, predicate) {
  await page.evaluate((source) => {
    window.__perfDone = null;
    const ready = new Function(`return (${source})()`);
    document.addEventListener(
      "click",
      () => {
        const start = performance.now();
        const check = () => {
          if (ready())
            requestAnimationFrame(() => {
              window.__perfDone = performance.now() - start;
            });
          else requestAnimationFrame(check);
        };
        check();
      },
      { once: true, capture: true }
    );
  }, predicate.toString());
  await trigger();
  await page.waitForFunction(() => window.__perfDone !== null);
  return page.evaluate(() => window.__perfDone);
}
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(Error(`Preview exited ${code}`)));
  });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  results.conditions.browser = browser.version();
  results.conditions.os = `${os.platform()} ${os.release()} ${os.arch()}`;
  results.conditions.cpu = os.cpus()[0]?.model;
  results.conditions.logicalCpus = os.cpus().length;
  for (let i = 0; i < samples; i++) {
    const context = await browser.newContext({
      viewport: results.conditions.viewport,
      deviceScaleFactor: 1,
      colorScheme: "light",
    });
    const page = await context.newPage();
    await network(page);
    await page.goto(`http://127.0.0.1:${port}/calendar?theme=light&benchmark=1`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll("[data-workout-id]")].some(
          (node) => node.getBoundingClientRect().height > 0
        ) &&
        document.querySelector('button[aria-label="Next calendar week"]') &&
        !document.querySelector("[data-workout-id]")?.getAttribute("aria-busy")
    );
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
    results.coldLoad.push(await page.evaluate(() => performance.now()));
    if (i % 10 === 9) console.log(`cold ${i + 1}/${samples}`);
    await context.close();
  }
  const context = await browser.newContext({
      viewport: results.conditions.viewport,
      deviceScaleFactor: 1,
      colorScheme: "light",
    }),
    page = await context.newPage();
  await network(page);
  await page.goto(`http://127.0.0.1:${port}/calendar?theme=light`, { waitUntil: "networkidle" });
  const fixture = await (
    await page.request.get(`http://127.0.0.1:${port}/api/training-context?scope=full`)
  ).json();
  results.conditions.dataset = {
    history: fixture.history.length,
    planned: fixture.planned.length,
    retentionDays: fixture.retention_days,
  };
  const card = page.locator("[data-workout-id]").filter({ hasText: "Editable run workout" });
  await card.click();
  await page.getByLabel("Planned duration", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  for (let i = 0; i < samples; i++) {
    results.warmSummary.push(
      await measure(
        page,
        () => card.click(),
        () => {
          const field = document.querySelector(
            '[role="dialog"] input[aria-label="Planned duration"]'
          );
          return !!field && !field.disabled && !!document.querySelector(".desktop-workout-header");
        }
      )
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  for (let i = 0; i < samples; i++) {
    const before = await page.evaluate(() => scrollY);
    results.calendarWeek.push(
      await measure(
        page,
        () =>
          page
            .getByRole("button", {
              name: i % 2 ? "Previous calendar week" : "Next calendar week",
              exact: true,
            })
            .click(),
        new Function(`return scrollY!==${before} && !!document.querySelector('[data-workout-id]')`)
      )
    );
  }
  await page.getByRole("button", { name: "Today", exact: true }).click();
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 3);
  const plus = page.getByRole("button", {
    name: `Add workout for ${tomorrow.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`,
    exact: true,
  });
  for (let i = 0; i < samples; i++) {
    await plus.evaluate((node) => node.scrollIntoView({ block: "center" }));
    const bounds = await plus.boundingBox();
    await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    await page.waitForFunction(
      (label) =>
        getComputedStyle(
          [...document.querySelectorAll("button")].find(
            (node) => node.getAttribute("aria-label") === label
          )
        ).pointerEvents !== "none",
      await plus.getAttribute("aria-label")
    );
    await plus.click();
    results.warmNewWorkout.push(
      await measure(
        page,
        () => page.getByRole("dialog").getByRole("button", { name: "Run", exact: true }).click(),
        () => {
          const title = document.querySelector('input[aria-label="Workout title"]');
          return !!title && !title.disabled && !!document.querySelector(".desktop-workout-header");
        }
      )
    );
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  const summarize = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return {
      n: values.length,
      min: sorted[0],
      median: sorted[Math.ceil(sorted.length * 0.5) - 1],
      p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
      max: sorted.at(-1),
    };
  };
  results.summary = Object.fromEntries(
    ["coldLoad", "warmSummary", "warmNewWorkout", "calendarWeek"].map((key) => [
      key,
      summarize(results[key]),
    ])
  );
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(results, null, 2) + "\n");
  console.log(JSON.stringify(results.summary, null, 2));
} finally {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(results, null, 2) + "\n");
  await browser?.close();
  server.kill();
}
