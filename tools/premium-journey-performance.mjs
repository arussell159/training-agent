// Repeatable production-asset journey timings. All mutations use disposable APIs.
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
  phase = process.env.PERF_PHASE || "review";
const n = Number(process.env.PERF_SAMPLES || 12),
  port = Number(process.env.PERF_PORT || 5404),
  origin = `http://127.0.0.1:${port}`;
assert.ok(Number.isInteger(n) && n >= 2 && n <= 100);
const reuseRecord = process.env.PERF_REUSE_RECORD === "1";
const detailsOnly = process.env.PERF_DETAILS_ONLY === "1";
const spawnServer = () =>
  spawn(
    process.execPath,
    [
      "tools/desktop-preview.mjs",
      "--calendar-edits",
      "--commit-provider-delay-ms=800",
      `--port=${port}`,
      `--dist=${dist}`,
    ],
    { stdio: ["ignore", "pipe", "pipe"] }
  );
let server = spawnServer();
let browser;
const waitServer = () =>
  new Promise((resolve, reject) => {
    server.stdout.once("data", resolve);
    server.once("error", reject);
  });
const result = {
  conditions: {
    dist,
    phase,
    n,
    independentFixturePerSample: !reuseRecord,
    detailsOnly,
    viewport: { width: 390, height: 844 },
    timezone: "America/Chicago",
    network: "40 ms latency; 40 Mbps down / 10 Mbps up",
    cpuThrottle: 4,
    statistics: "Empirical median and nearest-rank p95. At n=12, p95 is the observed maximum; this small lab sample is not a population-tail or field estimate.",
    cache:
      "Fresh browser context for each sample; calendar populated before journeys; same editor loaded/canceled once before cached opening. Service worker blocked; production fixture assets use no-store.",
    backend:
      "Disposable deterministic synthetic APIs; provider completion is artificially delayed 800 ms. Backend acknowledgment and provider completion are fixture measurements, NOT live durability or Intervals.icu latency.",
    definitions: {
      calendarWeekJump:
        "Trusted date-picker click to populated target date aligned below fixed navbar, picker dismissed, next animation frame. Picker runtime preloaded before timing.",
      workoutDetails:
        "Trusted workout-card click to named Edit control in populated details and next animation frame; first opening in each context.",
      editorFirstOpen:
        "Trusted Edit click to enabled populated Workout name plus interval data and save control; next animation frame; first editor import in each context.",
      editorCachedOpen: "Same definition after opening and canceling once in that context.",
      saveFeedback:
        "Trusted Save click to disabled Save control or updated named details, followed by animation frame. This is visible feedback, not a durable-save claim.",
      saveVisible:
        "Trusted Save click to editor dismissed and details Edit control reflecting the changed name, next animation frame.",
      saveLocalDurable:
        "Trusted Save click to first strict IndexedDB ledgers readwrite transaction completion containing the target model and local operation; native IDB put observed without replacing persistence.",
      saveBackendAcknowledgment:
        "Trusted Save click to parsed accepted:true response from fixture POST workout-commits. Fixture backend storage is in memory, not deployed durable backend evidence.",
      syncVisible:
        "Trusted Save click to matching training-write-feedback success event (Synced to Intervals.icu), after the fixture provider delay. Measures app observed completion, not real provider latency.",
      foodFirstResults:
        "Last input event for oats to successful parsed nutrition/search response and enabled matching result in DOM, next animation frame; includes debounce. Fresh context/read cache per sample.",
    },
  },
  calendarWeekJump: [],
  workoutDetails: [],
  editorFirstOpen: [],
  editorCachedOpen: [],
  saveFeedback: [],
  saveVisible: [],
  saveLocalDurable: [],
  saveBackendAcknowledgment: [],
  syncVisible: [],
  foodFirstResults: [],
  receipts: [],
  detailResources: [],
  errors: [],
};

