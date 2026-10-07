// Start `npx vite --config tests/replay.vite.config.ts` from ui before running.
// Actual replay components, synthetic ride data and a perpetually tile-starved
// Mapbox fixture exercise playback without any provider/database transport.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5178";
const browser = await playwright.chromium.launch({
  headless: true,
  channel: process.env.APP_TEST_BROWSER || "msedge",
});
const output = path.resolve("artifacts/reliability");
await fs.mkdir(output, { recursive: true });
const results = [];
const read = (page) =>
  page.evaluate(() => ({
    progress: Number(document.querySelector('[aria-label="Replay progress"]')?.value),
    enabled: Boolean(
      document.querySelector('[aria-label="Replay progress"]') &&
      !document.querySelector('[aria-label="Replay progress"]')?.disabled
    ),
    map: structuredClone(window.__replayMapFixture),
    fixture: structuredClone(window.__replayFixture),
    now: performance.now(),
    readyAt: window.__replayReadyAt,
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    buttons: Array.from(document.querySelectorAll("button")).map((button) =>
      button.getAttribute("aria-label")
    ),
  }));
const reveal = (page) => page.getByLabel("Replay progress", { exact: true }).focus();
const seek = async (page, value) => {
  await reveal(page);
  await page.getByLabel("Replay progress", { exact: true }).evaluate((element, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(
      element,
      String(value)
    );
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
  assert.equal(
    (await read(page)).progress,
    value,
    "Seeking must update the replay position immediately"
  );
};
const play = async (page) => {
  await reveal(page);
  assert.ok(
    (await read(page)).buttons.includes("Play replay"),
    `Seeking must pause/reset before play: ${JSON.stringify(await read(page))}`
  );
  await page.getByLabel("Play replay", { exact: true }).click();
};
const fixturePage = async (flags, width = 390, height = 844) => {
  const context = await browser.newContext({ viewport: { width, height } });
  const blocked = [];
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
    blocked.push(url.origin === origin ? url.pathname : url.origin);
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      const input = document.querySelector('[aria-label="Replay progress"]');
      if (input && !input.disabled && window.__replayReadyAt === undefined)
        window.__replayReadyAt = performance.now();
    });
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["disabled"],
    });
  });
  await page.clock.install({ time: new Date("2026-10-06T12:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-06T13:00:00Z"));
  await page.goto(`${origin}/tests/route-replay.html?no-load&${flags}`, {
    waitUntil: "networkidle",
  });
  return { context, page, errors, blocked };
};

