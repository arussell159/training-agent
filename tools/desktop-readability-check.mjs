// Exercise the built app with synthetic calendar data and no provider transport.
// Run --before before rebuilding ui/dist; default captures the updated build.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import http from "node:http";
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
const before = process.argv.includes("--before"),
  stage = before ? "before" : "after";
const root = path.resolve("ui/dist"),
  output = path.resolve("artifacts/reliability");
await fs.mkdir(output, { recursive: true });
const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const now = new Date(),
  monday = new Date(now);
monday.setHours(12, 0, 0, 0);
monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
const day = (offset) => {
  const date = new Date(monday);
  date.setDate(date.getDate() + offset);
  return dateKey(date);
};
// Keep unknown and zero recordings present regardless of the weekday of a later run.
// Only Date is fixed in the browser; timers and animation frames continue normally.
now.setTime(Date.parse(`${day(3)}T12:00:00Z`));
const today = dateKey(now);
const specifications = [
  [
    0,
    "Run",
    "Easy aerobic run with relaxed strides",
    50,
    48,
    8500,
    43,
    "Keep the effort conversational. Finish with six relaxed strides.",
  ],
  [
    1,
    "Swim",
    "Technique and aerobic endurance — catch, rotation and breathing",
    60,
    58,
    2400,
    48,
    "Warm up, then alternate technique drills and smooth aerobic repeats.",
  ],
  [
    1,
    "Strength",
    "Strength and mobility: posterior chain, hips and trunk stability",
    35,
    32,
    0,
    22,
    "Three rounds of split squats, hinges and controlled core work.",
  ],
  [
    2,
    "Ride",
    "Threshold intervals — 3 × 12 minutes with steady recovery",
    90,
    87,
    43000,
    91,
    "Build power smoothly. Keep cadence comfortable and hold the final interval.",
  ],
  [
    3,
    "Run",
    "Recovery jog — recording with missing training load",
    35,
    34,
    5500,
    undefined,
    "Stay in zone 1–2 and finish feeling fresh.",
  ],
  [
    4,
    "Swim",
    "Race pace development — controlled 100s and long aerobic finish",
    65,
    0,
    2600,
    63,
    "Repeat 12 × 100 at race pace, then finish with 400 easy.",
  ],
  [
    4,
    "Run",
    "Easy mobility walk — explicitly zero training load",
    25,
    0,
    4800,
    0,
    "Practice the transition and settle into a smooth race rhythm.",
  ],
  [
    5,
    "Ride",
    "Long zone 2 endurance ride with fueling rehearsal and rolling hills",
    180,
    0,
    82000,
    136,
    "Take in 70–90g carbohydrate per hour and stay controlled on the hills.",
  ],
];
const workouts = [];
for (let week = -2; week <= 2; week++)
  for (let index = 0; index < specifications.length; index++) {
    const [offset, recordedSport, title, planned, recorded, distance, tss, goal] =
        specifications[index],
      date = day(week * 7 + offset);
    const sport = !before && recordedSport === "Ride" ? "Bike" : recordedSport,
      isBike = /Bike|Ride/.test(sport);
    const completed = date <= today && (week < 0 || offset < now.getDay() - 1 || recorded > 0);
    const unknownRecording = !before && completed && tss === undefined;
    const minutes = completed ? recorded || planned : planned;
    const id = `fixture-${week + 2}-${index}`;
    const completedTss = tss === undefined ? undefined : Math.round(tss * 0.96);
    const plannedValues = {
      duration_seconds: planned * 60,
      distance_meters: distance,
      tss,
      intensity_factor: tss === undefined ? undefined : isBike ? 0.78 : 0.74,
      average_speed: distance ? distance / (planned * 60) : null,
    };
    const actualValues = completed
      ? {
          ...plannedValues,
          duration_seconds: minutes * 60,
          elapsed_time_seconds: (minutes + 2) * 60,
          distance_meters: distance * 0.98,
          tss: unknownRecording ? null : completedTss,
          average_hr: 143,
          max_hr: 167,
          average_cadence: isBike ? 86 : 168,
          calories: Math.round(minutes * 9),
          average_power: isBike ? 187 : null,
          elevation_gain: isBike ? 410 : 42,
        }
      : null;
    workouts.push({
      id: completed ? `activity:${id}` : `event:${id}`,
      activity_id: completed ? id : null,
      date,
      workout_date: date,
      day: new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" }),
      sport,
      title,
      duration: `${planned}m`,
      goal,
      details: `${goal}\n\nA realistic synthetic workout for checking calendar readability.`,
      status: completed ? "completed" : date === today ? "today" : "upcoming",
      plannedDurationMinutes: planned,
      actualDurationMinutes: completed ? minutes : undefined,
      planned: unknownRecording ? null : { duration_minutes: planned, tss },
      load: unknownRecording ? 0 : undefined,
      completed_data: completed
        ? { duration_minutes: minutes, tss: unknownRecording ? 0 : completedTss }
        : undefined,
      workout_summary: {
        planned: unknownRecording ? null : plannedValues,
        completed: actualValues,
      },
      recorded_start_local: completed ? `${date}T06:30:00` : null,
      device_name: completed ? "Fixture recording" : null,
    });
  }
