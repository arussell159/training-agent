// Bounded native recording tag acceptance. Synthetic localhost only; no parity percentage.
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
const output = path.resolve("artifacts/trainingpeaks-native-chart-tags");
await fs.mkdir(output, { recursive: true });
const hash = async (url) =>
  createHash("sha256")
    .update(await fs.readFile(new URL(url)))
    .digest("hex");
const checkpoint = {
  capturedAt: new Date().toISOString(),
  files: await Promise.all(
    [
      import.meta.url,
      new URL("../ui/dist/index.html", import.meta.url).href,
      new URL("./desktop-preview.mjs", import.meta.url).href,
      new URL("./desktop-chart-tags-fixtures.mjs", import.meta.url).href,
      new URL("../app-backend/lib/tagged-activity-curves.mjs", import.meta.url).href,
    ].map(async (file) => ({ file, sha256: await hash(file) }))
  ),
};
const browser = await pw.chromium.launch({ channel: "msedge", headless: true }),
  network = browserNetworkEvidence(),
  checks = [],
  errors = [],
  readbacks = [],
  requests = [],
  preferenceWrites = [],
  active = new Set(),
  intendedAborts = new WeakSet(),
  allowedFailures = [],
  allowedHttp = [];
const views = {
  heartRate: {
    add: "Peak HR",
    name: /^Peaks - Heart Rate:/,
    container: ".ddc-heart-rate-curve",
    label: "heart-rate",
    table: "Recorded peak heart rate by duration",
    unit: "bpm",
    policy: "native-bpm",
    stream: "heartrate",
  },
  power: {
    add: "Peak Power",
    name: /^Peaks - Power:/,
    container: ".ddc-power-curve",
    label: "power",
    table: "Recorded peak power by duration",
    unit: "W",
    policy: "native-watts",
    stream: "watts",
  },
  cadence: {
    add: "Peak Cadence",
    name: /^Peaks - Cadence:/,
    container: ".ddc-cadence-curve",
    label: "cadence",
    table: "Recorded peak cadence by duration",
    unit: "rpm",
    policy: "native-rpm",
    stream: "cadence",
  },
  velocity: {
    add: "Peak Speed",
    name: /^Peaks - Speed:/,
    container: ".ddc-speed-duration-curve",
    label: "speed",
    table: "Recorded peak speed by duration",
    unit: "m/s",
    policy: "native-velocity-smooth",
    stream: "velocity_smooth",
  },
};
let page,
  today,
  oracle,
  catalogProof,
  current = "heartRate",
  phase = "initial",
  expectedError = null,
  synthetic = false,
  scenarioActive = "default";
const api = (input) => {
  const url = new URL(input);
  return url.searchParams.get("__api_route") || url.pathname.replace(/^\/api\//, "");
};
const filtered = (input) =>
  api(input) === "performance-curves" &&
  new URL(input).searchParams.has("tags") &&
  JSON.parse(new URL(input).searchParams.get("tags")).length > 0;
const key = (value) => JSON.stringify(value);
const button = (name) => page.getByRole("button", { name, exact: true }),
  region = () =>
    page.getByRole("region", {
      name: views[current].name,
      exact: typeof views[current].name === "string",
    }),
  settings = () => page.locator(".ddc-settings"),
  tags = () => settings().getByRole("group", { name: "Select Tags", exact: true });
const shift = (date, days) =>
    new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10),
  duration = (seconds) => (seconds < 60 ? `${seconds} sec` : `${seconds / 60} min`),
  dateText = (date) => `${date.slice(5, 7)}/${date.slice(8, 10)}/${date.slice(2, 4)}`;
