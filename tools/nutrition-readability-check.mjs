// Use the isolated nutrition-readability Vite config; every API is synthetic.
// Optional --before restores the captured stylesheet and former display classes.
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
const origin = process.env.APP_TEST_ORIGIN || "http://127.0.0.1:5193";
const before = process.argv.includes("--before");
const output = path.resolve("artifacts/reliability");
await fs.mkdir(output, { recursive: true });
const baseline = before
  ? await fs.readFile(path.join(output, "nutrition-before.css"), "utf8")
  : null;
const browser = await playwright.chromium.launch({
  headless: true,
  channel: process.env.APP_TEST_BROWSER || "msedge",
});
const results = [];

const inspect = () => {
  const surface =
    document.querySelector(".nutrition-screen") || document.querySelector(".nutrition-dashboard");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (color) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const pixel = ctx.getImageData(0, 0, 1, 1).data;
    return [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
  };
  const mix = (fore, back) => [
    ...fore.slice(0, 3).map((value, index) => value * fore[3] + back[index] * (1 - fore[3])),
    1,
  ];
  const background = (element) => {
    const chain = [];
    for (let node = element; node; node = node.parentElement) chain.push(node);
    return chain
      .reverse()
      .reduce(
        (back, node) => mix(rgba(getComputedStyle(node).backgroundColor), back),
        [255, 255, 255, 1]
      );
  };
  const luminance = (color) =>
    color
      .slice(0, 3)
      .map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      })
      .reduce((total, value, index) => total + value * [0.2126, 0.7152, 0.0722][index], 0);
  const ratio = (fore, back) => {
    const values = [luminance(fore), luminance(back)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  const walker = document.createTreeWalker(surface, NodeFilter.SHOW_TEXT);
  const texts = [];
  while (walker.nextNode()) {
    const text = walker.currentNode.textContent.trim();
    const element = walker.currentNode.parentElement;
    if (
      !text ||
      !element?.getClientRects().length ||
      element.closest(
        '[aria-hidden="true"],[aria-disabled="true"],:disabled,.calendar-day-disabled'
      )
    )
      continue;
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    let clipped = false;
    for (let node = element.parentElement; node; node = node.parentElement) {
      const parentStyle = getComputedStyle(node),
        box = node.getBoundingClientRect();
      if (
        ["hidden", "clip"].includes(parentStyle.overflowX) &&
        (bounds.right <= box.left || bounds.left >= box.right)
      )
        clipped = true;
    }
    if (clipped) continue;
    let opacity = 1;
    for (let node = element; node; node = node.parentElement)
      opacity *= Number(getComputedStyle(node).opacity);
    if (opacity < 0.05 || style.visibility !== "visible") continue;
    const back = background(element),
      color = rgba(style.color);
    color[3] *= opacity;
    const size = parseFloat(style.fontSize),
      weight = Number(style.fontWeight);
    texts.push({
      text: text.slice(0, 90),
      size,
      weight,
      color: style.color,
      background: back.slice(0, 3).map(Math.round),
      contrast: Number(ratio(mix(color, back), back).toFixed(2)),
      minimum: size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5,
    });
  }
  const cards = [...surface.querySelectorAll('[data-slot="card"]')].map((element) => {
    const style = getComputedStyle(element);
    return {
      background: style.backgroundColor,
      image: style.backgroundImage,
      alpha: rgba(style.backgroundColor)[3],
      backdrop: style.backdropFilter,
      opacity: style.opacity,
    };
  });
  const macros = [...surface.querySelectorAll(".nutrition-food-macros")].map((element) => {
    const bounds = element.getBoundingClientRect();
    return {
      wrap: getComputedStyle(element).flexWrap,
      height: bounds.height,
      clipped: [...element.children].filter((child) => {
        const box = child.getBoundingClientRect();
        return (
          box.left < bounds.left - 1 ||
          box.right > bounds.right + 1 ||
          box.bottom > bounds.bottom + 1
        );
      }).length,
    };
  });
  const inputs = [...surface.querySelectorAll("input,textarea,select")].map((element) => {
    const style = getComputedStyle(element),
      back = background(element);
    const placeholder = getComputedStyle(element, "::placeholder");
    const color = rgba(style.color),
      placeholderColor = rgba(placeholder.color);
    placeholderColor[3] *= Number(placeholder.opacity);
    return {
      label: element.getAttribute("aria-label") || element.placeholder || element.type,
      background: back.slice(0, 3).map(Math.round),
      color: style.color,
      contrast: Number(ratio(mix(color, back), back).toFixed(2)),
      placeholderContrast: element.placeholder
        ? Number(ratio(mix(placeholderColor, back), back).toFixed(2))
        : null,
    };
  });
  const actions = [...surface.querySelectorAll(".mobile-navbar-action:not(:disabled)")]
    .filter((element) => element.getClientRects().length)
    .map((element) => {
      const ink = getComputedStyle(element.querySelector("svg") || element).color,
        back = background(element);
      return {
        label: element.getAttribute("aria-label"),
        color: ink,
        background: getComputedStyle(element).backgroundColor,
        contrast: Number(ratio(mix(rgba(ink), back), back).toFixed(2)),
      };
    });
  return {
    theme: document.documentElement.className,
    surface: getComputedStyle(surface).backgroundColor,
    mainBackground: getComputedStyle(document.querySelector(".nutrition-page-main"))
      .backgroundColor,
    surfaceOpacity: getComputedStyle(surface).opacity,
    texts,
    cards,
    macros,
    inputs,
    actions,
    failures: texts.filter(({ contrast, minimum }) => contrast < minimum),
    overflow: document.documentElement.scrollWidth > innerWidth + 1,
    fixture: structuredClone(window.__nutritionFixture),
  };
};

try {
  for (const width of [390, 320])
    for (const theme of ["light", "dark"]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        colorScheme: theme,
      });
      const errors = [],
        blocked = [];
      await context.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin && !url.pathname.startsWith("/api/")) return route.continue();
        blocked.push(url.origin === origin ? url.pathname : url.origin);
        return route.abort();
      });
      const page = await context.newPage();
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${origin}/tests/nutrition-readability.html?theme=${theme}`, {
        waitUntil: "networkidle",
      });
      await page.getByRole("heading", { name: "Your meals", exact: true }).waitFor();
      await page.evaluate(async () => {
        await document.fonts.ready;
      });
      if (before)
        await page.evaluate((css) => {
          for (const style of document.querySelectorAll("style[data-vite-dev-id]"))
            if (style.dataset.viteDevId.endsWith("/components/nutrition.css"))
              style.textContent = "";
          const style = document.createElement("style");
          style.textContent = css;
          document.head.append(style);
          const colors = ["#3896f6", "#9368f7", "#ff9d32", "#35c3d3"];
          for (const surface of document.querySelectorAll(".nutrition-surface"))
            ["calories", "protein", "fat", "carbs"].forEach((key, index) =>
              surface.style.setProperty(`--nutrition-${key}`, colors[index])
            );
          [...document.querySelectorAll(".nutrition-progress-row")].forEach((row, index) => {
            row.querySelector(".nutrition-progress-track").style.background = colors[index] + "18";
            row.querySelector(".nutrition-progress-fill").style.background = colors[index];
          });
          for (const detail of document.querySelectorAll(".nutrition-progress-detail"))
            detail.classList.remove("nutrition-progress-detail");
          for (const value of document.querySelectorAll(".nutrition-progress-line > span"))
            value.classList.remove("font-semibold");
          for (const total of document.querySelectorAll(".nutrition-week-total"))
            total.className = "text-[9px] text-muted-foreground tabular-nums";
          for (const button of document.querySelectorAll(
            '[aria-label="Calories logged over the last seven days"] button'
          )) {
            button.lastElementChild.className = "text-[10px] text-muted-foreground";
            const target = button.querySelector(".nutrition-week-target");
            if (target) target.style.background = "rgb(228 228 231 / 75%)";
            const bar = button.querySelector(".nutrition-week-bar");
            if (bar)
              bar.style.background = bar.classList.contains("is-selected") ? "#10b981" : "#a7f3d0";
          }
          for (const graph of document.querySelectorAll(
            '[aria-label="Calories logged over the last seven days"] svg path'
          )) {
            graph.setAttribute("stroke", "#66756e");
            graph.setAttribute("stroke-opacity", ".5");
            graph.setAttribute("stroke-width", "1.5");
          }
          for (const line of document.querySelectorAll(".nutrition-food-macros")) {
            line.className =
              "nutrition-food-macros mt-1 flex min-w-0 max-w-full flex-nowrap items-center gap-x-2 overflow-hidden whitespace-nowrap text-[13px] tabular-nums text-muted-foreground";
            [...line.children].forEach(
              (child, index) =>
                (child.firstElementChild.style.background = [
                  "#3896f6",
                  "#f43f5e",
                  "#f59e0b",
                  "#3b82f6",
                ][index])
            );
          }
        }, baseline);
      const suffix = `${before ? "before" : "after"}-${theme}-${width}`;
      const dashboard = await page.evaluate(inspect);
      await page.screenshot({
        path: path.join(output, `nutrition-${suffix}-dashboard.png`),
        fullPage: true,
      });
      const action = page.getByRole("button", { name: "Edit nutrition targets", exact: true });
      await action.hover();
      const hovered = await page.evaluate(inspect);
      await page.mouse.down();
      const pressed = await page.evaluate(inspect);
      await page.mouse.move(2, 500);
      await page.mouse.up();
      await page.getByRole("button", { name: "Choose nutrition date", exact: true }).click();
      await page.locator(".calendar-jump-inline .calendar-day").first().waitFor();
      await page.waitForTimeout(250);
      const calendar = await page.evaluate(inspect);
      await page.screenshot({ path: path.join(output, `nutrition-${suffix}-calendar.png`) });
      await page.getByRole("button", { name: "Close nutrition calendar", exact: true }).click();
      await page.locator(".calendar-jump-inline").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Edit nutrition targets", exact: true }).click();
      await page.getByLabel("Calories target", { exact: true }).waitFor();
      const targets = await page.evaluate(inspect);
      await page.screenshot({ path: path.join(output, `nutrition-${suffix}-targets.png`) });
      await page.keyboard.press("Escape");
      await page.getByLabel("Add breakfast", { exact: true }).click();
      const search = page.locator('.nutrition-screen input[type="search"]');
      await search.waitFor();
      const composer = await page.evaluate(inspect);
      await page.screenshot({ path: path.join(output, `nutrition-${suffix}-composer.png`) });
      await page.keyboard.press("Escape");
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, [], "No real API or off-origin transport may be attempted");
      assert.equal((await page.evaluate(inspect)).fixture.writes.length, 0);
      for (const screen of [dashboard, calendar, targets, composer]) {
        assert.equal(screen.overflow, false, `${suffix}: horizontal overflow`);
        if (!before) {
          assert.equal(
            screen.failures.length,
            0,
            `${suffix}: text contrast below required ratio: ${JSON.stringify(screen.failures.slice(0, 5))}`
          );
          assert.ok(
            screen.inputs.every(
              (input) =>
                input.contrast >= 4.5 &&
                (input.placeholderContrast == null || input.placeholderContrast >= 4.5)
            ),
            `${suffix}: field/placeholder contrast: ${JSON.stringify(screen.inputs)}`
          );
        }
      }
      if (!before) {
        assert.equal(
          dashboard.mainBackground,
          dashboard.surface,
          `${suffix}: parent and dashboard must share the backing palette`
        );
        assert.ok(
          [...hovered.actions, ...pressed.actions].every((action) => action.contrast >= 3),
          `${suffix}: icon hover/press contrast: ${JSON.stringify({ hovered: hovered.actions, pressed: pressed.actions })}`
        );
        assert.ok(
          dashboard.cards.every(
            (card) =>
              card.alpha === 1 &&
              card.image === "none" &&
              card.backdrop === "none" &&
              card.opacity === "1"
          ),
          `${suffix}: cards must have an opaque backing`
        );
        assert.ok(
          dashboard.macros.length &&
            dashboard.macros.every((row) => row.clipped === 0 && row.wrap === "wrap"),
          `${suffix}: every food macro must remain visible`
        );
      }
      results.push({
        width,
        theme,
        dashboard,
        calendar,
        hoveredActions: hovered.actions,
        pressedActions: pressed.actions,
        targets,
        composer,
        errors,
        blocked,
      });
      await context.close();
    }
  await fs.writeFile(
    path.join(output, `nutrition-${before ? "before" : "after"}-readability-results.json`),
    JSON.stringify(results, null, 2)
  );
  console.log(
    JSON.stringify(
      results.map(({ width, theme, dashboard, targets, composer }) => ({
        width,
        theme,
        dashboardMinimum: Math.min(...dashboard.texts.map((text) => text.contrast)),
        dashboardFailures: dashboard.failures.length,
        targetsFailures: targets.failures.length,
        composerFailures: composer.failures.length,
        clippedMacros: dashboard.macros.reduce((total, row) => total + row.clipped, 0),
        cards: dashboard.cards[0],
      })),
      null,
      2
    )
  );
} finally {
  await browser.close();
}