const full = {
  athlete: {
    name: "Alex Russell",
    time_zone: "America/Chicago",
    phase: "Build",
    zones: { bike_ftp: 250, run_threshold_pace: "7:15", swim_css: "1:45" },
  },
  metrics: { fitness: 64, fatigue: 70, form: -6 },
  wellness: { hrv: 58, resting_hr: 48, sleep: 28800 },
  wellness_history: [],
  planned: workouts,
  history: workouts.filter((row) => row.status === "completed"),
  source: "intervals.icu",
  context_scope: "full",
  retention_days: 90,
  display_range: { start: day(-14), end: day(21) },
  cached_ranges: [{ start: day(-14), end: day(21) }],
  version: "desktop-readability-v1",
  cache_scope: "isolated-desktop-readability",
  synced_at: new Date().toISOString(),
};
if (!before)
  full.wellness_history = Array.from({ length: 14 }, (_, index) => ({
    date: day(index - 10),
    hrv: 52 + ((index * 7) % 15),
    restingHR: 46 + ((index * 3) % 7),
    sleepSecs: 28800,
    sleepScore: 86,
    sleepQuality: 4,
  }));
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (request.method !== "GET" || url.pathname.startsWith("/api/")) {
    response.writeHead(405);
    return response.end("Fixture transport is handled only by the browser mocks");
  }
  try {
    const filename =
        url.pathname === "/" || !path.extname(url.pathname)
          ? "index.html"
          : decodeURIComponent(url.pathname).replace(/^\/+/, ""),
      target = path.resolve(root, filename);
    if (!target.startsWith(root + path.sep)) {
      response.writeHead(400);
      return response.end();
    }
    const data = await fs.readFile(target);
    response.writeHead(200, {
      "Content-Type":
        {
          ".html": "text/html",
          ".js": "text/javascript",
          ".css": "text/css",
          ".woff2": "font/woff2",
          ".svg": "image/svg+xml",
          ".png": "image/png",
          ".webmanifest": "application/manifest+json",
        }[path.extname(target)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(data);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const results = [];
// Resolve the actual painted text/background, including translucent ancestors.
const inspectText = (selector) => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (value) => {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = value;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
  };
  const blend = (front, back) => [
    ...front.slice(0, 3).map((channel, index) => channel * front[3] + back[index] * (1 - front[3])),
    1,
  ];
  const luminance = (color) =>
    color
      .slice(0, 3)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const texts = [];
  for (const surface of document.querySelectorAll(selector)) {
    const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode,
        element = node.parentElement,
        text = node.textContent.trim();
      if (
        !text ||
        !element?.getClientRects().length ||
        element.closest(
          '[aria-hidden="true"],[aria-disabled="true"],:disabled,.sr-only,script,style'
        )
      )
        continue;
      const bounds = element.getBoundingClientRect(),
        style = getComputedStyle(element);
      if (bounds.width < 3 || bounds.height < 3 || style.visibility !== "visible") continue;
      const chain = [];
      for (let parent = element; parent; parent = parent.parentElement) chain.push(parent);
      const opacity = chain.reduce(
        (product, parent) => product * Number(getComputedStyle(parent).opacity),
        1
      );
      if (opacity < 0.05) continue;
      const back = chain
        .reverse()
        .reduce(
          (value, parent) => blend(rgba(getComputedStyle(parent).backgroundColor), value),
          [255, 255, 255, 1]
        );
      const color = rgba(element instanceof SVGElement ? style.fill : style.color);
      color[3] *= opacity;
      const values = [luminance(blend(color, back)), luminance(back)].sort((a, b) => b - a);
      const size = parseFloat(style.fontSize),
        weight = Number(style.fontWeight);
      texts.push({
        text: text.slice(0, 100),
        size,
        contrast: Number(((values[0] + 0.05) / (values[1] + 0.05)).toFixed(2)),
        minimum: size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5,
      });
    }
  }
  return {
    minimum: Math.min(...texts.map((text) => text.contrast)),
    failures: texts.filter((text) => text.contrast < text.minimum),
    texts,
  };
};
try {
  browser = await playwright.chromium.launch({
    headless: true,
    channel: process.env.APP_TEST_BROWSER || "msedge",
  });
  for (const sample of [768, 1280, 1440, 1636, 390].flatMap((width) =>
    ["light", "dark"].map((theme) => ({
      name: `${width}-${theme}`,
      width,
      height: width === 390 ? 844 : width === 1440 ? 1000 : 900,
      theme,
    }))
  )) {
    if (process.env.APP_TEST_CASE && sample.name !== process.env.APP_TEST_CASE) continue;
    // Keep the mobile baseline data identical while exercising populated desktop recovery.
    const sampleContext = {
      ...full,
      wellness_history: sample.width < 768 ? [] : full.wellness_history,
    };
    const context = await browser.newContext({
      viewport: { width: sample.width, height: sample.height },
      colorScheme: sample.theme,
      serviceWorkers: "block",
    });
    const calls = [],
      blocked = [],
      writes = [],
      errors = [];
    const heldAssets = new Map(),
      cold = {},
      holdCold = !before && [768, 1280, 1636].includes(sample.width);
    await context.route("**/*", async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      if (url.origin !== origin) {
        blocked.push(url.origin);
        return route.abort();
      }
      if (!url.pathname.startsWith("/api/")) {
        const extension = url.pathname.match(/\/assets\/index-[^/]+\.(js|css)$/)?.[1];
        if (holdCold && extension && !heldAssets.has(extension))
          return new Promise((resolve) =>
            heldAssets.set(extension, async () => {
              await route.continue();
              resolve();
            })
          );
        return route.continue();
      }
      const api = url.searchParams.get("__api_route") || url.pathname.slice(5);
      calls.push(api);
      // training-live uses POST only to advertise read availability; no backend exists here.
      if (request.method() !== "GET" && !(api === "training-live" && request.method() === "POST")) {
        writes.push(api);
        return route.fulfill({
          status: 405,
          contentType: "application/json",
          body: JSON.stringify({ error: "Fixture writes are disabled" }),
        });
      }
      let body = {};
      if (api === "auth/session")
        body = {
          configured: true,
          authenticated: true,
          hasPasskey: false,
          passkeysSupported: false,
        };
      else if (api === "config")
        body = {
          theme: sample.theme,
          intervalsConnected: true,
          supabaseConnected: false,
          calendarSummaryOpen: true,
        };
      else if (api === "training-live") body = { available: false };
      else if (api === "training-context" || api === "training-updates") {
        const scope = url.searchParams.get("scope"),
          start = url.searchParams.get("start"),
          end = url.searchParams.get("end");
        const value =
          scope === "range"
            ? {
                ...sampleContext,
                context_scope: "range",
                display_range: { start, end },
                planned: workouts.filter((row) => row.date >= start && row.date <= end),
                history: full.history.filter((row) => row.date >= start && row.date <= end),
              }
            : sampleContext;
        body =
          api === "training-updates"
            ? { unchanged: false, version: full.version, context: value }
            : value;
      } else if (api === "annual-plans") body = { plans: [], activeId: null };
      else if (api === "training-history") body = { weeks: [] };
      else if (api === "section11-sync" || api === "section11-export")
        body = { status: "complete", version: full.version };
      else if (api === "race-events") body = { events: [] };
      else if (api === "nutrition")
        body = {
          date: url.searchParams.get("date") || today,
          day: {
            revision: 1,
            entries: [
              {
                id: "breakfast",
                name: "Greek yogurt with berries and oats",
                meal: "breakfast",
                quantity: 1,
                unit: "bowl",
                calories: 574,
                protein: 38,
                carbs: 66,
                fat: 18,
                fiber: 8,
                source: "manual",
                notes: "",
                barcode: null,
                imageUrl: null,
              },
              {
                id: "lunch",
                name: "Chicken rice and avocado",
                meal: "lunch",
                quantity: 1,
                unit: "bowl",
                calories: 683,
                protein: 46,
                carbs: 63,
                fat: 23,
                fiber: 8,
                source: "manual",
                notes: "",
                barcode: null,
                imageUrl: null,
              },
            ],
          },
          targets: { calories: 2400, protein: 160, carbs: 260, fat: 65, fiber: null },
          targetsRevision: 1,
          aiAvailable: false,
          localPreview: true,
          week: [],
        };
      else if (api.includes("reports/status")) body = { status: "not_requested", eligible: false };
      else if (/activities\/[^/]+\/summary$/.test(api))
        body =
          workouts.find((row) => row.activity_id === api.split("/")[1])?.workout_summary
            .completed || {};
      else if (/activities\/[^/]+\/route$/.test(api)) body = { points: [] };
      else if (/activities\/[^/]+\/analysis$/.test(api))
        body = {
          duration: 2880,
          points: Array.from({ length: 49 }, (_, index) => ({
            time: index * 60,
            distance: (index / 48) * 8500,
            speed: 2.95,
            heartRate: 143,
            elevation: 180,
          })),
          laps: [],
          intervals: [],
        };
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    });
    await context.addInitScript((theme) => localStorage.setItem("theme", theme), sample.theme);
    const page = await context.newPage();
    await page.clock.setFixedTime(now);
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${origin}/`, { waitUntil: holdCold ? "commit" : "networkidle" });
    const bootGeometry = () => ({
      viewport: document.documentElement.clientWidth,
      cards: [...document.querySelectorAll("#app-boot .boot-card")].map((element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, width: box.width, height: box.height };
      }),
    });
    if (holdCold) {
      await page.locator("#app-boot .boot-card").first().waitFor();
      await page.waitForTimeout(100);
      cold.inline = await page.evaluate(bootGeometry);
      assert.ok(
        heldAssets.has("css") && heldAssets.has("js"),
        "Primary assets must be held for cold startup"
      );
      await heldAssets.get("css")();
      await page.waitForFunction(() =>
        [...document.querySelectorAll("link[data-app-style]")].every(
          (link) => link.dataset.ready === "true"
        )
      );
      cold.styles = await page.evaluate(bootGeometry);
      await page.screenshot({
        path: path.join(output, `desktop-readability-${stage}-${sample.name}-boot.png`),
      });
      await heldAssets.get("js")();
    }
    await page.getByLabel("Open nutrition tracker").waitFor();
    await page.waitForFunction(() =>
      document.querySelector(".dashboard-nutrition-card")?.textContent.includes("1,257")
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(output, `desktop-readability-${stage}-${sample.name}-home.png`),
    });
    const home = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      cards: [...document.querySelectorAll('.dashboard-card-grid [data-slot="card"]')].map(
        (element) => ({
          className: element.className,
          height: element.getBoundingClientRect().height,
          scrollHeight: element.scrollHeight,
          clientHeight: element.clientHeight,
        })
      ),
    }));
    assert.equal(home.overflow, false);
    if (holdCold) {
      cold.loaded = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        cards: [
          document.querySelector(".dashboard-session-card"),
          document.querySelector(".dashboard-events-card"),
          ...document.querySelectorAll(".dashboard-recovery-card"),
          document.querySelector(".dashboard-sleep-card"),
          document.querySelector(".dashboard-fitness-card"),
          document.querySelector(".dashboard-nutrition-card"),
          document.querySelector(".dashboard-history-card"),
        ].map((element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, top: box.top, width: box.width, height: box.height };
        }),
      }));
      cold.differences = cold.loaded.cards.map((box, index) => ({
        index,
        inline: Object.fromEntries(
          Object.keys(box).map((key) => [
            key,
            Number((box[key] - cold.inline.cards[index][key]).toFixed(3)),
          ])
        ),
        styles: Object.fromEntries(
          Object.keys(box).map((key) => [
            key,
            Number((box[key] - cold.styles.cards[index][key]).toFixed(3)),
          ])
        ),
      }));
      console.log(
        JSON.stringify({
          name: sample.name,
          coldMaximumDelta: Math.max(
            ...cold.differences.flatMap((box) =>
              [...Object.values(box.inline), ...Object.values(box.styles)].map(Math.abs)
            )
          ),
        })
      );
    }
    await page.goto(`${origin}/calendar`, { waitUntil: "networkidle" });
    await page.locator("[data-calendar-date]").first().waitFor();
    await page.waitForFunction(
      () =>
        document.querySelectorAll(
          '[data-calendar-date] [data-slot="card"], [data-calendar-date] button[aria-label^="Open "]'
        ).length > 0
    );
    await page.evaluate(async () => {
      await document.fonts.ready;
    });
    await page.waitForTimeout(350);
    await page.screenshot({
      path: path.join(output, `desktop-readability-${stage}-${sample.name}.png`),
    });
    const metrics = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth + 1,
      dates: document.querySelectorAll("[data-calendar-date]").length,
      cards: document.querySelectorAll('[data-calendar-date] [data-slot="card"]').length,
      smallTexts: [
        ...document.querySelectorAll(
          '[data-calendar-date] [data-slot="card"] h3,[data-calendar-date] [data-slot="card"] p'
        ),
      ]
        .slice(0, 12)
        .map((element) => ({
          text: element.textContent.trim().slice(0, 80),
          font: getComputedStyle(element).fontSize,
          color: getComputedStyle(element).color,
        })),
    }));
    assert.equal(metrics.overflow, false);
    metrics.readability = await page.evaluate(
      inspectText,
      ".calendar-workout-card,.calendar-week-summary,.calendar-desktop-toolbar,.calendar-weekday-header"
    );
    if (!before && sample.width >= 768) {
      assert.deepEqual(metrics.readability.failures, [], `${sample.name} calendar text contrast`);
      metrics.workoutValues = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            ".calendar-workout-card .calendar-workout-metrics [data-workout-metric]"
          ),
        ].map((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const fragments = [...range.getClientRects()],
            card = element.closest(".calendar-workout-card").getBoundingClientRect();
          return {
            kind: element.getAttribute("data-workout-metric"),
            text: element.textContent.trim(),
            font: getComputedStyle(element).fontSize,
            fragments: fragments.map((bounds) => ({ width: bounds.width, height: bounds.height })),
            fits:
              fragments.length > 0 &&
              fragments.every(
                (bounds) => bounds.left >= card.left - 1 && bounds.right <= card.right + 1
              ),
          };
        })
      );
      assert.ok(
        metrics.workoutValues.some((value) => value.kind === "duration"),
        `${sample.name} compact duration values must be present`
      );
      assert.deepEqual(
        metrics.workoutValues.filter((value) => !value.text || !value.fits),
        [],
        `${sample.name} compact workout values must fit inside their cards`
      );
      const currentWeek = page.locator(`[data-calendar-week="${day(0)}"]`);
      if (sample.width >= 1280) {
        const summary = currentWeek.getByRole("table", {
          name: "Planned versus completed weekly metrics",
        });
        const tss = summary
          .getByRole("row")
          .filter({ has: page.getByRole("rowheader", { name: "TSS", exact: true }) });
        metrics.weeklyTss = await tss.getByRole("cell").allTextContents();
        const current = workouts.filter((row) => row.date >= day(0) && row.date <= day(6));
        const expected = [
          current.reduce((sum, row) => sum + (row.workout_summary.planned?.tss || 0), 0),
          current
            .filter((row) => row.status === "completed")
            .reduce((sum, row) => sum + (row.workout_summary.completed.tss || 0), 0),
        ];
        assert.deepEqual(
          metrics.weeklyTss.map((text) => Number(text.replace(/[^\d]/g, ""))),
          expected
        );
        assert.ok(
          metrics.weeklyTss[1].endsWith("+"),
          "Missing completed TSS must mark a partial total"
        );
        assert.ok(
          (await currentWeek.locator(".calendar-summary-note").textContent()).includes(
            `${current.filter((row) => row.status === "completed" && row.workout_summary.completed.tss != null).length} of ${current.filter((row) => row.status === "completed").length} sessions`
          )
        );
      }
      const missing = page
        .locator(`[data-calendar-date="${day(3)}"] .calendar-workout-card`)
        .filter({ hasText: "missing training load" });
      assert.equal(await missing.count(), 1, "The missing-load fixture must render its card");
      const missingTss = await missing.locator('[data-workout-metric="tss"]').allTextContents();
      assert.ok(
        missingTss.length === 0 || missingTss.every((text) => /—|unavailable/i.test(text)),
        "Missing training load must stay unavailable rather than become a legacy zero"
      );
      const zero = page
        .locator(`[data-calendar-date="${day(4)}"] .calendar-workout-card`)
        .filter({ hasText: "explicitly zero" });
      assert.equal(await zero.count(), 1, "The zero-load fixture must render its card");
      assert.match(
        (await zero.locator('[data-workout-metric="tss"]').textContent())
          .replace(/^\s*·\s*/, "")
          .trim(),
        /^~?0(?:\s+TSS)?$/,
        "A genuine zero training load must remain visible in the compact metric row"
      );
      const trigger = page.locator('.calendar-desktop-toolbar [data-slot="popover-trigger"]');
      const anchor = page.locator(`[data-calendar-date="${day(0)}"]`);
      const anchorTop = (await anchor.boundingBox()).y;
      const position = () => ({
        scrollY,
        activeElement: {
          tag: document.activeElement.tagName,
          text: document.activeElement.textContent?.slice(0, 100),
          ariaLabel: document.activeElement.getAttribute("aria-label"),
          top: document.activeElement.getBoundingClientRect().top,
        },
        popupTop: document.querySelector('[data-slot="popover-content"]')?.getBoundingClientRect()
          .top,
        htmlOverflow: getComputedStyle(document.documentElement).overflow,
        bodyPosition: getComputedStyle(document.body).position,
        bodyOverflow: getComputedStyle(document.body).overflow,
        weeks: [...document.querySelectorAll("[data-calendar-week]")]
          .map((element) => ({
            key: element.dataset.calendarWeek,
            mounted: element.dataset.calendarMounted,
            top: element.getBoundingClientRect().top,
            height: element.getBoundingClientRect().height,
          }))
          .filter((row) => row.top > -500 && row.top < innerHeight + 500),
      });
      metrics.picker = { before: await page.evaluate(position) };
      await trigger.click();
      await page.locator('[data-slot="popover-content"]').waitFor();
      // Let the popup finish entering before Playwright's automatic scrollIntoView.
      await page
        .locator('[data-slot="popover-content"]')
        .evaluate((element) =>
          Promise.all(
            element
              .getAnimations({ subtree: true })
              .map((animation) => animation.finished.catch(() => {}))
          )
        );
      metrics.picker.opened = await page.evaluate(position);
      await page.getByRole("button", { name: "Go to the next month" }).click();
      metrics.picker.next = await page.evaluate(position);
      await page.getByRole("button", { name: "Go to the previous month" }).click();
      metrics.picker.paged = await page.evaluate(position);
      await fs.writeFile(
        path.join(output, `desktop-readability-${stage}-${sample.name}-picker-position.json`),
        JSON.stringify(metrics.picker, null, 2)
      );
      const selectedDay = page
        .locator('[data-slot="popover-content"] button[data-selected-single="true"]')
        .first();
      const selectedKey = await selectedDay.getAttribute("data-day");
      await selectedDay.evaluate((element) => element.focus({ preventScroll: true }));
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(
        (key) =>
          document.activeElement.getAttribute("data-day") !== key &&
          document.activeElement.hasAttribute("data-day"),
        selectedKey
      );
      metrics.picker.keyboardRight = await page.evaluate(position);
      await page.keyboard.press("ArrowLeft");
      await page.waitForFunction(
        (key) => document.activeElement.getAttribute("data-day") === key,
        selectedKey
      );
      metrics.picker.keyboardLeft = await page.evaluate(position);
      assert.equal(
        metrics.picker.keyboardRight.scrollY,
        metrics.picker.before.scrollY,
        "Keyboard day movement must preserve page scroll"
      );
      assert.equal(
        metrics.picker.keyboardLeft.scrollY,
        metrics.picker.before.scrollY,
        "Returning to the selected day must preserve page scroll"
      );
      await page.screenshot({
        path: path.join(output, `desktop-readability-${stage}-${sample.name}-picker.png`),
      });
      await page.keyboard.press("Escape");
      await page.locator('[data-slot="popover-content"]').waitFor({ state: "hidden" });
      await page.waitForTimeout(200);
      metrics.picker.closed = await page.evaluate(position);
      await fs.writeFile(
        path.join(output, `desktop-readability-${stage}-${sample.name}-picker-position.json`),
        JSON.stringify(metrics.picker, null, 2)
      );
      await page.screenshot({
        path: path.join(output, `desktop-readability-${stage}-${sample.name}-picker-closed.png`),
      });
      assert.equal(
        await trigger.evaluate((element) => element === document.activeElement),
        true,
        "Picker must restore focus"
      );
      assert.ok(
        Math.abs((await anchor.boundingBox()).y - anchorTop) < 1,
        `Closing the date picker must preserve the calendar position: ${anchorTop}→${(await anchor.boundingBox()).y}`
      );
      const first = page
        .locator(`[data-calendar-date="${day(0)}"] [data-slot="card"][role="button"]`)
        .first();
      await first.focus();
      await page.keyboard.press("Enter");
      await page.getByLabel("Recorded workout analysis", { exact: true }).waitFor();
      assert.equal(await page.locator(".analysis-overview h2").textContent(), specifications[0][2]);
      await page.screenshot({
        path: path.join(output, `desktop-readability-${stage}-${sample.name}-workout.png`),
      });
      await page.getByRole("button", { name: "Back to calendar", exact: true }).click();
      await page.locator("[data-calendar-date]").first().waitFor();
      await page.waitForFunction(
        ({ date, top }) =>
          Math.abs(
            document.querySelector(`[data-calendar-date="${date}"]`)?.getBoundingClientRect().top -
              top
          ) < 1,
        { date: day(0), top: anchorTop }
      );
      assert.equal(new URL(page.url()).searchParams.has("workout"), false);
      assert.equal((await page.locator('[data-slot="card"][role="button"]').count()) > 0, true);
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(blocked, []);
    assert.deepEqual(writes, []);
    results.push({ ...sample, home, metrics, cold, calls, blocked, writes, errors });
    await context.close();
  }
  await fs.writeFile(
    path.join(output, `desktop-readability-${stage}-results.json`),
    JSON.stringify(results, null, 2)
  );
  assert.deepEqual(
    results.flatMap(({ name, cold }) =>
      (cold.differences || [])
        .filter((value) =>
          [...Object.values(value.inline), ...Object.values(value.styles)].some(
            (delta) => Math.abs(delta) > 1
          )
        )
        .map((value) => ({ name, ...value }))
    ),
    [],
    "Cold boot placeholders must retain their geometry as CSS and data arrive"
  );
  console.log(
    JSON.stringify(
      results.map(({ name, metrics, errors, blocked, writes }) => ({
        name,
        overflow: metrics.overflow,
        calendarContrast: metrics.readability.minimum,
        weeklyTss: metrics.weeklyTss,
        errors,
        blocked,
        writes,
      })),
      null,
      2
    )
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
