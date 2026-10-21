// Native unfiltered All/sport Power acceptance; isolated localhost and raw recording oracles.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { browserNetworkEvidence } from "./browser-network-evidence.mjs";
const require = createRequire(import.meta.url);
let pw;
try {
  pw = require("playwright");
} catch {
  pw = require(
    path.join(
      os.homedir(),
      ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
    )
  );
}
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5213";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(origin).hostname));
const output = path.resolve("artifacts/trainingpeaks-native-power");
await fs.mkdir(output, { recursive: true });
const hash = async (url) =>
    createHash("sha256")
      .update(await fs.readFile(new URL(url)))
      .digest("hex"),
  checkpoint = {
    capturedAt: new Date().toISOString(),
    files: await Promise.all(
      [
        import.meta.url,
        new URL("../ui/dist/index.html", import.meta.url).href,
        new URL("./desktop-native-power-fixtures.mjs", import.meta.url).href,
        new URL("../app-backend/lib/native-power-curve.mjs", import.meta.url).href,
        new URL("./desktop-preview.mjs", import.meta.url).href,
      ].map(async (file) => ({ file, sha256: await hash(file) }))
    ),
  };
const browser = await pw.chromium.launch({ channel: "msedge", headless: true }),
  network = browserNetworkEvidence(),
  checks = [],
  errors = [],
  requests = [],
  readbacks = [],
  active = new Set(),
  intended = new WeakSet(),
  allowedAborts = [],
  allowedHttp = [];
let page,
  today,
  oracle,
  phase = "initial",
  expectedStatus = null,
  synthetic = false,
  capActive = false;
