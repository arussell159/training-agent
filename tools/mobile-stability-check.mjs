// Production UI against disposable preview APIs; never touches user/provider data.
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const playwright = require(
  path.join(
    os.homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright"
  )
);
const origin = process.env.MOBILE_TEST_ORIGIN || "http://127.0.0.1:5196";
const phase = process.env.MOBILE_TEST_PHASE || "baseline";
const output = path.resolve(
  "artifacts/mobile-stability",
  phase + (process.env.MOBILE_BROWSER_ENGINE ? "-" + process.env.MOBILE_BROWSER_ENGINE : "")
);
await fs.mkdir(output, { recursive: true });
const browser = await playwright[process.env.MOBILE_BROWSER_ENGINE || "chromium"].launch({
  headless: true,
  ...(process.env.MOBILE_BROWSER_ENGINE ? {} : { channel: "msedge" }),
  ...(process.env.MOBILE_BROWSER_EXECUTABLE
    ? { executablePath: process.env.MOBILE_BROWSER_EXECUTABLE }
    : {}),
});
const results = [];
try {
  for (const width of [320, 360, 390, 430, 844, 768, 1440]) {
    const context = await browser.newContext({
      viewport: { width, height: width === 844 ? 390 : 844 },
      hasTouch: width !== 1440,
      isMobile: width < 768 || width === 844,
      reducedMotion: "reduce",
    });
    await context.route("**/*", (route) =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort()
    );
    await context.addInitScript(() => {
      window.__mobileVitals = { lcp: 0, cls: 0 };
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) window.__mobileVitals.lcp = e.startTime;
      }).observe({ type: "largest-contentful-paint", buffered: true });
      new PerformanceObserver((list) => {
        for (const e of list.getEntries())
          if (!e.hadRecentInput) window.__mobileVitals.cls += e.value;
      }).observe({ type: "layout-shift", buffered: true });
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    for (const route of (
      process.env.MOBILE_TEST_ROUTES || "/,/calendar,/nutrition,/settings"
    ).split(",")) {
      await page.goto(origin + route + "?benchmark=1", { waitUntil: "networkidle" });
      const data = await page.evaluate(() => {
        const rect = (s) => {
          const e = document.querySelector(s);
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        };
        const overflow = [...document.querySelectorAll("body *")]
          .filter((e) => {
            const r = e.getBoundingClientRect(),
              c = getComputedStyle(e);
            return (
              r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && c.position !== "fixed"
            );
          })
          .slice(0, 20)
          .map((e) => ({
            tag: e.tagName,
            cls: String(e.className).slice(0, 160),
            width: e.getBoundingClientRect().width,
            x: e.getBoundingClientRect().x,
          }));
        const dashboard = document.querySelector(".mobile-dashboard"),
          hero = document.querySelector(".home-athlete-hero");
        return {
          viewport: innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          bodyWidth: document.body.scrollWidth,
          hero: rect(".home-athlete-hero"),
          greeting: rect(".home-greeting"),
          dashboard: dashboard
            ? { class: dashboard.className, padding: getComputedStyle(dashboard).padding }
            : null,
          heroStyle: hero
            ? { padding: getComputedStyle(hero).padding, margin: getComputedStyle(hero).margin }
            : null,
          main: rect("main"),
          navbar: rect(".mobile-site-navbar"),
          visibleDayPlus: [...document.querySelectorAll(".calendar-day-add-workout")].filter(
            (e) => e.getClientRects().length
          ).length,
          overflow,
          vitals: window.__mobileVitals,
          resources: performance
            .getEntriesByType("resource")
            .filter((r) => r.name.includes("/assets/"))
            .map((r) => ({
              name: r.name.split("/").pop(),
              bytes: r.transferSize,
              duration: r.duration,
            })),
        };
      });
      const row = { width, route, ...data, errors: [...errors] };
      results.push(row);
      if (phase === "after") {
        assert.ok(
          data.documentWidth <= data.viewport,
          `Document overflow at ${width}px on ${route}`
        );
        assert.deepEqual(errors, []);
        if (route === "/" && width < 768) {
          assert.equal(data.hero.x, 0);
          assert.equal(data.hero.width, width);
          assert.ok(
            data.greeting.y >= 56 && data.greeting.y <= 90,
            `Greeting begins ${data.greeting.y}px down`
          );
          assert.equal(await page.locator(".home-dashboard-shell.home-redesign-shell").count(), 1);
          const carousel = page.locator(".home-session-carousel");
          const position = await carousel.evaluate((e) => {
            e.scrollTo({ left: e.clientWidth, behavior: "instant" });
            return { left: e.scrollLeft, width: e.clientWidth, content: e.scrollWidth };
          });
          assert.ok(
            position.content > position.width && position.left > 0,
            `Deliberate carousel scrolling retained: ${JSON.stringify(position)}`
          );
          await page.evaluate(() =>
            window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })
          );
          await page.waitForLoadState("networkidle");
          const expanded = await page.evaluate(() => ({
            width: document.documentElement.scrollWidth,
            viewport: innerWidth,
          }));
          assert.ok(
            expanded.width <= expanded.viewport,
            "Deferred Home charts must fit after scrolling"
          );
          row.afterScroll = expanded;
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
        }
        if (route === "/calendar") {
          if (width !== 1440)
            assert.equal(data.visibleDayPlus, 0, "Desktop plus hidden on mobile/coarse pointers");
          else assert.ok(data.visibleDayPlus > 0, "Desktop plus controls retained");
        }
      }
      if ([320, 390, 844, 1440].includes(width) && route != "/settings")
        await page.screenshot({
          path: path.join(output, `${route.slice(1) || "home"}-${width}.png`),
          fullPage: true,
        });
      console.log(
        JSON.stringify({
          width,
          route,
          documentWidth: data.documentWidth,
          hero: data.hero,
          dayPlus: data.visibleDayPlus,
          vitals: data.vitals,
          errors: errors.length,
        })
      );
    }
    await context.close();
  }
} finally {
  await fs.writeFile(path.join(output, "geometry.json"), JSON.stringify(results, null, 2));
  await browser.close();
}
