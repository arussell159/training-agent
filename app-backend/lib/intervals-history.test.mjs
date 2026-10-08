import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchHistoricalCalendar,
  fetchWorkoutHistoryPage,
  historicalRange,
  fetchHistoricalWorkout,
} from "./intervals-history.mjs";

const activity = (id, date) => ({
  id,
  start_date_local: `${date}T08:00:00`,
  name: id,
  type: "Run",
  moving_time: 1800,
  elapsed_time: 1850,
  distance: 5000,
});

test("old workout deep links read one activity without loading a snapshot or accepting arbitrary paths", async () => {
  const paths = [];
  const request = async (path) => {
    paths.push(path);
    return activity("i123", "2001-01-03");
  };
  const workout = await fetchHistoricalWorkout(request, "activity:i123");
  assert.deepEqual(paths, ["/activity/i123"]);
  assert.equal(workout.workout_date, "2001-01-03");
  assert.equal(workout.raw, undefined);
  for (const invalid of [
    "activity:../settings",
    "https://elsewhere.test",
    "event:0",
    "event:1/../../athlete",
  ]) {
    await assert.rejects(fetchHistoricalWorkout(request, invalid), { status: 400 });
  }
  assert.equal(paths.length, 1);
});

test("historical event deep links include a paired recording and inaccessible stubs return404", async () => {
  const workout = await fetchHistoricalWorkout(
    async (path) =>
      path.includes("/events/")
        ? { ...activity(10, "2001-01-03"), category: "WORKOUT", paired_activity_id: "i123" }
        : [activity("i123", "2001-01-03")],
    "event:10"
  );
  assert.equal(workout.id, "event:10");
  assert.equal(workout.activity_id, "i123");
  await assert.rejects(
    fetchHistoricalWorkout(async () => ({ id: "i123" }), "activity:i123"),
    { status: 404 }
  );
});

test("historical calendar supports arbitrary old dates with only three read-only provider calls", async () => {
  const calls = [],
    context = {
      athlete: { time_zone: "America/Chicago", name: "Test" },
      metrics: { fitness: 80 },
      version: "current-version",
      queue_snapshot_revision: "current-revision",
    };
  const result = await fetchHistoricalCalendar(
    async (path, options) => {
      calls.push(path);
      assert.equal(options, undefined);
      if (path.includes("/activities?")) return [activity("old", "2012-02-29")];
      if (path.includes("/wellness?")) return [{ id: "2012-02-29", hrv: 60 }];
      return [];
    },
    { start: "2012-02-01", end: "2012-02-29" },
    { context }
  );
  assert.equal(calls.length, 3);
  assert.equal(result.history[0].id, "activity:old");
  assert.equal(result.context_scope, "range");
  assert.deepEqual(result.display_range, { start: "2012-02-01", end: "2012-02-29" });
  assert.equal(result.history[0].raw, undefined);
  assert.equal(result.history[0].raw_activity, undefined);
  assert.equal(result.version, undefined);
  assert.equal(result.queue_snapshot_revision, undefined);
  assert.equal(result.metrics.fitness, 80);
});

test("range validation bounds cost and rejects impossible calendar dates", () => {
  assert.throws(() => historicalRange("2012-02-30", "2012-03-01"));
  assert.throws(() => historicalRange("2012-01-01", "2012-12-31"));
  assert.throws(() => historicalRange("2012-03-01", "2012-02-29"));
  assert.deepEqual(historicalRange("2012-02-01", "2012-03-03"), {
    start: "2012-02-01",
    end: "2012-03-03",
  });
});

test("historical calendars skip inaccessible provider stubs and pair linked recordings once", async () => {
  const result = await fetchHistoricalCalendar(
    async (path) =>
      path.includes("/activities?")
        ? [{ id: "strava-stub" }, { ...activity("done", "2012-02-29"), paired_event_id: 10 }]
        : path.includes("/events?")
          ? [
              {
                id: 10,
                ...activity(10, "2012-02-29"),
                category: "WORKOUT",
                paired_activity_id: "done",
              },
            ]
          : [],
    { start: "2012-02-29", end: "2012-02-29" }
  );
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0].activity_id, "done");
});