const api = (input) => {
    const url = new URL(input);
    return url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
  },
  isPower = (input) =>
    api(input) === "performance-curves" &&
    new URL(input).searchParams.get("kind") === "power" &&
    !new URL(input).searchParams.has("tags"),
  region = () => page.getByRole("region", { name: /^Peaks - Power:/ }),
  settings = () => page.locator(".ddc-settings"),
  button = (name) => page.getByRole("button", { name, exact: true }),
  shift = (date, days) =>
    new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10),
  dateText = (date) => `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(2, 4)}`,
  duration = (seconds) => (seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`),
  anchors = [5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400];
async function fresh() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    colorScheme: "light",
    locale: "en-US",
  });
  network.attach(context);
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    requests.push({ phase, url: request.url(), method: request.method() });
    if (request.method() === "GET" && request.resourceType() === "fetch") active.add(request);
  });
  page.on("requestfinished", (request) => active.delete(request));
  page.on("requestfailed", (request) => {
    active.delete(request);
    if (intended.has(request))
      allowedAborts.push([request.url(), request.method(), request.failure()?.errorText]);
  });
  page.on("response", (response) => {
    if (response.status() === expectedStatus && isPower(response.url()))
      allowedHttp.push([response.url(), response.request().method(), response.status()]);
  });
  await page.goto(origin + "/?theme=light", { waitUntil: "domcontentloaded" });
  await button("Analysis").waitFor();
  assert.equal(await page.evaluate(() => window.__localPreview?.synthetic), true);
  synthetic = true;
  await button("Analysis").click();
  await page.getByRole("region", { name: "Training analysis", exact: true }).waitFor();
}
async function json(route) {
  const response = await page.request.get(`${origin}/api/${route}`),
    body = await response.json();
  assert.ok(response.ok(), `${route}: ${JSON.stringify(body)}`);
  readbacks.push({ phase, route, body });
  return body;
}
async function scenario(value) {
  const response = await page.request.post(`${origin}/api/preview/native-power-state`, {
    data: { scenario: value },
  });
  assert.ok(response.ok());
  assert.equal((await response.json()).scenario, value);
  capActive = value === "cap";
  oracle = await json("preview/native-power-sources");
}
async function settle() {
  await region().locator(".ddc-power-curve").waitFor();
  await region()
    .getByRole("status")
    .filter({ hasText: "Loading chart" })
    .waitFor({ state: "hidden" });
}
async function configure() {
  await region()
    .getByRole("button", { name: /^Configure / })
    .click();
  await settings().waitFor();
}
async function sports(labels) {
  const group = settings().getByRole("group", { name: "Workout Types", exact: true });
  await group.getByLabel("All", { exact: true }).check();
  if (labels.length) {
    await group.getByLabel("All", { exact: true }).uncheck();
    for (const label of labels) await group.getByLabel(label, { exact: true }).check();
  }
}
async function dates(range, comparison = false) {
  await settings()
    .getByRole("combobox", {
      name: comparison ? "Comparison Date Range" : "Date Range",
      exact: true,
    })
    .selectOption("custom");
  await settings()
    .getByLabel(comparison ? "Comparison From" : "From", { exact: true })
    .fill(range.start);
  await settings()
    .getByLabel(comparison ? "Comparison To" : "To", { exact: true })
    .fill(range.end);
}
async function apply(wait = true) {
  await settings().getByRole("button", { name: "Apply & Close", exact: true }).click();
  await settings().waitFor({ state: "hidden" });
  await page.getByText("Dashboard saved to server.", { exact: true }).waitFor();
  if (wait) await settle();
}
function matches(native, sport) {
  return (
    sport === "all" ||
    sport
      .split(",")
      .some((type) =>
        type === "Run"
          ? ["Run", "TrailRun", "VirtualRun"].includes(native)
          : type === "Ride"
            ? [
                "Ride",
                "VirtualRide",
                "MountainBikeRide",
                "GravelRide",
                "Velomobile",
                "Handcycle",
              ].includes(native)
            : type === native
      )
  );
}
function eligible(sport, range) {
  return oracle.sources
    .filter((row) => {
      const day = row.activity.start_date_local.slice(0, 10);
      return (
        day >= range.start &&
        day <= range.end &&
        matches(row.activity.type, sport) &&
        row.activity.icu_ignore_power !== true &&
        (!Array.isArray(row.activity.stream_types) || row.activity.stream_types.includes("watts"))
      );
    })
    .sort(
      (a, b) =>
        b.activity.start_date_local.localeCompare(a.activity.start_date_local) ||
        a.activity.id.localeCompare(b.activity.id)
    )
    .slice(0, 128);
}
function nativePoint(row, seconds) {
  const index = row.curve.secs.indexOf(seconds);
  if (row.curve.stream_type !== "watts" || index < 0 || row.curve.values[index] === null)
    return null;
  const start = row.curve.start_index[index],
    end = row.curve.end_index[index],
    time = row.streams.find((stream) => stream.type === "time").data,
    watts = row.streams.find((stream) => stream.type === "watts").data;
  if (Number.isFinite(row.activity.elapsed_time) && seconds > row.activity.elapsed_time)
    return null;
  if (
    (row.activity.ignore_parts || []).some(
      (part) => part.power === true && start < part.end_index && end > part.start_index
    )
  )
    return null;
  assert.equal(time[end] - time[start], seconds);
  let sum = 0;
  for (let i = start; i < end; i++) sum += watts[i] * (time[i + 1] - time[i]);
  return sum / seconds;
}
function rawWinner(sport, range, seconds) {
  return (
    eligible(sport, range)
      .map((row) => ({ row, value: nativePoint(row, seconds) }))
      .filter((item) => item.value !== null)
      .sort((a, b) => b.value - a.value)[0] || null
  );
}
async function source(sport, range) {
  const body = await json(
    `performance-curves?${new URLSearchParams({ kind: "power", sport, start: range.start, end: range.end })}`
  );
  assert.equal(body.version, 1);
  assert.equal(body.kind, "power");
  assert.equal(body.source, "intervals-activity-power-curves");
  assert.equal(body.unit, "W");
  assert.equal(body.unitPolicy, "native-watts");
  assert.equal(body.valuePolicy, "native-reported");
  assert.equal(body.tagsSupported, false);
  assert.deepEqual(body.window, { oldest: range.start, newest: range.end });
  assert.equal(body.selection.sport, sport);
  const axis = [
    ...new Set(
      eligible(sport, range)
        .filter((row) => row.curve.stream_type === "watts")
        .flatMap((row) => row.curve.secs)
    ),
  ].sort((a, b) => a - b);
  assert.deepEqual(
    body.points.map((point) => point.duration_seconds),
    axis
  );
  for (const point of body.points) {
    assert.equal(point.estimated, false);
    const expected = rawWinner(sport, range, point.duration_seconds);
    assert.equal(point.value, expected?.value ?? null);
    if (expected) {
      assert.equal(point.activity_id, expected.row.activity.id);
      assert.equal(point.native_type, expected.row.activity.type);
      assert.equal(point.date, expected.row.activity.start_date_local.slice(0, 10));
    }
  }
  return body;
}
async function grid(primary, comparison = null) {
  const rows = region()
    .getByRole("table", { name: "Recorded peak power by duration", exact: true })
    .locator("tbody tr");
  assert.equal(await rows.count(), 15);
  for (const seconds of anchors) {
    const row = rows.filter({
        has: page.getByRole("rowheader", { name: duration(seconds), exact: true }),
      }),
      cells = await row.locator("td").allTextContents();
    for (const [index, curve] of [primary, comparison].entries()) {
      if (!curve) continue;
      const point = curve.points.find((point) => point.duration_seconds === seconds);
      assert.equal(cells[index * 2], point?.value != null ? dateText(point.date) : "—");
      assert.equal(
        cells[index * 2 + 1],
        point?.value != null ? String(Math.round(point.value)) : "—"
      );
      assert.equal(
        await row
          .locator("td")
          .nth(index * 2)
          .locator("button,a")
          .count(),
        0
      );
    }
  }
  return rows.allTextContents();
}
async function chart(primary, comparison = null) {
  await region()
    .getByRole("img", { name: "Recorded peak power by exact effort duration", exact: true })
    .waitFor();
  const axis = [
    ...new Set(
      [primary, comparison].flatMap(
        (curve) => curve?.points.map((point) => point.duration_seconds) || []
      )
    ),
  ].sort((a, b) => a - b);
  for (const [index, curve] of [primary, comparison].entries()) {
    if (!curve) continue;
    const values = axis.map(
        (seconds) => curve.points.find((point) => point.duration_seconds === seconds)?.value ?? null
      ),
      known = values.filter((value) => value !== null).length;
    if (known < 2) continue;
    let segments = 0;
    values.forEach((value, i) => {
      if (value !== null && (i === 0 || values[i - 1] === null)) segments++;
    });
    const line = region().locator(
      `.recharts-line-curve[stroke="${index ? "#167eac" : "#d52424"}"]`
    );
    await line.waitFor({ state: "attached" });
    assert.ok(
      await line.evaluate(
        (node) =>
          parseFloat(getComputedStyle(node).strokeWidth) > 0 &&
          getComputedStyle(node).display !== "none"
      )
    );
    const d = await line.getAttribute("d");
    assert.equal((d.match(/[ML]/g) || []).length, known);
    assert.equal((d.match(/M/g) || []).length, segments);
  }
}
async function retry() {
  await region().getByRole("button", { name: "Retry power curve", exact: true }).click();
  await region().getByRole("alert").waitFor({ state: "hidden" });
  await settle();
}
async function finiteReads(id) {
  for (let pass = 0; pass < 8; pass++) {
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    );
    const pending = [...active].filter((request) => request.url().includes(id));
    if (!pending.length) return;
    await Promise.all(
      pending.map(async (request) => {
        const response = await request.response();
        if (response) await response.finished();
      })
    );
  }
  assert.equal([...active].filter((request) => request.url().includes(id)).length, 0);
}
function unexpected() {
  const counts = new Map(),
    consoleCounts = new Map(),
    aborts = new Map(),
    key = (value) => JSON.stringify(value),
    consume = (map, id) => {
      const n = map.get(id) || 0;
      if (!n) return false;
      map.set(id, n - 1);
      return true;
    };
  for (const row of allowedHttp) {
    counts.set(key(row), (counts.get(key(row)) || 0) + 1);
    consoleCounts.set(row[2], (consoleCounts.get(row[2]) || 0) + 1);
  }
  for (const row of allowedAborts) aborts.set(key(row), (aborts.get(key(row)) || 0) + 1);
  return network.entries.filter((entry) =>
    entry.kind === "http-error"
      ? !consume(counts, key([entry.url, entry.method, entry.status]))
      : entry.kind === "request-failed"
        ? !consume(aborts, key([entry.url, entry.method, entry.reason]))
        : entry.kind === "console-error"
          ? !(
              /Failed to load resource: the server responded with a status of (\d+)\b/.test(
                entry.text
              ) && consume(consoleCounts, Number(entry.text.match(/status of (\d+)/)[1]))
            )
          : true
  );
}
try {
  await fresh();
  const before = await json("preview/provider-records");
  oracle = await json("preview/native-power-sources");
  today = oracle.today;
  assert.deepEqual(oracle.requests, []);
  const primary = { start: shift(today, -27), end: today },
    comparison = { start: shift(today, -55), end: shift(today, -28) },
    populated = { start: shift(today, -2), end: shift(today, -1) };
  await button("Charts Library").click();
  await page.getByLabel("Search charts", { exact: true }).fill("Peak Power");
  await button("Add Peak Power").click();
  await page.getByText("Dashboard saved to server.", { exact: true }).waitFor();
  await button("Close charts library").click();
  await settle();
  assert.equal(
    requests.some((row) => api(row.url) === "chart-tags"),
    false
  );
  assert.ok(
    requests.some((row) => isPower(row.url) && new URL(row.url).searchParams.get("sport") === "all")
  );
  checks.push("native-unfiltered-power-is-demand-loaded-with-all-sports-and-no-catalog-read");
  phase = "raw-all";
  const all = await source("all", primary);
  assert.equal(all.points.find((point) => point.duration_seconds === 5).value, 500);
  assert.equal(all.points.find((point) => point.duration_seconds === 60).value, 450);
  assert.equal(all.points.find((point) => point.duration_seconds === 600).value, 400);
  assert.equal(all.points.find((point) => point.duration_seconds === 5400).value, 300);
  assert.equal(all.points.find((point) => point.duration_seconds === 17).value, null);
  assert.equal(all.coverage.unknownLengthRecordings, 1);
  assert.equal(all.coverage.unknownStreamRecordings, 1);
  assert.equal(all.coverage.failedRecordings, 1);
  assert.equal(all.coverage.missingRecordings, 1);
  assert.equal(all.coverage.status, "partial");
  await chart(all);
  checks.push(
    "native-all-values-full-axis-and-gaps-match-independent-weighted-streams-ignore-parts-and-eligibility"
  );
  phase = "grid";
  await configure();
  assert.equal(
    await settings()
      .getByRole("group", { name: "Workout Types", exact: true })
      .getByRole("checkbox")
      .count(),
    15
  );
  assert.equal(
    await settings()
      .getByRole("combobox", { name: "Date Range", exact: true })
      .locator("option")
      .count(),
    25
  );
  await settings().getByLabel("Grid", { exact: true }).check();
  await apply();
  await grid(all);
  checks.push("fifteen-native-grid-anchors-have-independent-watts-and-plain-dates");
  phase = "run";
  await configure();
  await sports(["Run"]);
  await apply();
  const run = await source("Run", primary);
  assert.equal(run.points.find((point) => point.duration_seconds === 60).activity_id, "i780000003");
  assert.equal(
    run.points.find((point) => point.duration_seconds === 600).activity_id,
    "i780000002"
  );
  await grid(run);
  await region()
    .getByRole("button", { name: "Configure Peaks - Power: Run", exact: true })
    .waitFor();
  checks.push("run-selection-includes-actual-trail-recordings-without-cycling-fallback");
  phase = "bike";
  await configure();
  await sports(["Bike"]);
  await apply();
  const bike = await source("Ride", primary);
  assert.equal(
    bike.points.every((point) => point.value === null || point.value === 300),
    true
  );
  await grid(bike);
  checks.push("bike-only-selection-uses-recorded-cycling-native-watts");
  phase = "zero-empty-unavailable";
  await configure();
  await sports(["Walk"]);
  await apply();
  const walk = await source("Walk", primary);
  assert.equal(walk.points.find((point) => point.duration_seconds === 5).value, 0);
  await grid(walk);
  await configure();
  await sports(["Swim"]);
  await apply();
  const swim = await source("Swim", primary);
  assert.deepEqual(swim.points, []);
  await grid(swim);
  await configure();
  await sports(["Brick"]);
  const beforeUnsupported = requests.length;
  await apply(false);
  await region()
    .getByRole("alert")
    .filter({ hasText: "Power curves cannot identify Brick" })
    .waitFor();
  assert.equal(
    requests.slice(beforeUnsupported).some((row) => isPower(row.url)),
    false
  );
  await configure();
  await sports(["Run", "Bike"]);
  await apply();
  const combined = await source("Ride,Run", primary);
  await grid(combined);
  checks.push(
    "known-zero-empty-no-power-private-unsupported-and-csv-selections-do-not-manufacture-data"
  );
  phase = "comparison";
  await configure();
  await sports([]);
  await settings().getByLabel("Comparison", { exact: true }).check();
  await dates(populated, true);
  await settings().getByLabel("Chart", { exact: true }).check();
  await apply();
  await chart(all, await source("all", populated));
  await configure();
  await dates(comparison, true);
  await settings().getByLabel("Grid", { exact: true }).check();
  await apply();
  const empty = await source("all", comparison);
  assert.deepEqual(empty.points, []);
  const confirmed = await grid(all, empty);
  checks.push("comparison-has-independent-populated-svg-path-and-empty-native-window-columns");
  phase = "bad-responses";
  const match = (url) => isPower(url.href),
    reject = (route) =>
      route.fulfill({ status: 503, json: { error: "Synthetic native Power failure" } });
  expectedStatus = 503;
  await page.route(match, reject);
  await button("Refresh training analysis").click();
  await region().getByRole("alert").waitFor();
  assert.deepEqual(await region().locator("tbody tr").allTextContents(), confirmed);
  await page.unroute(match, reject);
  expectedStatus = null;
  await retry();
  for (const bad of ["window", "sport", "unit", "source", "coverage"]) {
    const wrong = async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      if (bad === "window") body.window.oldest = shift(body.window.oldest, -1);
      if (bad === "sport") body.selection.sport = "Run";
      if (bad === "unit") body.unit = "bpm";
      if (bad === "source") body.source = "intervals-power-curve";
      if (bad === "coverage") body.coverage.fetchedRecordings++;
      await route.fulfill({ response, json: body });
    };
    await page.route(match, wrong);
    await button("Refresh training analysis").click();
    await region().getByRole("alert").waitFor();
    assert.deepEqual(await region().locator("tbody tr").allTextContents(), confirmed);
    await page.unroute(match, wrong);
    await retry();
  }
  checks.push(
    "503-and-wrong200-window-sport-unit-source-coverage-retain-confirmed-curves-and-retry"
  );
  phase = "late-window";
  const heldRange = { start: shift(today, -89), end: shift(today, -62) };
  let started, release, done;
  const began = new Promise((resolve) => {
      started = resolve;
    }),
    held = new Promise((resolve) => {
      release = resolve;
    }),
    finished = new Promise((resolve) => {
      done = resolve;
    }),
    holdMatch = (url) => isPower(url.href) && url.searchParams.get("start") === heldRange.start,
    hold = async (route) => {
      const response = await route.fetch();
      intended.add(route.request());
      started();
      await held;
      try {
        await route.fulfill({ response });
      } catch {
      } finally {
        done();
      }
    };
  await page.route(holdMatch, hold);
  await configure();
  await dates(heldRange);
  await apply(false);
  await began;
  await configure();
  await dates(primary);
  await sports(["Run"]);
  await apply();
  const latest = await grid(run, empty);
  release();
  await finished;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  assert.deepEqual(await region().locator("tbody tr").allTextContents(), latest);
  await page.unroute(holdMatch, hold);
  checks.push("obsolete-window-read-cannot-replace-latest-native-sport-pair");
  phase = "cap";
  await configure();
  await sports([]);
  await settings().getByLabel("Comparison", { exact: true }).uncheck();
  await apply();
  await scenario("cap");
  await button("Refresh training analysis").click();
  await settle();
  const capped = await source("all", primary);
  assert.equal(capped.coverage.eligibleRecordings, 130);
  assert.equal(capped.coverage.fetchedRecordings, 128);
  assert.equal(capped.coverage.skippedForCap, 2);
  assert.equal(
    capped.points.every((point) => point.value === 300),
    true
  );
  assert.equal(
    (await json("preview/native-power-sources")).requests.filter((row) => /^\/activity\//.test(row))
      .length,
    128
  );
  await grid(capped);
  await scenario("default");
  await button("Refresh training analysis").click();
  await settle();
  await grid(all);
  checks.push("real130-recording-cap-fetches128-and-never-admits-omitted999w-recordings");
  phase = "preferences";
  await configure();
  await sports(["Run"]);
  await apply();
  const prefs = await json("training-preferences"),
    instance = Object.values(prefs.training_preferences)
      .filter((value) => value && Array.isArray(value.instances))
      .flatMap((value) => value.instances)
      .find((row) => row.type === "peak-power");
  assert.deepEqual(instance.settings.sports, ["Run"]);
  await fresh();
  await settle();
  await grid(run);
  await configure();
  assert.equal(
    await settings()
      .getByRole("group", { name: "Workout Types", exact: true })
      .getByLabel("Run", { exact: true })
      .isChecked(),
    true
  );
  await settings().getByRole("button", { name: "Close chart settings", exact: true }).click();
  checks.push("native-power-sport-and-grid-preferences-survive-fresh-browser-context");
  phase = "source";
  const point = run.points.find((row) => row.duration_seconds === 5),
    recording = await json(`workout-history/${point.activity_id}`);
  assert.equal(recording.workout.activity_id, point.activity_id);
  assert.equal(recording.workout.workout_date, point.date);
  const sourceStart = requests.length;
  await region()
    .getByRole("button", {
      name: `Open power source recording for 5 sec on ${dateText(point.date)}`,
      exact: true,
    })
    .click();
  await page.waitForURL(
    (url) => url.searchParams.get("workout") === `activity:${point.activity_id}`
  );
  await button("Analyze").waitFor();
  await finiteReads(point.activity_id);
  assert.equal(new URL(page.url()).searchParams.has("effort"), false);
  assert.equal(
    await page.getByRole("region", { name: "Recorded workout analysis", exact: true }).count(),
    0
  );
  assert.equal(
    requests.slice(sourceStart).some((row) => api(row.url).includes("performance-effort")),
    false
  );
  await button("Close workout details").click();
  await region().waitFor();
  const legacy = await json(`personal-statistics?oldest=${primary.start}&newest=${primary.end}`),
    legacyPoint = legacy.powerCurve.points.find((row) => row.duration_seconds === 5),
    analysis = await json(`activities/${legacyPoint.activity_id}/analysis`),
    segment = analysis.points.slice(legacyPoint.start_index, legacyPoint.end_index + 1),
    seconds = segment.at(-1).time - segment[0].time,
    watts =
      segment
        .slice(0, -1)
        .reduce((sum, row, index) => sum + row.power * (segment[index + 1].time - row.time), 0) /
      seconds;
  assert.equal(seconds, 5);
  assert.equal(watts, 420);
  assert.equal(legacyPoint.value, watts);
  const bounds = await json(
    `activities/${legacyPoint.activity_id}/performance-effort?type=Ride&duration=5`
  );
  assert.equal(bounds.available, true);
  assert.equal(bounds.chart_start_seconds, segment[0].time);
  assert.equal(bounds.chart_end_seconds, segment.at(-1).time);
  checks.push(
    "native-numeric-opens-summary-while-independent-legacy420w-physical-effort-proof-remains-separate"
  );
  assert.deepEqual((await json("preview/provider-records")).writes, before.writes);
  assert.deepEqual(errors, []);
  assert.deepEqual(unexpected(), []);
  assert.equal(
    await hash(new URL("../ui/dist/index.html", import.meta.url)),
    checkpoint.files.find((row) => row.file.endsWith("/ui/dist/index.html")).sha256
  );
  checks.push(
    "native-power-workflows-have-no-provider-writes-runtime-unexpected-network-or-artifact-change"
  );
  assert.equal(checks.length, 13);
  await page.screenshot({
    path: path.join(output, "verified-native-power.png"),
    animations: "disabled",
  });
} catch (error) {
  process.exitCode = 1;
  errors.push(error.stack || error.message);
  console.error(error.stack || error.message);
  if (page) {
    await fs
      .writeFile(path.join(output, "failure-dom.txt"), await page.locator("body").innerText())
      .catch(() => {});
    await page
      .screenshot({ path: path.join(output, "failure.png"), animations: "disabled" })
      .catch(() => {});
  }
} finally {
  if (synthetic && capActive)
    try {
      await scenario("default");
    } catch (error) {
      errors.push(`Fixture cleanup failed: ${error.message}`);
      process.exitCode = 1;
    }
  const evidence = structuredClone(network.entries);
  await browser.close();
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        passed: checks.length,
        checks,
        errors,
        checkpoint,
        requests,
        allowedHttp,
        allowedAborts,
        limitations: {
          visualPercentageCertified: false,
          trainingPeaksNumericalAlgorithmVerified: false,
          legacyPersonalAndNativeDemandFixturesAreSeparate: true,
        },
      },
      null,
      2
    )
  );
  await fs.writeFile(path.join(output, "readbacks.json"), JSON.stringify(readbacks, null, 2));
  await fs.writeFile(path.join(output, "network.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ passed: checks.length, errors: errors.length }));
}
