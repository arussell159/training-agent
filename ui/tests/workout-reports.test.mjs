import test from "node:test"
import assert from "node:assert/strict"
import { historyMonths } from "../src/lib/training-history-range-policy.ts"
import {
  automaticColumns,
  availability,
  changeDistanceUnit,
  completedActivities,
  dateBounds,
  emptyFilters,
  filterActivities,
  filterErrors,
  knownColumnIds,
  localDay,
  metric,
  resolveColumns,
  sortActivities,
  totals,
} from "../src/lib/workout-reports-model.ts"

const workout = (id, overrides = {}) => ({
  id: `activity:${id}`,
  activity_id: id,
  workout_date: "2026-09-29",
  recorded_start_local: "2026-09-29T08:00:00",
  sport: "Run",
  title: `Run ${id}`,
  status: "completed",
  workout_summary: {
    completed: {
      duration_seconds: 3600,
      distance_meters: 1609.344,
      average_speed: 2,
      elevation_gain: 0,
    },
    planned: null,
  },
  ...overrides,
})
test("adjacent calendar history requests share bounded month pages across leap years", () => {
  assert.deepEqual(historyMonths("2024-02-27", "2024-03-03"), [
    { start: "2024-02-01", end: "2024-02-29" },
    { start: "2024-03-01", end: "2024-03-31" },
  ])
  assert.deepEqual(historyMonths("1999-12-31", "2000-01-02"), [
    { start: "1999-12-01", end: "1999-12-31" },
    { start: "2000-01-01", end: "2000-01-31" },
  ])
  assert.throws(() => historyMonths("2023-02-29", "2023-03-01"))
  assert.throws(() => historyMonths("2024-03-02", "2024-03-01"))
})
const filter = (rows, changes) =>
  filterActivities(
    rows,
    { ...emptyFilters, ...changes },
    new Date("2026-09-30T02:00:00Z"),
    "America/Chicago"
  )

test("completed activities exclude placeholders and deduplicate linked recordings", () => {
  const one = workout("1"),
    linked = { ...workout("other"), id: "event:7", activity_id: "1" }
  assert.deepEqual(
    completedActivities([
      linked,
      one,
      { ...workout("3"), status: "upcoming", activity_id: null },
    ]).map((w) => w.id),
    ["activity:1"]
  )
})

test("combined filters use inclusive athlete-local days and normalized moving metrics", () => {
  const rows = [
    workout("1"),
    workout("2", { workout_date: "2026-09-30", sport: "Bike" }),
    workout("3", { workout_date: "2026-09-28" }),
  ]
  assert.deepEqual(
    filter(rows, {
      sport: "Run",
      range: "custom",
      start: "2026-09-29",
      end: "2026-09-29",
      minDistance: "1",
      distanceUnit: "mi",
      minDuration: "1:00:00",
      maxDuration: "1:00:00",
    }).map((w) => w.id),
    ["activity:1"]
  )
  assert.equal(
    localDay(new Date("2026-09-30T02:00:00Z"), "America/Chicago"),
    "2026-09-29"
  )
  assert.deepEqual(
    dateBounds(
      { ...emptyFilters, range: "7" },
      new Date("2026-09-30T02:00:00Z"),
      "America/Chicago"
    ),
    { start: "2026-09-23", end: "2026-09-29" }
  )
})

test("yards and meters match the same physical swim distance", () => {
  const swim = workout("swim", {
    sport: "Swim",
    workout_summary: {
      completed: { distance_meters: 914.4, duration_seconds: 1800 },
      planned: null,
    },
  })
  assert.equal(
    filter([swim], {
      minDistance: "1000",
      maxDistance: "1000",
      distanceUnit: "yd",
    }).length,
    1
  )
  assert.equal(
    filter([swim], {
      minDistance: "914.4",
      maxDistance: "914.4",
      distanceUnit: "m",
    }).length,
    1
  )
  const converted = changeDistanceUnit(
    {
      ...emptyFilters,
      minDistance: "1000",
      maxDistance: "1000",
      distanceUnit: "yd",
    },
    "m"
  )
  assert.equal(filter([swim], converted).length, 1)
})

test("moving time governs duration filters and totals, not elapsed time", () => {
  const row = workout("1", {
    workout_summary: {
      completed: { duration_seconds: 1800, elapsed_time_seconds: 3600 },
      planned: null,
    },
  })
  assert.equal(filter([row], { minDuration: "45:00" }).length, 0)
  assert.equal(totals([row]).duration, 1800)
})

