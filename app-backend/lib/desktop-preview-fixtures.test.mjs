import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";
import { simpleWorkoutModel } from "./simple-workout.mjs";

const preview = () =>
  createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-15T12:00:00Z"), { gps: true })
  );

test("synthetic scoped dashboard preferences persist independent reads, preserve other connections, and never write provider records", async () => {
  const source = preview(),
    first = {
      version: 2,
      instances: [{ id: "duration-1", kind: "duration", settings: { title: "Duration" } }],
    },
    second = {
      version: 2,
      instances: [{ id: "distance-1", kind: "distance", settings: { title: "Distance" } }],
    };
  assert.equal(source.canWrite("training-preferences", "POST"), true);
  assert.equal(source.canWrite("training-preferences", "PUT"), false);
  const before = await source.handle("preview/provider-records", "GET");
  await source.handle("training-preferences", "POST", {
    training_preferences: { "desktopDashboard:connection-a": first },
  });
  await source.handle("training-preferences", "POST", {
    training_preferences: { "desktopDashboard:connection-b": second },
  });
  const loaded = await source.handle("training-preferences", "GET");
  assert.deepEqual(loaded.training_preferences["desktopDashboard:connection-a"], first);
  assert.deepEqual(loaded.training_preferences["desktopDashboard:connection-b"], second);
  loaded.training_preferences["desktopDashboard:connection-a"].instances.length = 0;
  assert.deepEqual(
    (await source.handle("training-preferences", "GET")).training_preferences[
      "desktopDashboard:connection-a"
    ],
    first
  );
  for (const input of [
    {},
    { training_preferences: [] },
    { training_preferences: { INTERVALS_API_KEY: "no" } },
    { training_preferences: { "desktopDashboard:connection-a": "bad" } },
  ])
    await assert.rejects(source.handle("training-preferences", "POST", input));
  assert.deepEqual(
    (await source.handle("training-preferences", "GET")).training_preferences[
      "desktopDashboard:connection-b"
    ],
    second
  );
  await source.handle("training-preferences", "POST", {
    training_preferences: { "desktopDashboard:connection-a": null },
  });
  const final = await source.handle("training-preferences", "GET");
  assert.equal(final.training_preferences["desktopDashboard:connection-a"], undefined);
  assert.deepEqual(final.training_preferences["desktopDashboard:connection-b"], second);
  const context = await source.handle(
    "training-context",
    "GET",
    {},
    new URL("http://fixture.invalid/api/training-context")
  );
  assert.deepEqual(context.training_preferences, final.training_preferences);
  assert.deepEqual(await source.handle("preview/provider-records", "GET"), before);
});

test("disposable race creation uses verified provider records, is idempotent, and updates calendar context", async () => {
  const source = preview(),
    input = { name: "Disposable race fixture", date: "2026-10-18", priority: "B" };
  assert.equal(source.canWrite("race-events", "POST"), true);
  assert.equal(source.canWrite("race-events", "DELETE"), false);
  const first = await source.handle("race-events", "POST", input);
  const repeated = await source.handle("race-events", "POST", input);
  assert.equal(first.event.id, repeated.event.id);
  assert.equal(first.event.priority, "B");
  assert.equal(first.plan, null);
  const rows = [...first.context.history, ...first.context.planned];
  assert.equal(rows.find((row) => row.id === `event:${first.event.id}`).category, "RACE_B");
  const listed = await source.handle("race-events", "GET");
  assert.equal(listed.events.filter((row) => row.id === first.event.id).length, 1);
  const raw = await source.handle("preview/provider-records", "GET");
  assert.equal(
    raw.writes.filter((row) => row.method === "POST" && row.body.name === input.name).length,
    1
  );
  const before = raw.events.length;
  await assert.rejects(
    source.handle("race-events", "POST", { ...input, priority: "D" }),
    /priority A, B or C/
  );
  assert.equal((await source.handle("preview/provider-records", "GET")).events.length, before);
});

test("disposable metrics preferences round-trip validated layouts and reject secrets without mutation", async () => {
  const source = preview();
  const layout = { graphs: ["hrv", "sleep", "restingHR"], cards: ["weight", "steps"] };
  const saved = await source.handle("config", "POST", {
    METRICS_LAYOUT: JSON.stringify(layout),
    CALENDAR_SUMMARY_OPEN: "false",
  });
  assert.deepEqual(saved.metricsLayout, layout);
  assert.equal(saved.calendarSummaryOpen, false);
  assert.equal(saved.INTERVALS_API_KEY, undefined);
  assert.deepEqual((await source.handle("config", "GET")).metricsLayout, layout);
  for (const input of [
    { METRICS_LAYOUT: "invalid" },
    { METRICS_LAYOUT: JSON.stringify({ graphs: ["onlyone"], cards: [] }) },
    { INTERVALS_API_KEY: "never-allowed" },
    { CALENDAR_SUMMARY_OPEN: "maybe" },
  ])
    await assert.rejects(source.handle("config", "POST", input));
  assert.deepEqual((await source.handle("config", "GET")).metricsLayout, layout);
});

