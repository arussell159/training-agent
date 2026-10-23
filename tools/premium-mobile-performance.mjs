// Production assets with isolated disposable APIs. No credentials or provider traffic.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
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
  port = Number(process.env.PERF_PORT || 5398),
  origin = `http://127.0.0.1:${port}`;
assert.ok(Number.isInteger(n) && n >= 2 && n <= 100);
const server = spawn(
  process.execPath,
  ["tools/desktop-preview.mjs", "--calendar-edits", `--port=${port}`, `--dist=${dist}`],
  { stdio: ["ignore", "pipe", "pipe"] }
);
const results = {
  conditions: {
    dist,
    phase,
    n,
    viewport: { width: 390, height: 844 },
    timezone: "America/Chicago",
    network: "40 ms latency; 40 Mbps down / 10 Mbps up",
    cpuThrottle: 4,
    statistics: "Empirical median and nearest-rank p95. At n=12, p95 is the observed maximum; this small lab sample is not a population-tail or field estimate.",
    cache:
      "New context for each cold sample; warmed route modules for warm navigation. warmHomeReopen retains device data but reloads uncached assets: fixture uses no-store and service worker is blocked; this is NOT installed-PWA or HTTP-cached resume.",
    backend:
      "In-memory deterministic synthetic APIs; same fixture date, no provider calls; HTTP production assets without compression",
    readiness: {
      home: "Non-loading overview with numeric fitness and a populated workout title and metrics; enabled navigation; next animation frame. Next-day control is exercised to verify responsiveness.",
      calendar:
        "Populated workout title and date cells, enabled mobile options; next animation frame.",
      interactions:
        "Trusted DOM click to populated destination and next animation frame, excluding driver actionability wait.",
    },
  },
  coldHome: [],
  coldCalendar: [],
  warmHomeReopen: [],
  warmHomeToCalendar: [],
  warmCalendarToHome: [],
  homeNextDay: [],
  resources: [],
  errors: [],
};
let browser;
const homeReady = () => {
  const hero = document.querySelector(".home-athlete-hero"),
    sessions = document.querySelector(".home-sessions");
  return (
    hero &&
    hero.getAttribute("aria-busy") !== "true" &&
    /\d/.test(hero.querySelector(".home-fitness-value strong")?.textContent || "") &&
    sessions &&
    sessions.getAttribute("aria-busy") !== "true" &&
    sessions.querySelector(".home-session-tile h3, .home-rest-day h3") &&
    document.querySelector("#mobile-tab-calendar:not(:disabled)")
  );
};
const calendarReady = () =>
  location.pathname === "/calendar" &&
  document.querySelector("[data-calendar-date]") &&
  [...document.querySelectorAll("button")].some(
    (e) => (e.getAttribute("aria-label") || "").startsWith("Open ") && !e.disabled
  ) &&
  document.querySelector('select[aria-label="Options"]:not(:disabled)');