test("90 percent coverage uses the whole filtered set, including zero, without rounding", () => {
  const ten = Array.from({ length: 10 }, (_, i) =>
    workout(String(i), {
      workout_summary: {
        completed: { duration_seconds: 3600, elevation_gain: i < 9 ? 0 : null },
        planned: null,
      },
    })
  )
  assert.equal(availability(ten).elevation_gain, 9)
  assert.ok(automaticColumns(ten).includes("elevation_gain"))
  assert.equal(
    automaticColumns(
      ten.slice(0, 9).map((w, i) =>
        i === 8
          ? {
              ...w,
              workout_summary: {
                completed: { elevation_gain: null },
                planned: null,
              },
            }
          : w
      )
    ).includes("elevation_gain"),
    false
  )
  assert.deepEqual(automaticColumns([]), [])
  assert.equal(
    availability([
      workout("bad", {
        workout_summary: {
          completed: { elevation_gain: Infinity },
          planned: null,
        },
      }),
    ]).elevation_gain,
    0
  )
})

test("coverage and sorting include every filtered row", () => {
  const rows = Array.from({ length: 51 }, (_, i) =>
    workout(String(i), {
      workout_summary: {
        completed: {
          duration_seconds: i + 1,
          elevation_gain: i < 46 ? 0 : null,
        },
        planned: null,
      },
    })
  )
  assert.equal(availability(rows).elevation_gain, 46)
  assert.ok(automaticColumns(rows).includes("elevation_gain"))
  assert.equal(
    sortActivities(rows, "duration_seconds", "desc")[0].activity_id,
    "50"
  )
})

test("missing metric only excludes when filtered; validation finds invalid bounds", () => {
  const row = workout("1", {
    workout_summary: { completed: { duration_seconds: 600 }, planned: null },
  })
  assert.equal(filter([row], {}).length, 1)
  assert.equal(filter([row], { minDistance: "0" }).length, 0)
  assert.ok(
    filterErrors(
      {
        ...emptyFilters,
        minDistance: "-1",
        minDuration: "1:88",
        range: "custom",
        start: "2026-02-30",
        end: "2026-02-01",
      },
      new Date(),
      "America/Chicago"
    ).minDistance
  )
})

test("numeric, pace and date sorting cover all rows and keep missing last", () => {
  const rows = [
    workout("slow", {
      workout_date: "2026-09-28",
      workout_summary: {
        completed: { average_speed: 2, elevation_gain: 8 },
        planned: null,
      },
    }),
    workout("missing", {
      workout_summary: { completed: { average_speed: null }, planned: null },
    }),
    workout("fast", {
      workout_date: "2026-09-30",
      workout_summary: {
        completed: { average_speed: 4, elevation_gain: 10 },
        planned: null,
      },
    }),
  ]
  assert.deepEqual(
    sortActivities(rows, "pace", "asc").map((w) => w.activity_id),
    ["fast", "slow", "missing"]
  )
  assert.deepEqual(
    sortActivities(rows, "elevation_gain", "desc").map((w) => w.activity_id),
    ["fast", "slow", "missing"]
  )
  assert.deepEqual(
    sortActivities(rows, "date", "asc").map((w) => w.activity_id),
    ["slow", "missing", "fast"]
  )
  assert.equal(metric(rows[0], "pace"), 0.5)
})

test("saved identifiers preserve order and ignore removed fields", () => {
  assert.deepEqual(
    knownColumnIds(["tss", "obsolete", "distance_meters", "tss"]),
    ["tss", "distance_meters"]
  )
  const defaults = {
    all: ["distance_meters"],
    Run: ["pace"],
    Swim: ["duration_seconds"],
    Bike: ["average_power"],
    Hike: ["elevation_gain"],
  }
  assert.deepEqual(resolveColumns({}, defaults, "Swim", []).ids, [
    "duration_seconds",
  ])
  assert.deepEqual(resolveColumns({}, defaults, "all", []).ids, [
    "distance_meters",
  ])
  assert.deepEqual(
    resolveColumns({ Run: ["tss", "pace"] }, defaults, "Run", []).ids,
    ["tss", "pace"]
  )
  assert.deepEqual(resolveColumns({}, defaults, "Bike", []).ids, [
    "average_power",
  ])
  assert.deepEqual(resolveColumns({}, defaults, "Hike", []).ids, [
    "elevation_gain",
  ])
  assert.deepEqual(resolveColumns({}, defaults, "Run", [workout("1")]).ids, [
    "pace",
  ])
})