test("disposable metric entries use the production wellness service and survive context reload with independent native patch evidence", async () => {
  const source = preview(),
    date = "2026-10-15",
    url = new URL(`http://fixture.invalid/api/calendar/metrics?date=${date}`);
  const loaded = await source.handle("calendar/metrics", "GET", {}, url);
  const saved = await source.handle("calendar/metrics", "POST", {
    date,
    revision: loaded.revision,
    operationId: "metrics-preview-operation-1",
    changes: {
      weight: { value: 180, time: "07:00" },
      overallFeeling: { value: "Best", time: "09:00" },
    },
  });
  assert.equal(saved.verified, true);
  assert.equal(saved.entries.weight.value, 180);
  const reloaded = await source.handle("calendar/metrics", "GET", {}, url);
  assert.equal(reloaded.entries.overallFeeling.value, "Best");
  const context = await source.handle(
    "training-context",
    "GET",
    {},
    new URL(`http://fixture.invalid/api/training-context?scope=range&start=${date}&end=${date}`)
  );
  assert.equal(
    context.wellness_history.find((row) => row.date === date).calendar_metrics.overallFeeling.time,
    "09:00"
  );
  const provider = await source.handle("preview/provider-records", "GET");
  const write = provider.writes.find((write) => write.path === `/athlete/0/wellness/${date}`);
  assert.deepEqual(write.body, { weight: 180 * 0.45359237 });
  assert.equal(provider.wellnessRecords.find((row) => row.id === date).weight, 180 * 0.45359237);
});

test("a lost disposable metrics HTTP reply recovers without another provider write", async () => {
  const source = createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-15T12:00:00Z")),
    { loseMetricsResponseOnce: true }
  );
  const date = "2026-10-15",
    loaded = await source.handle(
      "calendar/metrics",
      "GET",
      {},
      new URL(`http://fixture.invalid/api/calendar/metrics?date=${date}`)
    );
  const input = {
    date,
    revision: loaded.revision,
    operationId: "metrics-preview-operation-2",
    changes: { restingHR: { value: 55, time: "06:30" } },
  };
  await assert.rejects(
    source.handle("calendar/metrics", "POST", input),
    (error) => error.code === "METRICS_WRITE_UNCONFIRMED"
  );
  const retried = await source.handle("calendar/metrics", "POST", input);
  assert.equal(retried.replayed, true);
  assert.equal(retried.entries.restingHR.value, 55);
  const provider = await source.handle("preview/provider-records", "GET");
  assert.equal(
    provider.writes.filter((write) => write.path === `/athlete/0/wellness/${date}`).length,
    1
  );
});

test("missed workouts with abandoned direct and queued claims can be moved and deleted through production write guards", async () => {
  const source = createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-15T12:00:00Z")),
    { staleWorkoutClaims: true }
  );
  const all = () => [...source.context().history, ...source.context().planned];
  const run = all().find((row) => row.title === "Missed run — editable past workout");
  const swim = all().find((row) => row.title === "Missed swim — editable past workout");
  const recordings = all()
    .filter((row) => row.status === "completed")
    .map((row) => row.id)
    .sort();
  assert.ok(run.workout_date < "2026-10-15");
  const moved = await source.handle(`workouts/${encodeURIComponent(run.id)}/move`, "POST", {
    date: "2026-10-20",
  });
  assert.equal(moved.verified, true);
  assert.equal(all().find((row) => row.id === run.id).workout_date, "2026-10-20");
  assert.equal(all().filter((row) => row.id === run.id).length, 1);
  const deleted = await source.handle(`workouts/${encodeURIComponent(swim.id)}`, "DELETE", {});
  assert.equal(deleted.verified, true);
  assert.ok(!all().some((row) => row.id === swim.id));
  assert.equal(
    (await source.handle(`workouts/${encodeURIComponent(swim.id)}`, "DELETE", {})).verified,
    true
  );
  assert.deepEqual(
    all()
      .filter((row) => row.status === "completed")
      .map((row) => row.id)
      .sort(),
    recordings
  );
});

test("preview linking uses the production Intervals pairing write and retains exactly one recording", async () => {
  const source = preview();
  const all = () => [
    ...new Map(
      [...source.context().history, ...source.context().planned].map((row) => [row.id, row])
    ).values(),
  ];
  const plan = all().find((row) => row.title === "Linkable bike plan");
  const ride = all().find((row) => row.title === "Recorded bike — ready to link");
  const result = await source.handle("workouts/pair", "POST", {
    plannedId: plan.id,
    completedId: ride.id,
  });
  assert.equal(result.verified, true);
  assert.equal(result.workout.activity_id, "i9900");
  assert.equal(result.workout.id, plan.id);
  assert.equal(result.workout.raw_activity.paired_event_id, Number(plan.id.split(":")[1]));
  assert.equal(all().filter((row) => row.activity_id === "i9900").length, 1);
  assert.ok(!all().some((row) => row.id === ride.id));
});

