import test from "node:test"
import assert from "node:assert/strict"
import {
  dashboardChartDatePresets,
  resolveDashboardChartRange,
  validDashboardChartSettings,
  dashboardRangeError,
} from "../src/lib/dashboard-chart-settings.ts"
const dashboard = { start: "2026-09-23", end: "2026-10-20" }
const resolve = (preset) =>
  resolveDashboardChartRange({ preset, ...dashboard }, "2026-10-20", dashboard)
test("all observed date presets reproduce the live inclusive calendar periods without persisting reference settings", () => {
  const expected = {
    dashboard: ["2026-09-23", "2026-10-20"],
    custom: ["2026-09-23", "2026-10-20"],
    "through-today": ["2026-09-23", "2026-10-20"],
    7: ["2026-10-14", "2026-10-20"],
    14: ["2026-10-07", "2026-10-20"],
    28: ["2026-09-23", "2026-10-20"],
    90: ["2026-07-23", "2026-10-20"],
    180: ["2026-04-24", "2026-10-20"],
    365: ["2025-10-21", "2026-10-20"],
    730: ["2024-10-21", "2026-10-20"],
    week: ["2026-10-19", "2026-10-25"],
    month: ["2026-10-01", "2026-10-31"],
    year: ["2026-01-01", "2026-12-31"],
    "last-week": ["2026-10-12", "2026-10-18"],
    "last-month": ["2026-09-01", "2026-09-30"],
    "last-3-months": ["2026-07-01", "2026-09-30"],
    "last-year": ["2025-01-01", "2025-12-31"],
    "last-2-years": ["2024-01-01", "2025-12-31"],
    "week-last-year": ["2025-10-20", "2025-10-26"],
    "month-last-year": ["2025-10-01", "2025-10-31"],
    "next-week": ["2026-10-26", "2026-11-01"],
    "28+7": ["2026-09-23", "2026-10-27"],
    "90+21": ["2026-07-23", "2026-11-10"],
    "180+45": ["2026-04-24", "2026-12-04"],
    "through-next-week": ["2026-09-23", "2026-10-27"],
  }
  assert.equal(Object.keys(expected).length, dashboardChartDatePresets.length)
  for (const [id, [start, end]] of Object.entries(expected))
    assert.deepEqual(resolve(id), { start, end }, id)
  assert.deepEqual(dashboard, { start: "2026-09-23", end: "2026-10-20" })
})
test("calendar bounds cross leap years, month ends and ISO week/year edges without timezone shifts", () => {
  const at = (today, preset) =>
    resolveDashboardChartRange({ preset, ...dashboard }, today, dashboard)
  assert.deepEqual(at("2024-03-01", "last-month"), {
    start: "2024-02-01",
    end: "2024-02-29",
  })
  assert.deepEqual(at("2027-01-01", "week"), {
    start: "2026-12-28",
    end: "2027-01-03",
  })
  assert.deepEqual(at("2024-12-31", "next-week"), {
    start: "2025-01-06",
    end: "2025-01-12",
  })
  assert.deepEqual(at("2026-01-01", "last-3-months"), {
    start: "2025-10-01",
    end: "2025-12-31",
  })
})
test("malformed, reversed and unbounded custom dates never become an effective query", () => {
  for (const range of [
    { start: "2026-02-30", end: "2026-03-01" },
    { start: "2026-10-21", end: "2026-10-20" },
    { start: "1900-01-01", end: "2026-10-20" },
  ]) {
    assert.ok(dashboardRangeError(range))
    assert.throws(() =>
      resolveDashboardChartRange(
        { preset: "custom", ...range },
        "2026-10-20",
        dashboard
      )
    )
  }
  assert.throws(() => resolve("unknown"))
  assert.throws(() => resolve("999"))
  assert.throws(() =>
    resolveDashboardChartRange(
      { preset: "dashboard", ...dashboard },
      "invalid",
      dashboard
    )
  )
})
test("saved chart settings preserve independent types, empty selection, zero-length title and explicit average state", () => {
  const settings = {
    title: "",
    sports: [],
    preset: "dashboard",
    period: "day",
    showAverage: false,
    ...dashboard,
  }
  assert.equal(validDashboardChartSettings(settings), true)
  for (const patch of [
    { sports: ["Run", "Run"] },
    { sports: ["VirtualRide"] },
    { period: "month" },
    { showAverage: null },
    { title: "a".repeat(501) },
    { preset: "unknown" },
  ])
    assert.equal(validDashboardChartSettings({ ...settings, ...patch }), false)
})