async function prepare() {
  const ctx = await browser.newContext({
      viewport: results.conditions.viewport,
      timezoneId: "America/Chicago",
      isMobile: true,
      hasTouch: true,
      serviceWorkers: "block",
    }),
    page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => results.errors.push({ type: "pageerror", message: e.message }));
  page.on("console", (e) => {
    if (e.type() === "error") results.errors.push({ type: "console", message: e.text() });
  });
  await ctx.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: 5_000_000,
    uploadThroughput: 1_250_000,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(
    ({ home, calendar }) => {
      window.__premiumReady = {};
      const predicates = {
        home: new Function(`return (${home})()`),
        calendar: new Function(`return (${calendar})()`),
      };
      const check = () => {
        for (const [name, ready] of Object.entries(predicates))
          if (!window.__premiumReady[name] && ready()) {
            window.__premiumReady[name] = -1;
            requestAnimationFrame(() => {
              window.__premiumReady[name] = performance.now();
            });
          }
      };
      new MutationObserver(check).observe(document, {
        subtree: true,
        childList: true,
        attributes: true,
      });
      window.__premiumLongTasks = [];
      new PerformanceObserver((list) => {
        window.__premiumLongTasks.push(
          ...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration }))
        );
      }).observe({ type: "longtask", buffered: true });
    },
    { home: homeReady.toString(), calendar: calendarReady.toString() }
  );
  return { ctx, page };
}
async function measure(page, trigger, predicate) {
  await page.evaluate((source) => {
    window.__premiumClick = null;
    const ready = new Function(`return (${source})()`);
    document.addEventListener(
      "click",
      () => {
        const start = performance.now();
        const check = () => {
          if (ready())
            requestAnimationFrame(() => (window.__premiumClick = performance.now() - start));
          else requestAnimationFrame(check);
        };
        requestAnimationFrame(check);
      },
      { once: true, capture: true }
    );
  }, predicate.toString());
  await trigger();
  await page.waitForFunction(() => window.__premiumClick !== null);
  return page.evaluate(() => window.__premiumClick);
}
try {
  await new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
    server.once("exit", (code) => reject(Error(`Preview exited ${code}`)));
  });
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  results.conditions.browser = browser.version();
  results.conditions.hostCpu = os.cpus()[0]?.model;
  results.conditions.indexSha256 = createHash("sha256")
    .update(await fs.readFile(path.join(dist, "index.html")))
    .digest("hex");
  const fixture = await (await fetch(`${origin}/api/training-context?scope=full`)).json();
  results.conditions.dataset = {
    date: new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
    planned: fixture.planned.length,
    history: fixture.history.length,
    athlete: fixture.athlete.name,
  };
  for (const route of ["home", "calendar"])
    for (let i = 0; i < n; i++) {
      const { ctx, page } = await prepare();
      await page.goto(origin + (route === "home" ? "/" : "/calendar"), {
        waitUntil: "domcontentloaded",
      });
      await page.waitForFunction((name) => window.__premiumReady[name] > 0, route);
      results[route === "home" ? "coldHome" : "coldCalendar"].push(
        await page.evaluate((name) => window.__premiumReady[name], route)
      );
      if (i === 0)
        results.resources.push(
          await page.evaluate(
            (route) => ({
              route,
              entries: performance
                .getEntriesByType("resource")
                .map((e) => ({
                  url: new URL(e.name).pathname,
                  start: Math.round(e.startTime),
                  ms: Math.round(e.duration),
                  bytes: e.decodedBodySize,
                })),
              longTasks: window.__premiumLongTasks,
            }),
            route
          )
        );
      if (route === "home") {
        results.homeNextDay.push(
          await measure(
            page,
            () => page.getByRole("button", { name: "Next day", exact: true }).click(),
            () => document.querySelector(".home-sessions h2")?.textContent === "Tomorrow’s sessions"
          )
        );
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForFunction(() => window.__premiumReady.home > 0);
        results.warmHomeReopen.push(await page.evaluate(() => window.__premiumReady.home));
      }
      await ctx.close();
      console.log(`${phase} ${route} ${i + 1}/${n}`);
    }
  const { ctx, page } = await prepare();
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Calendar", exact: true }).click();
  await page.waitForFunction(calendarReady);
  await page.getByRole("tab", { name: "Home", exact: true }).click();
  await page.waitForFunction(homeReady);
  for (let i = 0; i < n; i++) {
    results.warmHomeToCalendar.push(
      await measure(
        page,
        () => page.getByRole("tab", { name: "Calendar", exact: true }).click(),
        calendarReady
      )
    );
    results.warmCalendarToHome.push(
      await measure(
        page,
        () => page.getByRole("tab", { name: "Home", exact: true }).click(),
        homeReady
      )
    );
  }
  await ctx.close();
  assert.deepEqual(results.errors, []);
} finally {
  results.summaries = {};
  for (const [key, values] of Object.entries(results))
    if (Array.isArray(values) && values.length && typeof values[0] === "number") {
      const sorted = [...values].sort((a, b) => a - b),
        middle = Math.floor(sorted.length / 2);
      results.summaries[key] = {
        n: sorted.length,
        median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
        min: sorted[0],
        max: sorted.at(-1),
      };
    }
  await fs.mkdir("artifacts/premium-app", { recursive: true });
  await fs.writeFile(
    `artifacts/premium-app/performance-${phase}.json`,
    JSON.stringify(results, null, 2) + "\n"
  );
  console.log(JSON.stringify(results.summaries, null, 2));
  await browser?.close();
  server.kill();
}