try {
  for (const scenario of [
    { name: "huge-desktop", width: 1440, height: 1000, flags: "long&huge" },
    { name: "huge-mobile", width: 390, height: 844, flags: "long&huge" },
    { name: "slow-analysis", width: 390, height: 844, flags: "long&slow" },
    { name: "geometry-fallback", width: 390, height: 844, flags: "long&fallback" },
    { name: "empty-to-valid", width: 390, height: 844, flags: "long&slow&empty" },
    { name: "imagery-error", width: 390, height: 844, flags: "long&fault=imagery" },
  ]) {
    const { context, page, errors, blocked } = await fixturePage(
      `direct&${scenario.flags}`,
      scenario.width,
      scenario.height
    );
    if (scenario.name === "empty-to-valid") {
      const empty = await read(page);
      assert.equal(
        empty.enabled,
        false,
        "Empty route must remain disabled while its recording is pending"
      );
      assert.equal(empty.map.mapsCreated, 0, "Empty route must not allocate a map");
      await page.clock.runFor(6100);
    }
    let startup;
    for (let index = 0; index < 30; index++) {
      await page.clock.runFor(25);
      startup = await read(page);
      if (startup.enabled) break;
    }
    assert.ok(
      startup.enabled,
      `${scenario.name}: usable route must play even though Mapbox never emits load`
    );
    assert.ok(
      startup.readyAt - startup.map.createdAt <= 1000,
      `${scenario.name}: map readiness delayed: ${JSON.stringify(startup)}`
    );
    assert.equal(startup.fixture.duration, 21600);
    assert.equal(startup.fixture.distance, 200000);
    assert.ok(
      startup.fixture.calls.every(
        (route) => route.split("?")[0].endsWith("/analysis") || route === "config"
      ),
      `Direct replay should only request its mocked analysis/theme: ${startup.fixture.calls}`
    );
    assert.ok(!startup.overflow);
    assert.equal(startup.map.mapsCreated, 1);
    const routeSources = startup.map.sourcesAdded.filter((source) => source.id === "replay-route");
    assert.equal(routeSources.length, 1, "Route geometry must be uploaded once at startup");
    assert.ok(
      routeSources[0].coordinates >= 2 && routeSources[0].coordinates <= 6001,
      "Huge route GPU input must remain bounded"
    );
    assert.equal(
      startup.map.flyToCalls,
      0,
      "Replay must not wait through a camera entrance animation"
    );
    await reveal(page);
    await page.getByLabel("Pause replay", { exact: true }).click();
    const paused = (await read(page)).progress;
    await page.clock.runFor(500);
    assert.equal((await read(page)).progress, paused, "Paused replay must not advance");

    const rates = [];
    for (const speed of [25, 50, 100]) {
      await seek(page, 0);
      await page.getByLabel("Replay speed", { exact: true }).selectOption(String(speed));
      await play(page);
      const samples = [];
      for (let index = 0; index < 10; index++) {
        await page.clock.runFor(100);
        samples.push((await read(page)).progress);
      }
      assert.ok(
        samples.every((value, index) => value > (samples[index - 1] ?? 0)),
        `${scenario.name}: ${speed}× replay stalled with missing tiles: ${samples}`
      );
      rates.push({ speed, samples });
      await reveal(page);
      await page.getByLabel("Pause replay", { exact: true }).click();
    }
    const rate25 = rates[0].samples.at(-1),
      rate50 = rates[1].samples.at(-1),
      rate100 = rates[2].samples.at(-1);
    assert.ok(
      Math.abs(rate50 / rate25 - 2) < 0.15 && Math.abs(rate100 / rate50 - 2) < 0.15,
      `${scenario.name}: playback speed must scale linearly: ${rate25}, ${rate50}, ${rate100}`
    );

    await seek(page, 0);
    await page.getByLabel("Replay speed", { exact: true }).selectOption("10");
    await play(page);
    const beforeContinuous = await read(page);
    const continuous = [];
    for (let index = 0; index < 63; index++) {
      await page.clock.runFor(200);
      const snapshot = await read(page);
      continuous.push(snapshot.progress);
      assert.ok(
        snapshot.progress > (continuous.at(-2) ?? 0),
        `${scenario.name}: playback paused while tiles remained unavailable: ${continuous}`
      );
      if (snapshot.progress === 1000) break;
    }
    const complete = await read(page);
    assert.notDeepEqual(
      complete.map.lastMarkerPosition,
      beforeContinuous.map.lastMarkerPosition,
      "The rider marker must advance with playback"
    );
    assert.equal(
      complete.progress,
      1000,
      `${scenario.name}: 10× must finish the entire six-hour ride within 12.6 seconds`
    );
    assert.ok(complete.now - beforeContinuous.now <= 12600);
    assert.equal(complete.map.mapsCreated, 1, "Playback/speed changes must not recreate the map");
    assert.equal(
      complete.map.sourcesAdded.filter((source) => source.id === "replay-route").length,
      1
    );
    // A slow analysis may replace the initial GPS route once. Playback itself
    // must never allocate/re-upload a GeoJSON route for each rendered frame.
    assert.ok(
      complete.map.sourceUpdates <= 1,
      `${scenario.name}: route source rebuilt ${complete.map.sourceUpdates} times`
    );
    const elapsedSeconds = (complete.now - beforeContinuous.now) / 1000;
    const cameraUpdates = complete.map.cameraUpdates - beforeContinuous.map.cameraUpdates;
    assert.ok(
      cameraUpdates <= elapsedSeconds * 31 + 5,
      `${scenario.name}: camera exceeded its 30 Hz budget (${cameraUpdates}/${elapsedSeconds}s)`
    );
    const cameraSettingsUpdates =
      complete.map.cameraSettingsUpdates - beforeContinuous.map.cameraSettingsUpdates;
    assert.ok(
      cameraSettingsUpdates <= 2,
      `${scenario.name}: zoom/pitch/padding were sent every frame (${cameraSettingsUpdates})`
    );
    assert.equal(complete.map.tileChecks, 0, "Playback must not poll tile readiness");
    await reveal(page);
    await page.getByLabel("Play again", { exact: true }).click();
    await page.clock.runFor(100);
    assert.ok(
      (await read(page)).progress > 0 && (await read(page)).progress < 1000,
      "Replay complete must restart from the beginning"
    );
    await seek(page, 600);
    const seeked = (await read(page)).progress;
    await page.clock.runFor(300);
    assert.equal(
      (await read(page)).progress,
      seeked,
      "Seeking pauses playback at the chosen position"
    );
    await page.getByLabel("3D view", { exact: true }).click();
    await page.clock.runFor(100);
    const beforeOverview = (await read(page)).map.cameraSettingsUpdates;
    await page.getByLabel("Follow route", { exact: true }).click();
    await page.clock.runFor(100);
    assert.equal(
      await page.getByLabel("Follow route", { exact: true }).getAttribute("aria-pressed"),
      "false"
    );
    const afterOverview = (await read(page)).map.cameraSettingsUpdates;
    assert.ok(afterOverview > beforeOverview, "Turning Follow off must fit the route overview");
    await page.getByLabel("Follow route", { exact: true }).click();
    await page.clock.runFor(100);
    assert.equal(
      await page.getByLabel("Follow route", { exact: true }).getAttribute("aria-pressed"),
      "true"
    );
    assert.ok(
      (await read(page)).map.cameraSettingsUpdates > afterOverview,
      "Returning to Follow must restore its zoom/pitch/padding"
    );
    assert.equal((await read(page)).map.mapsCreated, 1, "View toggles must retain the same map");
    await page.screenshot({ path: path.join(output, `replay-${scenario.name}.png`) });
    await page.getByLabel("Close route replay", { exact: true }).click();
    await page.clock.runFor(250);
    const closed = await read(page);
    assert.equal(closed.map.mapsRemoved, 1, "Closing replay must release the map");
    assert.equal(
      closed.map.markersRemoved,
      closed.map.markersCreated,
      "Closing replay must release all markers"
    );
    await page.clock.runFor(1000);
    assert.equal(
      (await read(page)).map.cameraUpdates,
      closed.map.cameraUpdates,
      "Closing replay must cancel camera work"
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, [], "No real API or off-origin requests should be attempted");
    results.push({
      scenario: scenario.name,
      points: startup.fixture.points,
      readyAfterMapCreationMs: startup.readyAt - startup.map.createdAt,
      coordinates: routeSources[0].coordinates,
      rates,
      continuous,
      cameraUpdates,
      elapsedSeconds,
      map: closed.map,
      calls: closed.fixture.calls,
      errors,
      blocked,
    });
    await context.close();
  }
  for (const fault of [
    "control",
    "source",
    "source-sync-error",
    "layer",
    "worker",
    "paint",
    "route-update",
  ]) {
    const { context, page, errors, blocked } = await fixturePage(
      `direct&long&fault=${fault}${fault === "route-update" ? "&slow" : ""}`
    );
    await page.clock.runFor(fault === "route-update" ? 6500 : 250);
    await page.getByText("The satellite map couldn’t load.", { exact: true }).waitFor();
    assert.deepEqual(errors, [], `${fault}: setup failure must not escape its error UI`);
    const failed = await read(page);
    await page.clock.runFor(500);
    assert.equal(
      (await read(page)).map.cameraUpdates,
      failed.map.cameraUpdates,
      `${fault}: failed maps must stop camera work immediately`
    );
    await page.getByRole("button", { name: "Retry map", exact: true }).click();
    for (let index = 0; index < 20 && !(await read(page)).enabled; index++)
      await page.clock.runFor(25);
    assert.ok((await read(page)).enabled, `${fault}: retry must create a usable replacement map`);
    await play(page);
    await page.clock.runFor(200);
    assert.ok((await read(page)).progress > 0, `${fault}: successful retry must resume playback`);
    await reveal(page);
    await page.getByLabel("Close route replay", { exact: true }).click();
    await page.clock.runFor(250);
    const closed = await read(page);
    assert.equal(closed.map.mapsCreated, 2, `${fault}: exactly one replacement map is required`);
    assert.equal(
      closed.map.mapsRemoved,
      closed.map.mapsCreated,
      `${fault}: failed/retried maps must all be released`
    );
    assert.equal(
      closed.map.markersRemoved,
      closed.map.markersCreated,
      `${fault}: all partially created markers must be released`
    );
    await page.clock.runFor(1000);
    assert.equal(
      (await read(page)).map.cameraUpdates,
      closed.map.cameraUpdates,
      `${fault}: no camera work may survive close`
    );
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    results.push({ scenario: `setup-failure-${fault}`, map: closed.map, errors, blocked });
    await context.close();
  }
  {
    const { context, page, errors, blocked } = await fixturePage("button&long");
    await page.getByLabel("Replay route", { exact: true }).waitFor();
    await page.getByLabel("Replay route", { exact: true }).click();
    for (let index = 0; index < 20 && !(await read(page)).enabled; index++)
      await page.clock.runFor(25);
    assert.ok((await read(page)).enabled);
    await seek(page, 600);
    await page.getByLabel("Replay speed", { exact: true }).selectOption("50");
    await page.evaluate(() => window.__replayRelink());
    for (let index = 0; index < 20; index++) {
      await page.clock.runFor(25);
      if ((await read(page)).map.mapsCreated === 2 && (await read(page)).enabled) break;
    }
    await page
      .getByTestId("replay-metrics")
      .getByText("Relinked recording fixture", { exact: true })
      .waitFor();
    const relinked = await read(page);
    assert.equal(
      relinked.map.mapsCreated,
      2,
      "Relinking the same workout to another recording must remount its replay"
    );
    assert.equal(
      relinked.map.mapsRemoved,
      1,
      "Relinking must release the previous recording's map"
    );
    assert.ok(relinked.progress < 600, "The new recording must start at the beginning");
    assert.equal(
      await page.getByLabel("Replay speed", { exact: true }).inputValue(),
      "50",
      "Playback speed preference must survive the new recording"
    );
    assert.ok(
      relinked.fixture.calls.includes("activities/replay-linked/analysis"),
      "The new linked recording must request its own analysis"
    );
    await reveal(page);
    await page.getByLabel("Close route replay", { exact: true }).click();
    await page.clock.runFor(250);
    const closed = await read(page);
    assert.equal(closed.map.mapsRemoved, 2);
    assert.equal(closed.map.markersRemoved, closed.map.markersCreated);
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    results.push({
      scenario: "recording-relink",
      map: closed.map,
      calls: closed.fixture.calls,
      errors,
      blocked,
    });
    await context.close();
  }
  await fs.writeFile(
    path.join(output, "route-replay-results.json"),
    JSON.stringify(results, null, 2)
  );
  console.log(
    JSON.stringify(
      results.map(
        ({
          scenario,
          points,
          coordinates,
          elapsedSeconds,
          cameraUpdates,
          map,
          errors,
          blocked,
        }) => ({
          scenario,
          points,
          coordinates,
          elapsedSeconds,
          cameraUpdates,
          mapsCreated: map.mapsCreated,
          mapsRemoved: map.mapsRemoved,
          sourceUpdates: map.sourceUpdates,
          errors,
          blocked,
        })
      ),
      null,
      2
    )
  );
} finally {
  await browser.close();
}