function installInstrumentation() {
  window.__journey = { timed: null, save: null, search: null };
  document.addEventListener(
    "click",
    () => {
      const state = window.__journey;
      if (state.timed?.armed) {
        state.timed.armed = false;
        state.timed.start = performance.now();
      }
      if (state.save?.armed) {
        state.save.armed = false;
        state.save.start = performance.now();
      }
    },
    true
  );
  document.addEventListener(
    "input",
    (event) => {
      if (
        window.__journey.search &&
        event.target?.getAttribute("placeholder") === "Search foods or brands"
      )
        window.__journey.search.start = performance.now();
    },
    true
  );
  const nativePut = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, ...rest) {
    const save = window.__journey.save;
    if (
      save?.start &&
      this.name === "ledgers" &&
      this.transaction.mode === "readwrite" &&
      value?.operations?.some((op) => op.input?.model?.name === save.name && op.state === "local")
    ) {
      const tx = this.transaction;
      tx.addEventListener(
        "complete",
        () => {
          if (!save.local) {
            save.local = performance.now() - save.start;
            save.durability = tx.durability;
          }
        },
        { once: true }
      );
    }
    return nativePut.call(this, value, ...rest);
  };
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const response = await nativeFetch(input, options);
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const api = url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
    const save = window.__journey.save;
    if (api === "workout-commits" && options?.method === "POST" && save?.start) {
      const body = JSON.parse(options.body || "{}");
      if (body.input?.model?.name === save.name)
        void response
          .clone()
          .json()
          .then((value) => {
            if (value.accepted === true) {
              save.backend = performance.now() - save.start;
              save.workoutId = value.workoutId;
              save.backendRevision = value.revision;
            }
          });
    }
    if (
      api === "nutrition/search" &&
      url.searchParams.get("q") === "oats" &&
      window.__journey.search
    ) {
      const search = window.__journey.search;
      void response
        .clone()
        .json()
        .then((value) => {
          if (response.ok && value.products?.some((product) => product.name === "Rolled oats"))
            search.response = true;
        });
    }
    return response;
  };
  window.addEventListener("training-write-feedback", (event) => {
    const save = window.__journey.save;
    if (save?.start)
      (save.feedback ||= []).push({
        state: event.detail?.state,
        workoutId: event.detail?.workoutId,
        title: event.detail?.title,
      });
    if (
      save?.start &&
      event.detail?.state === "success" &&
      event.detail?.workoutId === save.workoutId
    )
      save.sync = performance.now() - save.start;
  });
  const loop = () => {
    const timed = window.__journey.timed;
    if (timed?.start && !timed.done && timed.ready()) {
      timed.done = true;
      requestAnimationFrame(() => {
        timed.elapsed = performance.now() - timed.start;
      });
    }
    const save = window.__journey.save;
    if (save?.start && !save.feedbackStarted) {
      const control = document.querySelector('button[aria-label="Save workout"]');
      const details = document.querySelector('[aria-label="Edit ' + save.name + '"]');
      if (control?.disabled || (!control && details)) {
        save.feedbackStarted = true;
        requestAnimationFrame(() => {
          save.feedbackMs = performance.now() - save.start;
        });
      }
    }
    const search = window.__journey.search;
    if (
      search?.response &&
      search.start &&
      !search.done &&
      [...document.querySelectorAll("button")].some(
        (node) =>
          node.getAttribute("aria-label") === "Add one serving of Rolled oats" && !node.disabled
      )
    ) {
      search.done = true;
      requestAnimationFrame(() => {
        search.elapsed = performance.now() - search.start;
      });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
async function measure(page, action, predicate, arg) {
  await page.evaluate(
    ({ predicate, arg }) => {
      const test = new Function("arg", `return (${predicate})(arg)`);
      window.__journey.timed = { armed: true, ready: () => test(arg) };
    },
    { predicate: predicate.toString(), arg }
  );
  await action();
  await page.waitForFunction(() => window.__journey.timed?.elapsed > 0).catch(async error => {
    result.failureSnapshot = await page.evaluate(() => ({ url: location.href, body: document.body.innerText.slice(0,6000), measure: { start: window.__journey.timed?.start, done: window.__journey.timed?.done }, resources: performance.getEntriesByType("resource").map(entry => ({url:entry.name,start:entry.startTime,ms:entry.duration})) }));
    throw error;
  });
  return page.evaluate(() => window.__journey.timed.elapsed);
}
const editorReady = (name) => {
  const input = document.querySelector('input[aria-label="Workout name"]'),
    save = document.querySelector('button[aria-label="Save workout"]');
  return (
    input?.value === name &&
    !input.disabled &&
    save &&
    document.querySelector(".we-mobile-interval-row,.we-step-list .we-step-name")
  );
};
const detailReady = (name) =>
  !!document.querySelector(
    `[role="button"][aria-label="Edit ${name}"],button[aria-label="Edit ${name}"]`
  ) && !document.querySelector('input[aria-label="Workout name"]');
async function prepare() {
  const context = await browser.newContext({
    viewport: result.conditions.viewport,
    timezoneId: "America/Chicago",
    isMobile: true,
    hasTouch: true,
    serviceWorkers: "block",
  });
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => result.errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") result.errors.push(message.text());
  });
  const cdp = await context.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 40,
    downloadThroughput: 5_000_000,
    uploadThroughput: 1_250_000,
  });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(installInstrumentation);
  return { context, page };
}
try {
  await waitServer();
  browser = await chromium.launch({ headless: true, channel: "msedge" });
  result.conditions.browser = await browser.version();
  result.conditions.indexSha256 = createHash("sha256")
    .update(await fs.readFile(path.join(dist, "index.html")))
    .digest("hex");
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  result.conditions.fixtureDate = today;
  const nextMonday = new Date(`${today}T12:00:00`);
  nextMonday.setDate(nextMonday.getDate() + ((8 - nextMonday.getDay()) % 7 || 7));
  const dateKey = [
    nextMonday.getFullYear(),
    String(nextMonday.getMonth() + 1).padStart(2, "0"),
    String(nextMonday.getDate()).padStart(2, "0"),
  ].join("-");
  let title = "Editable run workout";
  for (let i = 0; i < n; i++) {
    const { context, page } = await prepare();
    await page.goto(origin + "/calendar", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: `Open ${title}`, exact: true }).waitFor();
    const card = page.getByRole("button", { name: `Open ${title}`, exact: true });
    await card.scrollIntoViewIfNeeded();
    result.workoutDetails.push(await measure(page, () => card.click(), detailReady, title));
    result.detailResources.push(await page.evaluate(() => ({
      click: window.__journey.timed.start,
      resources: performance.getEntriesByType("resource").filter(entry => entry.startTime >= window.__journey.timed.start - 300).map(entry => ({ url: new URL(entry.name).pathname, start: entry.startTime - window.__journey.timed.start, ms: entry.duration, bytes: entry.decodedBodySize })),
    })));
    if (detailsOnly) {
      await context.close();
      console.log(`${phase} details ${i + 1}/${n}`);
      if (i + 1 < n) {
        await new Promise(resolve => { server.once("exit", resolve); server.kill(); });
        server = spawnServer();
        await waitServer();
      }
      continue;
    }
    result.editorFirstOpen.push(
      await measure(
        page,
        () => page.getByRole("button", { name: `Edit ${title}`, exact: true }).click(),
        editorReady,
        title
      )
    );
    await page.getByRole("button", { name: "Cancel workout editing", exact: true }).click();
    await page.getByRole("button", { name: `Edit ${title}`, exact: true }).waitFor();
    result.editorCachedOpen.push(
      await measure(
        page,
        () => page.getByRole("button", { name: `Edit ${title}`, exact: true }).click(),
        editorReady,
        title
      )
    );
    const nextTitle = `Premium timing run ${i + 1}`;
    await page.getByLabel("Workout name", { exact: true }).fill(nextTitle);
    await page.getByLabel("Workout name", { exact: true }).blur();
    await page.evaluate((name) => {
      window.__journey.save = { name, armed: true };
    }, nextTitle);
    result.saveVisible.push(
      await measure(
        page,
        () => page.getByRole("button", { name: "Save workout", exact: true }).click(),
        detailReady,
        nextTitle
      )
    );
    await page
      .waitForFunction(
        () =>
          window.__journey.save.local &&
          window.__journey.save.backend &&
          window.__journey.save.sync,
        null,
        { timeout: 20000 }
      )
      .catch(async (error) => {
        console.log(JSON.stringify(await page.evaluate(() => window.__journey.save)));
        throw error;
      });
    const save = await page.evaluate(() => window.__journey.save);
    assert.equal(save.durability, "strict");
    assert.equal(save.backendRevision, `app:${reuseRecord ? i + 1 : 1}`);
    result.receipts.push({
      workoutId: save.workoutId,
      name: save.name,
      revision: save.backendRevision,
      localDurability: save.durability,
      syncFeedback: save.feedback,
    });
    result.saveFeedback.push(save.feedbackMs);
    result.saveLocalDurable.push(save.local);
    result.saveBackendAcknowledgment.push(save.backend);
    result.syncVisible.push(save.sync);
    // Time week selection separately after the first-open editor measurement.
    // Preloading the date picker first would conceal its shared-runtime cost.
    await page.goto(origin + "/calendar", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Jump to calendar date", exact: true }).click();
    const date = page.locator(
      `.calendar-month-current .calendar-day[data-date="${nextMonday.getFullYear()}-${nextMonday.getMonth()}-${nextMonday.getDate()}"]`
    );
    await date.waitFor();
    result.calendarWeekJump.push(
      await measure(
        page,
        () => date.click(),
        (key) => {
          const day = document.querySelector(`[data-calendar-date="${key}"]`),
            nav = document.querySelector(".calendar-sticky-day-navbar");
          return (
            !document.querySelector(".mobile-calendar-picker-layer") &&
            day &&
            nav &&
            Math.abs(day.getBoundingClientRect().top - nav.getBoundingClientRect().bottom) < 5 &&
            day.querySelector("button")
          );
        },
        dateKey
      )
    );
    title = reuseRecord ? nextTitle : "Editable run workout";
    await page.goto(origin + "/nutrition", { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Add breakfast", exact: true }).click();
    await page.getByPlaceholder("Search foods or brands").waitFor();
    await page.evaluate(() => {
      window.__journey.search = {};
    });
    await page.getByPlaceholder("Search foods or brands").fill("oats");
    await page.waitForFunction(() => window.__journey.search.elapsed > 0);
    result.foodFirstResults.push(await page.evaluate(() => window.__journey.search.elapsed));
    await context.close();
    console.log(`${phase} journey ${i + 1}/${n}`);
    if (!reuseRecord && i + 1 < n) {
      await new Promise((resolve) => {
        server.once("exit", resolve);
        server.kill();
      });
      server = spawnServer();
      await waitServer();
    }
  }
  assert.deepEqual(result.errors, []);
  result.passed = true;
} catch (error) {
  result.failure = error.message;
  throw error;
} finally {
  result.summaries = {};
  for (const [key, values] of Object.entries(result))
    if (Array.isArray(values) && values.length && typeof values[0] === "number") {
      const sorted = [...values].sort((a, b) => a - b),
        middle = Math.floor(sorted.length / 2);
      result.summaries[key] = {
        n: sorted.length,
        median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
        p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
        min: sorted[0],
        max: sorted.at(-1),
      };
    }
  await fs.mkdir("artifacts/premium-app", { recursive: true });
  await fs.writeFile(
    `artifacts/premium-app/journey-performance-${phase}.json`,
    JSON.stringify(result, null, 2) + "\n"
  );
  console.log(JSON.stringify(result.summaries, null, 2));
  await browser?.close();
  server.kill();
}
