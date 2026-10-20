import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";
import { simpleWorkoutModel } from "./simple-workout.mjs";

const preview = () =>
  createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-15T12:00:00Z"), { gps: true })
  );

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