test("Analyze 360 preview includes configured sport zones and dated performance metrics", () => {
  const context = preview().context();
  assert.ok(
    context.athlete.sport_settings.find((setting) => setting.types.includes("Bike")).power_zones
      .length > 0
  );
  assert.ok(
    context.athlete.sport_settings.find((setting) => setting.types.includes("Run")).threshold_pace >
      0
  );
  const latest = context.wellness_history.at(-1);
  assert.equal(latest.ctl, context.metrics.fitness);
  assert.equal(latest.atl, context.metrics.fatigue);
  assert.equal(latest.tsb, context.metrics.form);
});
test("editable preview activities resolve to complete recordings, laps and outdoor routes", () => {
  const source = preview();
  const workouts = source
    .context()
    .history.filter((workout) => /^i900\d$/.test(workout.activity_id || ""));
  assert.ok(workouts.length >= 5);
  for (const workout of workouts) {
    const analysis = source.analysis(workout.activity_id);
    assert.ok(analysis.points.length >= 30);
    assert.equal(analysis.duration, workout.workout_summary.completed.duration_seconds);
    assert.equal(analysis.laps.length, 4);
    assert.ok(
      analysis.points.every(
        (point) =>
          Number.isFinite(point.time) &&
          Number.isFinite(point.speed) &&
          Number.isFinite(point.heartRate)
      )
    );
    if (workout.sport !== "Swim")
      assert.ok(
        analysis.points.every(
          (point) =>
            Number.isFinite(point.elevation) &&
            Number.isFinite(point.latitude) &&
            Number.isFinite(point.longitude)
        )
      );
    if (workout.sport === "Bike")
      assert.ok(analysis.points.every((point) => Number.isFinite(point.power)));
  }
});

test("test calendar retains planned totals and intervals when descriptions and comments are saved", async () => {
  const source = preview();
  const workout = source
    .context()
    .planned.find((workout) => workout.title === "Editable bike workout");
  const route = `workouts/${encodeURIComponent(workout.id)}/planned-values`;
  const loaded = await source.handle(route, "GET", {}, new URL("http://localhost"));
  const updated = await source.handle(
    route,
    "PUT",
    { values: { tss: 75 }, revision: loaded.revision },
    new URL("http://localhost")
  );
  await source.handle(
    "calendar/workout-description",
    "POST",
    { id: workout.id, description: "Save the complete workout draft." },
    new URL("http://localhost")
  );
  const final = await source.handle(route, "GET", {}, new URL("http://localhost"));
  assert.equal(final.workout.workout_summary.planned.tss, 75);
  assert.deepEqual(final.event.workout_doc.steps, updated.event.workout_doc.steps);
  assert.match(final.event.description, /Save the complete workout draft/);
  assert.equal(final.workout.editable_description, "Save the complete workout draft.");
  const comment = {
    workoutId: workout.id,
    body: "A single saved comment",
    type: "pre",
    creationId: "4fe8bc1e-1eca-4e7d-8381-d86a1f755275",
  };
  await source.handle("comments", "POST", comment);
  await source.handle("comments", "POST", comment);
  const comments = await source.handle(
    "comments",
    "GET",
    {},
    new URL(`http://localhost?workoutId=${workout.id}`)
  );
  assert.equal(comments.comments.length, 1);
});
test("the disposable lost-response scenario recovers exactly one provider workout on read-only recheck", async () => {
  const source = createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-16T12:00:00Z")),
    { loseCreateResponseOnce: true }
  );
  const values = { duration_seconds: 2700 };
  const input = {
    model: simpleWorkoutModel({
      name: "Lost reply recovery",
      sport: "Run",
      date: "2026-10-18",
      values,
    }),
    values,
    time: "06:30",
    comment: "Keep one comment.",
    creationId: "f55ad630-4a72-4b2d-8158-3db46715d3af",
  };
  await assert.rejects(
    source.handle("workouts/editor", "POST", input, new URL("http://localhost")),
    (error) => error.code === "CREATE_UNCONFIRMED"
  );
  const saved = await source.handle(
    "workouts/editor",
    "POST",
    { ...input, reconcileOnly: true },
    new URL("http://localhost")
  );
  assert.equal(saved.verified, true);
  const workouts = [...source.context().planned, ...source.context().history].filter(
    (workout) => workout.title === "Lost reply recovery"
  );
  assert.equal(new Set(workouts.map((workout) => workout.id)).size, 1);
});

test("desktop paste recovery uses the production durable identity path and does not duplicate a lost response", async () => {
  const source = createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-16T12:00:00Z")),
    { loseCopyResponseOnce: true }
  );
  const original = source
    .context()
    .planned.find((workout) => workout.title === "Editable bike workout");
  const route = `workouts/${encodeURIComponent(original.id)}/copy`;
  const input = { date: "2026-10-20", creationId: "f55ad630-4a72-4b2d-8158-3db46715d3af" };
  await assert.rejects(
    source.handle(route, "POST", input, new URL("http://localhost")),
    /response lost/
  );
  const result = await source.handle(route, "POST", input, new URL("http://localhost"));
  assert.equal(result.verified, true);
  const copies = source
    .context()
    .planned.filter(
      (workout) => workout.title === original.title && workout.workout_date === input.date
    );
  assert.equal(copies.length, 1);
});