const gridAxis = [5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400];
async function fresh() {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 820 },
    locale: "en-US",
    colorScheme: "light",
  });
  network.attach(context);
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
  );
  page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() === "GET" && request.resourceType() === "fetch") active.add(request);
    requests.push({ phase, url: request.url(), method: request.method() });
    if (api(request.url()) === "training-preferences" && request.method() === "POST")
      preferenceWrites.push(request.postDataJSON());
  });
  page.on("requestfinished", (request) => active.delete(request));
  page.on("requestfailed", (request) => {
    active.delete(request);
    if (intendedAborts.has(request))
      allowedFailures.push([request.url(), request.method(), request.failure()?.errorText]);
  });
  page.on("response", (response) => {
    if (
      expectedError &&
      response.status() === expectedError.status &&
      expectedError.match(response.url())
    )
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
  assert.equal(response.ok(), true, `${route}: ${JSON.stringify(body)}`);
  readbacks.push({ phase, route, body });
  return body;
}
async function scenario(value) {
  assert.equal(synthetic, true);
  scenarioActive = value;
  const response = await page.request.post(`${origin}/api/preview/chart-tags-state`, {
      data: { scenario: value },
    }),
    body = await response.json();
  assert.equal(response.ok(), true, JSON.stringify(body));
  assert.equal(body.scenario, value);
  oracle = await json("preview/chart-tag-sources");
  catalogProof = await json("chart-tags");
  assert.equal(oracle.scenario, value);
}
async function each(callback) {
  const previous = current;
  for (current of Object.keys(views)) await callback();
  current = previous;
}
async function configure() {
  await region()
    .getByRole("button", { name: /^Configure / })
    .click();
  await settings().waitFor();
}
async function catalogReady() {
  await tags().waitFor();
  await tags()
    .getByRole("status")
    .filter({ hasText: "Loading recording tags" })
    .waitFor({ state: "hidden" });
}
async function selectTags(selected) {
  await catalogReady();
  await tags().getByLabel("All", { exact: true }).check();
  for (const tag of selected)
    await tags().getByLabel(`Recording tag: ${tag}`, { exact: true }).check();
  assert.equal(await tags().getByLabel("All", { exact: true }).isChecked(), selected.length === 0);
}
async function settle() {
  await region().locator(views[current].container).waitFor();
  const phrase = current === "power" ? "Loading chart" : `Loading ${views[current].label} chart`;
  await region().getByRole("status").filter({ hasText: phrase }).waitFor({ state: "hidden" });
}
async function apply(wait = true) {
  await settings().getByRole("button", { name: "Apply & Close", exact: true }).click();
  await settings().waitFor({ state: "hidden" });
  await page.getByText("Dashboard saved to server.", { exact: true }).waitFor();
  if (wait) await settle();
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
async function add() {
  await button("Charts Library").click();
  await page.getByLabel("Search charts", { exact: true }).fill(views[current].add);
  await button(`Add ${views[current].add}`).click();
  await page.getByText("Dashboard saved to server.", { exact: true }).waitFor();
  await button("Close charts library").click();
  await settle();
}
function knownMembership(row) {
  return (
    Array.isArray(row.activity.tags) &&
    row.activity.tags.every((tag) => typeof tag === "string" && tag.trim()) &&
    new Set(row.activity.tags).size === row.activity.tags.length
  );
}
function ignored(row, kind) {
  return kind === "heartRate"
    ? row.activity.icu_ignore_hr === true
    : kind === "power"
      ? row.activity.icu_ignore_power === true
      : kind === "velocity"
        ? row.activity.ignore_pace === true || row.activity.ignore_velocity === true
        : false;
}
function candidates(kind, selected, range) {
  return oracle.sources
    .filter((row) => {
      const date = row.activity.start_date_local.slice(0, 10);
      return (
        date >= range.start &&
        date <= range.end &&
        knownMembership(row) &&
        selected.some((tag) => row.activity.tags.includes(tag)) &&
        row.activity.stream_types.includes(views[kind].stream) &&
        !ignored(row, kind)
      );
    })
    .sort(
      (a, b) =>
        b.activity.start_date_local.localeCompare(a.activity.start_date_local) ||
        a.activity.id.localeCompare(b.activity.id)
    )
    .slice(0, 128);
}
function curveOf(row, kind) {
  const value = row.curves[kind];
  return Array.isArray(value)
    ? value.find((curve) => curve.stream_type === views[kind].stream)
    : value;
}
function weighted(row, kind, seconds) {
  const time = row.streams.find((stream) => stream.type === "time").data,
    values = row.streams.find((stream) => stream.type === views[kind].stream).data;
  assert.equal(time[seconds] - time[0], seconds);
  let sum = 0;
  for (let i = 0; i < seconds; i++) {
    assert.ok(time[i + 1] > time[i]);
    sum += values[i] * (time[i + 1] - time[i]);
  }
  return sum / seconds;
}
function winner(kind, selected, range, seconds) {
  return (
    candidates(kind, selected, range)
      .filter((row) => {
        const curve = curveOf(row, kind),
          index = curve.secs.indexOf(seconds);
        return index >= 0 && curve.values[index] !== null && row.activity.elapsed_time >= seconds;
      })
      .sort((a, b) => weighted(b, kind, seconds) - weighted(a, kind, seconds))[0] || null
  );
}
async function source(kind, selected, range) {
  const query = new URLSearchParams({
      kind,
      sport: "all",
      start: range.start,
      end: range.end,
      tags: JSON.stringify(selected),
      tagScope: catalogProof.accountScope,
      tagRevision: catalogProof.revision,
    }),
    body = await json(`performance-curves?${query}`);
  assert.equal(body.version, 2);
  assert.equal(body.kind, kind);
  assert.equal(body.unit, views[kind].unit);
  assert.equal(body.unitPolicy, views[kind].policy);
  assert.equal(body.valuePolicy, "native-reported");
  assert.equal(body.tagsSupported, true);
  assert.equal(body.source, "intervals-tagged-activity-curves");
  assert.equal(body.accountScope, catalogProof.accountScope);
  assert.equal(body.catalogRevision, catalogProof.revision);
  assert.deepEqual(body.selection, {
    sport: "all",
    nativeTypes: [],
    tags: selected,
    tagMatch: "any",
  });
  assert.deepEqual(body.window, { oldest: range.start, newest: range.end });
  const axis = [
    ...new Set(candidates(kind, selected, range).flatMap((row) => curveOf(row, kind).secs)),
  ].sort((a, b) => a - b);
  assert.deepEqual(
    body.points.map((point) => point.duration_seconds),
    axis
  );
  for (const point of body.points) {
    assert.equal(point.estimated, false);
    assert.ok(point.sourceTags.some((tag) => selected.includes(tag)));
    const original = oracle.sources.find((row) => row.activity.id === point.activity_id);
    assert.ok(original);
    assert.deepEqual(point.sourceTags, original.activity.tags);
    assert.equal(point.date, original.activity.start_date_local.slice(0, 10));
    assert.equal(point.native_type, original.activity.type);
    const row = winner(kind, selected, range, point.duration_seconds);
    if (!row) {
      assert.equal(point.value, null);
      continue;
    }
    assert.equal(point.activity_id, row.activity.id);
    assert.equal(point.value, weighted(row, kind, point.duration_seconds));
  }
  const inside = oracle.sources.filter((row) => {
      const date = row.activity.start_date_local.slice(0, 10);
      return date >= range.start && date <= range.end;
    }),
    matched = inside.filter(
      (row) => knownMembership(row) && selected.some((tag) => row.activity.tags.includes(tag))
    ),
    unknown = inside.filter((row) => !knownMembership(row)).length;
  assert.equal(body.coverage.inventoryRecords, inside.length);
  assert.equal(body.coverage.matchedRecordings, matched.length);
  assert.equal(body.coverage.unknownMembershipRecordings, unknown);
  assert.equal(body.coverage.unmatchedRecordings, inside.length - matched.length - unknown);
  assert.equal(body.coverage.fetchedRecordings, candidates(kind, selected, range).length);
  assert.equal(
    body.coverage.unknownPoints,
    body.points.filter((point) => point.value === null).length
  );
  return body;
}
function valueText(point) {
  if (point?.value == null) return "—";
  return current === "velocity"
    ? (point.value / 0.44704).toFixed(1)
    : String(current === "power" ? Math.round(point.value) : point.value);
}
async function grid(primary, comparison = null) {
  const rows = region()
      .getByRole("table", { name: views[current].table, exact: true })
      .locator("tbody tr"),
    expected =
      current === "velocity"
        ? gridAxis.filter((seconds) =>
            [primary, comparison].some((curve) =>
              curve?.points.some(
                (point) => point.duration_seconds === seconds && point.value !== null
              )
            )
          )
        : gridAxis;
  assert.equal(await rows.count(), expected.length);
  for (const seconds of expected) {
    const row = rows.filter({
        has: page.getByRole("rowheader", { name: duration(seconds), exact: true }),
      }),
      cells = await row.locator("td").allTextContents();
    for (const [index, curve] of [primary, comparison].entries()) {
      if (!curve) continue;
      const point = curve.points.find((point) => point.duration_seconds === seconds);
      assert.equal(cells[index * 2], point?.value != null ? dateText(point.date) : "—");
      assert.equal(cells[index * 2 + 1], valueText(point));
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
  await region().getByRole("img", { name: /^Recorded peak / }).waitFor();
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
      count = values.filter((value) => value !== null).length;
    if (count < 2) continue;
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
    assert.equal((d.match(/[ML]/g) || []).length, count);
    assert.equal((d.match(/M/g) || []).length, segments);
  }
}
async function retryAll() {
  await each(async () => {
    await region()
      .getByRole("button", { name: `Retry ${views[current].label} curve`, exact: true })
      .click();
    await region().getByRole("alert").waitFor({ state: "hidden" });
    await settle();
  });
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
function consumeErrors() {
  const http = new Map(),
    failed = new Map(),
    consoleCounts = new Map();
  for (const row of allowedHttp) {
    http.set(key(row), (http.get(key(row)) || 0) + 1);
    consoleCounts.set(row[2], (consoleCounts.get(row[2]) || 0) + 1);
  }
  for (const row of allowedFailures) failed.set(key(row), (failed.get(key(row)) || 0) + 1);
  const consume = (map, id) => {
    const count = map.get(id) || 0;
    if (!count) return false;
    map.set(id, count - 1);
    return true;
  };
  return network.entries.filter((entry) =>
    entry.kind === "http-error"
      ? !consume(http, key([entry.url, entry.method, entry.status]))
      : entry.kind === "request-failed"
        ? !consume(failed, key([entry.url, entry.method, entry.reason]))
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
  const before = await json("preview/provider-records"),
    initial = await json("personal-statistics");
  today = initial.today;
  oracle = await json("preview/chart-tag-sources");
  catalogProof = await json("chart-tags");
  const primary = { start: shift(today, -27), end: today },
    comparison = { start: shift(today, -55), end: shift(today, -28) },
    populated = { start: shift(today, -2), end: shift(today, -1) },
    running = {},
    orCurves = {},
    empty = {};
  await add();
  assert.equal(
    requests.some((row) => api(row.url) === "chart-tags"),
    false,
    "Unfiltered charts must not demand the native catalog"
  );
  phase = "catalog-loading-cancel";
  let start, release, finish;
  const started = new Promise((resolve) => {
      start = resolve;
    }),
    held = new Promise((resolve) => {
      release = resolve;
    }),
    finished = new Promise((resolve) => {
      finish = resolve;
    });
  const catalogMatch = (url) => api(url.href) === "chart-tags",
    holdCatalog = async (route) => {
      const response = await route.fetch();
      intendedAborts.add(route.request());
      start();
      await held;
      try {
        await route.fulfill({ response });
      } catch {
      } finally {
        finish();
      }
    };
  await page.route(catalogMatch, holdCatalog);
  await configure();
  await started;
  await tags().getByRole("status").filter({ hasText: "Loading recording tags" }).waitFor();
  await settings().getByRole("button", { name: "Close chart settings", exact: true }).click();
  release();
  await finished;
  await page.unroute(catalogMatch, holdCatalog);
  checks.push(
    "native-catalog-is-demand-loaded-and-closing-loading-settings-cancels-only-its-own-read"
  );
  phase = "catalog503-retry";
  await fresh();
  current = "heartRate";
  const rejectCatalog = (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic catalog failure" }),
    });
  expectedError = { status: 503, match: (url) => api(url) === "chart-tags" };
  await page.route(catalogMatch, rejectCatalog);
  await configure();
  await tags().getByRole("alert").filter({ hasText: "Synthetic catalog failure" }).waitFor();
  await page.unroute(catalogMatch, rejectCatalog);
  expectedError = null;
  await tags().getByRole("button", { name: "Reload recording tags", exact: true }).click();
  await catalogReady();
  for (const tag of oracle.catalog)
    await tags().getByLabel(`Recording tag: ${tag}`, { exact: true }).waitFor();
  await selectTags(["Running", "Cycling"]);
  assert.equal(await tags().getByLabel("All", { exact: true }).isChecked(), false);
  await tags().getByLabel("All", { exact: true }).check();
  for (const tag of oracle.catalog)
    assert.equal(
      await tags().getByLabel(`Recording tag: ${tag}`, { exact: true }).isChecked(),
      false
    );
  await settings().getByRole("button", { name: "Close chart settings", exact: true }).click();
  checks.push(
    "catalog-failure-reload-and-exclusive-all-preserve-exact-native-checkbox-values-without-saving"
  );
  phase = "empty-catalog";
  await scenario("empty");
  await fresh();
  current = "heartRate";
  await configure();
  await catalogReady();
  await tags().getByText("No recording tags are available.", { exact: true }).waitFor();
  assert.equal(await tags().getByRole("alert").count(), 0);
  assert.equal(await tags().getByLabel("All", { exact: true }).isChecked(), true);
  await settings().getByRole("button", { name: "Close chart settings", exact: true }).click();
  await scenario("default");
  await fresh();
  current = "heartRate";
  checks.push("genuine-empty-native-catalog-is-distinct-from-loading-and-http-error");
  phase = "single-tag-raw";
  await configure();
  await selectTags(["Running"]);
  await dates(primary);
  await apply();
  running.heartRate = await source("heartRate", ["Running"], primary);
  assert.deepEqual(
    running.heartRate.points.map((point) => point.value),
    [200, null, 180, 180]
  );
  assert.ok(oracle.sources.find((row) => row.activity.id === "i760000001").values.heartRate > 180);
  await chart(running.heartRate);
  checks.push(
    "filter-before-maxima-recomputes-slower-tagged-hr-winner-instead-of-removing-untagged-aggregate-winner"
  );
  phase = "all-four-sensors";
  for (current of ["power", "cadence", "velocity"]) {
    await add();
    await configure();
    await selectTags(["Running"]);
    await dates(primary);
    await settings().getByLabel("Grid", { exact: true }).check();
    await apply();
    running[current] = await source(current, ["Running"], primary);
    await grid(running[current]);
  }
  current = "heartRate";
  await configure();
  await settings().getByLabel("Grid", { exact: true }).check();
  await apply();
  await grid(running.heartRate);
  assert.equal(running.power.points.find((row) => row.duration_seconds === 60).value, 300);
  assert.equal(running.cadence.points.find((row) => row.duration_seconds === 60).value, 85);
  assert.equal(running.velocity.points.find((row) => row.duration_seconds === 60).value, 5);
  for (const body of Object.values(running)) {
    assert.equal(body.coverage.unknownMembershipRecordings, 3);
    assert.equal(body.coverage.status, "partial");
    assert.equal(
      body.points.some((row) =>
        ["i760000005", "i760000006", "i760000007", "i760000008"].includes(row.activity_id)
      ),
      false
    );
  }
  checks.push(
    "four-sensor-tagged-maxima-derive-from-raw-matching-sources-with-unknown-membership-ignore-and-short-exclusion"
  );
  phase = "or-selection";
  await each(async () => {
    await configure();
    await selectTags(["Running", "Cycling"]);
    await settings().getByLabel("Chart", { exact: true }).check();
    await apply();
    orCurves[current] = await source(current, ["Running", "Cycling"], primary);
    await chart(orCurves[current]);
  });
  assert.equal(orCurves.heartRate.points.find((row) => row.duration_seconds === 60).value, 190);
  assert.equal(orCurves.power.points.find((row) => row.duration_seconds === 60).value, 400);
  assert.equal(orCurves.cadence.points.find((row) => row.duration_seconds === 60).value, 90);
  assert.equal(orCurves.velocity.points.find((row) => row.duration_seconds === 60).value, 10);
  checks.push(
    "multi-tag-any-or-union-uses-cycling-and-running-sources-without-requiring-intersection"
  );
  phase = "exact-tag-strings";
  current = "heartRate";
  for (const [selected, expected] of [
    [["Case,Comma"], 180],
    [["Élite"], 190],
    [["running"], 0],
  ]) {
    await configure();
    await selectTags(selected);
    await settings().getByLabel("Grid", { exact: true }).check();
    await apply();
    const actual = await source(current, selected, primary);
    await grid(actual);
    assert.equal(actual.points.find((row) => row.duration_seconds === 60).value, expected);
  }
  checks.push("comma-unicode-and-case-sensitive-tags-remain-exact-and-known-zero-is-not-missing");
  phase = "comparison";
  await each(async () => {
    await configure();
    await selectTags(["Running"]);
    await settings().getByLabel("Comparison", { exact: true }).check();
    await dates(populated, true);
    await settings().getByLabel("Chart", { exact: true }).check();
    await apply();
    await chart(running[current], await source(current, ["Running"], populated));
    await configure();
    await dates(comparison, true);
    await settings().getByLabel("Grid", { exact: true }).check();
    await apply();
    empty[current] = await source(current, ["Running"], comparison);
    assert.deepEqual(empty[current].points, []);
    await grid(running[current], empty[current]);
  });
  checks.push(
    "tag-filtered-comparison-binds-independent-ranges-and-preserves-both-native-svg-gaps-and-empty-columns"
  );
  phase = "preferences";
  const prefs = await json("training-preferences"),
    instances = Object.values(prefs.training_preferences)
      .filter((value) => value && Array.isArray(value.instances))
      .flatMap((value) => value.instances);
  for (const type of ["peak-hr", "peak-power", "peak-cadence", "peak-speed"])
    assert.deepEqual(instances.find((row) => row.type === type).tags, ["Running"]);
  await fresh();
  await each(async () => {
    await settle();
    await grid(running[current], empty[current]);
    await configure();
    await catalogReady();
    assert.equal(
      await tags().getByLabel("Recording tag: Running", { exact: true }).isChecked(),
      true
    );
    assert.equal(await tags().getByLabel("All", { exact: true }).isChecked(), false);
    await settings().getByRole("button", { name: "Close chart settings", exact: true }).click();
  });
  checks.push(
    "actual-json-tag-arrays-and-comparison-preferences-survive-independent-browser-context"
  );
  phase = "response-binding";
  const confirmed = {};
  await each(async () => {
    confirmed[current] = await grid(running[current], empty[current]);
  });
  const curveMatch = (url) => filtered(url.href);
  const reject = (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Synthetic filtered-source failure" }),
    });
  expectedError = { status: 503, match: filtered };
  await page.route(curveMatch, reject);
  await button("Refresh training analysis").click();
  await each(async () => {
    await region().getByRole("alert").waitFor();
    assert.deepEqual(await region().locator("tbody tr").allTextContents(), confirmed[current]);
  });
  await page.unroute(curveMatch, reject);
  expectedError = null;
  await retryAll();
  for (const mutation of ["window", "scope", "revision", "tags", "provenance", "coverage"]) {
    const wrong = async (route) => {
      const response = await route.fetch(),
        body = await response.json();
      if (mutation === "window") body.window.oldest = shift(body.window.oldest, -1);
      if (mutation === "scope") body.accountScope = "f".repeat(64);
      if (mutation === "revision") body.catalogRevision = "e".repeat(64);
      if (mutation === "tags") body.selection.tags = ["Cycling"];
      if (mutation === "provenance" && body.points.length) body.points[0].sourceTags = [];
      if (mutation === "coverage") body.coverage.matchedRecordings++;
      await route.fulfill({ response, json: body });
    };
    await page.route(curveMatch, wrong);
    await button("Refresh training analysis").click();
    await each(async () => {
      await region().getByRole("alert").waitFor();
      assert.deepEqual(await region().locator("tbody tr").allTextContents(), confirmed[current]);
    });
    await page.unroute(curveMatch, wrong);
    await retryAll();
  }
  checks.push(
    "503-and-wrong200-window-account-catalog-selection-membership-and-coverage-retain-all-confirmed-pairs"
  );
  phase = "server-bindings";
  for (const field of ["accountScope", "revision"]) {
    const fake = (field === "accountScope" ? "d" : "c").repeat(64),
      wrongCatalog = async (route) => {
        const response = await route.fetch(),
          body = await response.json();
        body[field] = fake;
        await route.fulfill({ response, json: body });
      },
      beforeLedger = (await json("preview/chart-tag-sources")).requests.length;
    expectedError = {
      status: 409,
      match: (url) =>
        filtered(url) &&
        new URL(url).searchParams.get(field === "accountScope" ? "tagScope" : "tagRevision") ===
          fake,
    };
    await page.route(catalogMatch, wrongCatalog);
    await button("Refresh training analysis").click();
    await each(async () => {
      await region().getByRole("alert").waitFor();
      assert.deepEqual(await region().locator("tbody tr").allTextContents(), confirmed[current]);
    });
    const delta = (await json("preview/chart-tag-sources")).requests.slice(beforeLedger);
    assert.equal(
      delta.some(
        (path) =>
          path.includes("/activities?") ||
          path.includes("-curve.json") ||
          path.includes("-curves.json")
      ),
      false
    );
    await page.unroute(catalogMatch, wrongCatalog);
    expectedError = null;
    await retryAll();
  }
  checks.push(
    "real-server-account-and-revision409-reject-before-inventory-or-source-fetch-without-autobroadening"
  );
  phase = "vanished-selection";
  await scenario("removed");
  const beforeRemoved = requests.length;
  await button("Refresh training analysis").click();
  await each(async () => {
    await region().getByRole("alert").waitFor();
    assert.deepEqual(await region().locator("tbody tr").allTextContents(), confirmed[current]);
  });
  assert.equal(
    requests
      .slice(beforeRemoved)
      .some(
        (row) =>
          api(row.url) === "personal-statistics" ||
          (api(row.url) === "performance-curves" && !filtered(row.url))
      ),
    false
  );
  let allStart = requests.length;
  await each(async () => {
    await configure();
    await catalogReady();
    await tags().getByRole("button", { name: "Reload recording tags", exact: true }).click();
    await catalogReady();
    await tags()
      .getByRole("alert")
      .filter({ hasText: "Selected tags are unavailable: Running" })
      .waitFor();
    const writesBefore = preferenceWrites.length;
    await settings().getByRole("button", { name: "Apply & Close", exact: true }).click();
    await settings().getByRole("alert").filter({ hasText: "must be verified" }).waitFor();
    assert.equal(preferenceWrites.length, writesBefore);
    await tags().getByLabel("All", { exact: true }).check();
    await apply();
  });
  checks.push(
    "vanished-native-tag-is-retained-and-apply-blocked-until-explicit-all-clear-with-real-reload"
  );
  phase = "all-unfiltered";
  const fallback = requests.slice(allStart);
  for (const kind of ["heartRate", "power", "cadence", "velocity"])
    assert.ok(
      fallback.some(
        (row) =>
          api(row.url) === "performance-curves" &&
          new URL(row.url).searchParams.get("kind") === kind &&
          !new URL(row.url).searchParams.has("tags")
      )
    );
  const nativePower = await json(`performance-curves?${new URLSearchParams({ kind: "power", sport: "all", start: primary.start, end: primary.end })}`);
  assert.equal(nativePower.source, "intervals-activity-power-curves");
  const nativePowerSources = await json("preview/native-power-sources"), nativePoint = nativePower.points.find(point => point.duration_seconds === 5), nativeRecording = nativePowerSources.sources.find(row => row.activity.id === nativePoint.activity_id);
  assert.ok(nativeRecording);
  const rawTime = nativeRecording.streams.find(row => row.type === "time").data, rawWatts = nativeRecording.streams.find(row => row.type === "watts").data;
  assert.equal(rawTime[5] - rawTime[0], 5);
  assert.equal(rawWatts.slice(0, 5).reduce((sum, value, index) => sum + value * (rawTime[index + 1] - rawTime[index]), 0) / 5, nativePoint.value);
  assert.equal(nativePoint.value, 500);
  current = "power";
  await grid(nativePower, await json(`performance-curves?${new URLSearchParams({ kind: "power", sport: "all", start: comparison.start, end: comparison.end })}`));
  current = "heartRate";
  await scenario("default");
  const catalogReadsBefore = requests.filter((row) => api(row.url) === "chart-tags").length;
  await fresh();
  await each(settle);
  assert.equal(requests.filter((row) => api(row.url) === "chart-tags").length, catalogReadsBefore);
  current = "heartRate";
  await configure();
  await catalogReady();
  assert.equal(await tags().getByLabel("All", { exact: true }).isChecked(), true);
  for (const tag of oracle.catalog)
    assert.equal(
      await tags().getByLabel(`Recording tag: ${tag}`, { exact: true }).isChecked(),
      false
    );
  await settings().getByRole("button", { name: "Close chart settings", exact: true }).click();
  checks.push(
    "exclusive-all-explicitly-restores-original-v1-readers-without-new-unfiltered-catalog-demand"
  );
  phase = "filter-before-cap";
  await each(async () => {
    await configure();
    await selectTags(["Running"]);
    await settings().getByLabel("Comparison", { exact: true }).uncheck();
    await settings().getByLabel("Grid", { exact: true }).check();
    await apply();
  });
  await scenario("cap");
  assert.equal(oracle.sources.length, 260);
  await button("Refresh training analysis").click();
  await each(settle);
  for (current of Object.keys(views)) {
    const capped = await source(current, ["Running"], primary);
    assert.equal(capped.coverage.inventoryRecords, 260);
    assert.equal(capped.coverage.matchedRecordings, 130);
    assert.equal(capped.coverage.unmatchedRecordings, 130);
    assert.equal(capped.coverage.fetchedRecordings, 128);
    assert.equal(capped.coverage.skippedForCap, 2);
    await grid(capped);
  }
  const capProof = await json("preview/chart-tag-sources"),
    matchedIds = new Set(oracle.sources.slice(130, 258).map((row) => row.activity.id)),
    curveReads = capProof.requests.filter((path) => /^\/activity\//.test(path));
  assert.equal(curveReads.length, 128 * 4);
  assert.equal(
    curveReads.every((path) => matchedIds.has(path.split("/")[2])),
    true
  );
  await scenario("default");
  await button("Refresh training analysis").click();
  await each(settle);
  checks.push(
    "native-membership-filter-precedes128-cap-so130-unmatched-records-never-displace-matching-sources"
  );
  phase = "numeric-summary";
  const opened = [];
  page.on("request", (request) => opened.push(request.url()));
  await each(async () => {
    await grid(running[current]);
    const point = running[current].points.find((point) => point.duration_seconds === 5),
      recording = await json(`workout-history/${point.activity_id}`);
    assert.equal(recording.workout.activity_id, point.activity_id);
    assert.equal(recording.workout.workout_date, point.date);
    await region()
      .getByRole("button", {
        name: `Open ${views[current].label} source recording for 5 sec on ${dateText(point.date)}`,
        exact: true,
      })
      .click();
    await page.waitForURL(
      (url) => url.searchParams.get("workout") === `activity:${point.activity_id}`
    );
    await button("Analyze").waitFor();
    assert.equal(new URL(page.url()).searchParams.has("effort"), false);
    assert.equal(
      await page.getByRole("region", { name: "Recorded workout analysis", exact: true }).count(),
      0
    );
    assert.equal(
      await page.locator("[data-selected-effort-start],[data-selected-activity-effort]").count(),
      0
    );
    await finiteReads(point.activity_id);
    await button("Close workout details").click();
    await region().waitFor();
  });
  assert.equal(
    opened.some((url) => api(url).includes("performance-effort")),
    false
  );
  checks.push(
    "all-four-tagged-numeric-sources-open-independent-raw-recording-summary-without-autoanalysis-or-highlight"
  );
  phase = "late-binding";
  current = "heartRate";
  const heldRange = { start: shift(today, -89), end: shift(today, -62) };
  let began, releaseCurve, done;
  const beganPromise = new Promise((resolve) => {
      began = resolve;
    }),
    heldCurve = new Promise((resolve) => {
      releaseCurve = resolve;
    }),
    donePromise = new Promise((resolve) => {
      done = resolve;
    });
  const holdMatch = (url) =>
      filtered(url.href) &&
      url.searchParams.get("kind") === "heartRate" &&
      url.searchParams.get("start") === heldRange.start,
    hold = async (route) => {
      const response = await route.fetch();
      intendedAborts.add(route.request());
      began();
      await heldCurve;
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
  await beganPromise;
  await configure();
  await dates(primary);
  await selectTags(["Cycling"]);
  await apply();
  const cycling = await source(current, ["Cycling"], primary),
    newRows = await grid(cycling);
  releaseCurve();
  await donePromise;
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
  assert.deepEqual(await region().locator("tbody tr").allTextContents(), newRows);
  await page.unroute(holdMatch, hold);
  for (current of ["power", "cadence", "velocity"]) await grid(running[current]);
  checks.push(
    "late-canceled-prior-window-and-tag-selection-cannot-overwrite-newer-binding-or-other-charts"
  );
  const after = await json("preview/provider-records");
  assert.deepEqual(after.writes, before.writes);
  assert.deepEqual(errors, []);
  assert.deepEqual(consumeErrors(), []);
  assert.equal(
    await hash(new URL("../ui/dist/index.html", import.meta.url)),
    checkpoint.files.find((row) => row.file.endsWith("/ui/dist/index.html")).sha256
  );
  checks.push(
    "tagged-browser-workflows-have-no-native-writes-unexpected-runtime-network-or-artifact-change"
  );
  assert.equal(checks.length, 17);
  await page.screenshot({
    path: path.join(output, "verified-native-tags.png"),
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
  if (synthetic && scenarioActive !== "default")
    try {
      await scenario("default");
    } catch (error) {
      errors.push(`Tag fixture cleanup failed: ${error.message}`);
      console.error(errors.at(-1));
      process.exitCode = 1;
    }
  const evidence = structuredClone(network.entries);
  await browser.close();
  await fs.writeFile(
    path.join(output, "results.json"),
    JSON.stringify(
      {
        synthetic: true,
        passed: checks.length,
        checks,
        errors,
        checkpoint,
        requests,
        preferenceWrites,
        allowedHttp,
        allowedFailures,
        limitations: {
          visualPercentageCertified: false,
          actualActorSwitchBrowserHookAvailable: false,
          actorIsolationCoveredByServerAndClientTests: true,
          unfilteredFixtureAndTaggedInventoryNumericallyCompared: false,
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
