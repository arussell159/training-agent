// Controlled synthetic UI benchmark; discards every edit and never contacts providers.
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const require = createRequire(import.meta.url),
  { chromium } = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    )
  );
const port = Number(process.env.PERF_PORT || 5246),
  dist = process.env.PERF_DIST || "ui/dist",
  output = process.env.PERF_OUTPUT || "artifacts/performance-2026-10-21/editors-after.json",
  n = Number(process.env.PERF_SAMPLES || 40);
const server = spawn(
  process.execPath,
  ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`, `--dist=${dist}`],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let browser;
const results = {
  conditions: {
    dist,
    n,
    viewport: { width: 1280, height: 820 },
    network:
      "40ms latency;40Mbps down;10Mbps up;no CPU throttle; synthetic numeric-ID editor fixtures",
    readiness:
      "Trusted Edit click to enabled title, interval cards, profile SVG, actual title focus, then next animation frame (paint proxy)",
  },
  sports: {},
  errors: [],
};
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(Error(`Preview ${code}`)));
  });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  results.conditions.browser = browser.version();
  for (const sport of (process.env.PERF_SPORTS || "run,bike,swim").split(",")) {
    const context = await browser.newContext({
        viewport: results.conditions.viewport,
        colorScheme: "light",
      }),
      page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on("pageerror", (error) =>
      results.errors.push({ sport, type: "pageerror", message: error.message })
    );
    page.on("console", (message) => {
      if (message.type() === "error")
        results.errors.push({ sport, type: "console", message: message.text() });
    });
    page.on("requestfailed", (request) =>
      results.errors.push({
        sport,
        type: "requestfailed",
        url: request.url(),
        failure: request.failure(),
      })
    );
    if (process.env.PERF_DIAGNOSTICS)
      await context.addInitScript(() => {
        window.__editorFrames = [];
        window.__editorLayouts = [];
        for (const name of ["focus", "scrollIntoView"]) {
          const proto = name === "focus" ? HTMLElement.prototype : Element.prototype,
            original = proto[name];
          proto[name] = function (...args) {
            const start = performance.now(),
              result = original.apply(this, args),
              duration = performance.now() - start;
            if (duration > 3)
              window.__editorLayouts.push({
                name,
                duration,
                element: this.tagName,
                className: String(this.className),
                label: this.getAttribute("aria-label"),
                stack: new Error().stack,
              });
            return result;
          };
        }
        for (const name of ["getBoundingClientRect", "getClientRects"]) {
          const original = Element.prototype[name];
          Element.prototype[name] = function (...args) {
            const start = performance.now(),
              result = original.apply(this, args),
              duration = performance.now() - start;
            if (duration > 3)
              window.__editorLayouts.push({
                name,
                duration,
                element: this.tagName,
                className: String(this.className),
                stack: new Error().stack,
              });
            return result;
          };
        }
        for (const name of ["clientWidth", "clientHeight", "scrollHeight", "scrollWidth"]) {
          const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, name);
          if (!descriptor?.get || !descriptor.configurable) continue;
          Object.defineProperty(Element.prototype, name, {
            ...descriptor,
            get() {
              const start = performance.now(),
                result = descriptor.get.call(this),
                duration = performance.now() - start;
              if (duration > 3)
                window.__editorLayouts.push({
                  name,
                  duration,
                  element: this.tagName,
                  className: String(this.className),
                  stack: new Error().stack,
                });
              return result;
            },
          });
        }
        try {
          new PerformanceObserver((list) => {
            window.__editorFrames.push(...list.getEntries().map((entry) => entry.toJSON()));
          }).observe({ type: "long-animation-frame", buffered: true });
        } catch {}
      });
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: 40,
      downloadThroughput: 40_000_000 / 8,
      uploadThroughput: 10_000_000 / 8,
    });
    await page.goto(`http://127.0.0.1:${port}/calendar?theme=light`, { waitUntil: "networkidle" });
    await page
      .locator("[data-workout-id]")
      .filter({ hasText: `Editable ${sport} workout` })
      .click();
    const open = async () => {
      await page.getByRole("button", { name: "Workout actions", exact: true }).click();
      await page
        .locator(".desktop-workout-toolbar-popover")
        .getByRole("button", { name: /Edit workout/i })
        .click();
      try {
        await page.locator('.dtb-workspace input[aria-label="Workout title"]:enabled').waitFor();
        await page.locator(".dtb-step-card").first().waitFor();
      } catch (error) {
        results.failure = {
          sport,
          message: error.message,
          body: await page.locator("body").innerText(),
          inputs: await page
            .locator("input")
            .evaluateAll((inputs) =>
              inputs.map((input) => ({
                label: input.getAttribute("aria-label"),
                value: input.value,
                disabled: input.disabled,
              }))
            ),
          workspaces: await page.locator(".dtb-workspace").count(),
        };
        await fs.mkdir(path.dirname(output), { recursive: true });
        await page.screenshot({
          path: path.join(path.dirname(output), `editor-performance-failure-${sport}.png`),
          animations: "disabled",
        });
        throw error;
      }
    };
    await open();
    await page.getByRole("button", { name: "Close workout builder", exact: true }).click();
    const values = [],
      diagnostics = [];
    for (let i = 0; i < n; i++) {
      await page.getByRole("button", { name: "Workout actions", exact: true }).click();
      await page.evaluate(() => {
        window.__editorPerf = null;
        if (window.__editorLayouts) window.__editorLayouts = [];
        document.addEventListener(
          "click",
          () => {
            const start = performance.now();
            window.__editorPerfStart = start;
            const check = () => {
              if (
                document.querySelector(
                  '.dtb-workspace input[aria-label="Workout title"]:enabled'
                ) &&
                document.querySelector(".dtb-step-card") &&
                document.querySelector(".we-chart svg[data-workout-profile]") &&
                document.activeElement ===
                  document.querySelector('.dtb-workspace input[aria-label="Workout title"]')
              )
                requestAnimationFrame(() => {
                  window.__editorPerf = performance.now() - start;
                });
              else requestAnimationFrame(check);
            };
            check();
          },
          { once: true, capture: true }
        );
      });
      await page
        .locator(".desktop-workout-toolbar-popover")
        .getByRole("button", { name: /Edit workout/i })
        .click();
      await page
        .waitForFunction(() => window.__editorPerf !== null)
        .catch(async (error) => {
          results.failure = await page.evaluate(() => ({
            active: document.activeElement?.outerHTML,
            layouts: window.__editorLayouts,
            workspaces: document.querySelectorAll(".dtb-workspace").length,
          }));
          throw error;
        });
      values.push(await page.evaluate(() => window.__editorPerf));
      if (process.env.PERF_DIAGNOSTICS)
        diagnostics.push(
          await page.evaluate(() => ({
            start: window.__editorPerfStart,
            ms: window.__editorPerf,
            frames: window.__editorFrames.filter(
              (entry) =>
                entry.startTime >= window.__editorPerfStart - 50 &&
                entry.startTime < window.__editorPerfStart + window.__editorPerf + 100
            ),
            layouts: window.__editorLayouts,
            resources: performance
              .getEntriesByType("resource")
              .filter(
                (entry) =>
                  entry.startTime >= window.__editorPerfStart &&
                  entry.startTime < window.__editorPerfStart + window.__editorPerf
              )
              .map((entry) => ({ url: entry.name, duration: entry.duration })),
          }))
        );
      await page.getByRole("button", { name: "Close workout builder", exact: true }).click();
    }
    const sorted = [...values].sort((a, b) => a - b);
    results.sports[sport] = {
      warmOpen: values,
      ...(diagnostics.length ? { diagnostics } : {}),
      summary: {
        n,
        min: sorted[0],
        median: sorted[Math.ceil(n * 0.5) - 1],
        p95: sorted[Math.ceil(n * 0.95) - 1],
        max: sorted.at(-1),
      },
    };
    console.log(sport, results.sports[sport].summary);
    await context.close();
  }
} finally {
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, JSON.stringify(results, null, 2) + "\n");
  await browser?.close();
  server.kill();
}