test("report pagination completes the boundary day without dropping equal timestamps", async () => {
  const calls = [];
  const request = async (path) => {
    const query = new URL(`https://test.invalid${path}`).searchParams;
    calls.push(query);
    assert.ok(query.get("fields").includes("moving_time"));
    assert.ok(!query.get("fields").includes("icu_intervals"));
    if (query.has("limit"))
      return [activity("new", "2026-09-20"), activity("boundary1", "2010-05-05")];
    return [activity("boundary1", "2010-05-05"), activity("boundary2", "2010-05-05")];
  };
  const result = await fetchWorkoutHistoryPage(request, { end: "2026-10-07", pageSize: 2 });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].get("oldest"), "0001-01-01");
  assert.equal(result.next_before, "2010-05-04");
  assert.equal(result.workouts.length, 3);
  assert.equal(result.complete, false);
  assert.ok(
    result.workouts.every((row) => row.raw === undefined && row.raw_activity === undefined)
  );
});

test("a selected historic range returns all available summaries without a retention cutoff", async () => {
  let path;
  const result = await fetchWorkoutHistoryPage(
    async (value) => {
      path = value;
      return [activity("old", "2001-01-03")];
    },
    { start: "2001-01-01", end: "2001-12-31", before: "2001-03-31" }
  );
  assert.match(path, /oldest=2001-01-01&newest=2001-03-31/);
  assert.equal(result.workouts[0].workout_date, "2001-01-03");
  assert.equal(result.complete, true);
  assert.equal(result.next_before, null);
});

test("completed cursors and invalid dates do not issue provider requests", async () => {
  const request = () => {
    throw Error("Unexpected network call");
  };
  assert.equal(
    (
      await fetchWorkoutHistoryPage(request, {
        start: "2001-01-01",
        end: "2001-12-31",
        before: "2000-12-31",
      })
    ).complete,
    true
  );
  await assert.rejects(
    fetchWorkoutHistoryPage(request, { start: "2001-02-29", end: "2001-12-31" })
  );
});

test("a full report page on the first requested day includes every equal-day record", async () => {
  const result = await fetchWorkoutHistoryPage(
    async (path) =>
      new URL(`https://test.invalid${path}`).searchParams.has("limit")
        ? [activity("one", "2001-01-03")]
        : [activity("one", "2001-01-03"), activity("two", "2001-01-03")],
    { start: "2001-01-03", end: "2001-01-03", pageSize: 1 }
  );
  assert.equal(result.workouts.length, 2);
  assert.equal(result.complete, true);
  assert.equal(result.next_before, null);
});

test("compact report fields retain optional scalar metrics without requesting streams", async () => {
  const result = await fetchWorkoutHistoryPage(
    async (path) => {
      const fields = new URL(`https://test.invalid${path}`).searchParams.get("fields").split(",");
      for (const field of [
        "max_watts",
        "max_cadence",
        "start_latlng",
        "average_humidity",
        "average_weather_temp",
      ])
        assert.ok(fields.includes(field));
      assert.ok(!fields.includes("streams"));
      return [
        {
          ...activity("one", "2001-01-03"),
          max_watts: 420,
          max_cadence: 98,
          start_latlng: [1, 2],
          average_humidity: 70,
          average_weather_temp: 21,
        },
      ];
    },
    { start: "2001-01-03", end: "2001-01-03" }
  );
  const metrics = result.workouts[0].workout_summary.completed;
  assert.equal(metrics.max_power, 420);
  assert.equal(metrics.max_cadence, 98);
  assert.equal(metrics.latitude, 1);
  assert.equal(metrics.humidity_percent, 70);
  assert.equal(metrics.temperature_c, 21);
});
