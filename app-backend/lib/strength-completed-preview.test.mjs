import test from "node:test";
import assert from "node:assert/strict";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";
import { readEditorModel } from "./workout-editor-model.mjs";

const fixture = () =>
  createDesktopCalendarPreview(createDesktopPreviewFixtures(new Date("2026-10-21T12:00:00Z")));
const expected = [
  { name: "Completed Strength — paired prescription", seconds: 1500, tss: 31, intensity: 72 },
  { name: "Completed Strength — provider only", seconds: 900, tss: 0, intensity: 0 },
];

test("completed Strength append-only seeds preserve old IDs and raw provider text, without invented streams or set results", async () => {
  const source = fixture(),
    before = await source.handle("preview/provider-records", "GET");
  assert.equal(before.events.find((row) => row.name === "Completed bike — on target").id, 9000);
  assert.equal(before.events.find((row) => row.name === "Editable swim workout").id, 9009);
  assert.deepEqual(before.writes, []);
  for (const definition of expected) {
    const raw = before.activities.find((row) => row.name === definition.name);
    assert.equal(raw.type, "WeightTraining");
    assert.equal(raw.moving_time, definition.seconds);
    assert.equal(raw.icu_training_load, definition.tss);
    assert.equal(raw.icu_intensity, definition.intensity);
    for (const field of ["distance", "average_cadence", "sets", "exercises"])
      assert.equal(Object.hasOwn(raw, field), false, field);
    assert.doesNotMatch(raw.description, /Workout editor v1|\{"version"|device definition/i);
    const summary = await source.handle(`activities/${raw.id}/summary`, "GET");
    assert.equal(summary.duration_seconds, definition.seconds);
    assert.equal(summary.tss, definition.tss);
    assert.equal(summary.intensity_factor, definition.intensity / 100);
    assert.equal(summary.distance_meters, null);
    assert.equal(summary.average_cadence, null);
    const analysis = await source.handle(`activities/${raw.id}/analysis`, "GET");
    // No recorded streams were supplied: the production normalizer exposes
    // an empty analysis rather than manufacturing samples from moving_time.
    assert.equal(analysis.duration, 0);
    assert.deepEqual(analysis.points, []);
    assert.deepEqual(await source.handle(`activities/${raw.id}/route`, "GET"), { points: [] });
  }
  assert.deepEqual((await source.handle("preview/provider-records", "GET")).writes, []);
});

test("paired Strength keeps exact private prescription and distinct planned values; provider-only recording has no phantom plan", async () => {
  const source = fixture(),
    before = await source.handle("preview/provider-records", "GET"),
    raw = before.activities.find((row) => row.name === expected[0].name),
    event = before.events.find((row) => row.id === raw.paired_event_id),
    paired = source.lookup(`event:${event.id}`);
  assert.equal(paired.status, "completed");
  assert.equal(paired.activity_id, raw.id);
  assert.equal(paired.workout_summary.planned.duration_seconds, 1200);
  assert.equal(paired.workout_summary.planned.tss, 20);
  assert.equal(paired.workout_summary.planned.intensity_factor, 0.55);
  assert.equal(paired.workout_summary.completed.duration_seconds, 1500);
  assert.equal(paired.workout_summary.completed.tss, 31);
  assert.equal(paired.workout_summary.completed.intensity_factor, 0.72);
  assert.equal(paired.editor_model.strength.subtype, "Yoga");
  const exercise = paired.editor_model.strength.blocks[0].exercises[0];
  assert.equal(exercise.title, "Fixture Air Squat");
  assert.equal(exercise.sets.length, 3);
  for (const parameter of exercise.parameters)
    for (const set of exercise.sets)
      assert.equal(set.values[parameter.id], parameter.kind === "reps" ? 8 : 50);
  assert.doesNotMatch(
    event.description,
    /Workout editor v1|training-agent-planned-values|\{"version"|device definition/i
  );
  // A real metadata-adapter GET rehydrates the independently seeded sidecar.
  const hydrated = await source.request(`/athlete/0/events/${event.id}`);
  assert.deepEqual(readEditorModel(hydrated.description).strength, paired.editor_model.strength);
  const providerOnly = source.lookup(
    before.activities.find((row) => row.name === expected[1].name).id
  );
  assert.equal(providerOnly.workout_summary.planned, null);
  assert.equal(providerOnly.editor_model, undefined);
  assert.equal(providerOnly.workout_summary.completed.tss, 0);
  assert.equal(providerOnly.workout_summary.completed.intensity_factor, 0);
  assert.deepEqual(await source.handle("preview/provider-records", "GET"), before);
});

test("production activity-bundle summary GET does not share mutable outputs or affect unrelated summary routes", async () => {
  const source = fixture(),
    before = await source.handle("preview/provider-records", "GET"),
    raw = before.activities.find((row) => row.name === expected[0].name),
    path = `activities/${raw.id}/summary`,
    first = await source.handle(path, "GET");
  first.duration_seconds = 99999;
  assert.equal((await source.handle(path, "GET")).duration_seconds, 1500);
  assert.equal(await source.handle("activities/i9000/summary", "GET"), undefined);
  assert.equal(await source.handle(`activities/${raw.id}/summary`, "PUT", {}), undefined);
  assert.deepEqual(await source.handle("preview/provider-records", "GET"), before);
});

test("explicit completed Strength description Save and restore preserve native duration and exact private prescription", async () => {
  const source = fixture(),
    before = await source.handle("preview/provider-records", "GET"),
    raw = before.activities.find((row) => row.name === expected[0].name),
    event = before.events.find((row) => row.id === raw.paired_event_id),
    workout = source.lookup(`event:${event.id}`);
  for (const description of [
    "Explicit synthetic completed description.",
    workout.manual_description,
  ]) {
    const result = await source.handle("calendar/workout-description", "POST", {
      id: workout.id,
      description,
      descriptionMode: "manual",
    });
    assert.equal(result.verified, true);
    const after = await source.handle("preview/provider-records", "GET"),
      saved = after.events.find((row) => row.id === event.id);
    assert.equal(
      saved.moving_time,
      1200,
      "Description prose must not be parsed as new zero-duration device intervals"
    );
    assert.equal(saved.time_target, 1200);
    assert.equal(saved.workout_doc, undefined);
    assert.doesNotMatch(saved.description, /Workout editor v1|\{"version"|device definition/i);
    assert.deepEqual(
      source.lookup(workout.id).editor_model.strength,
      workout.editor_model.strength
    );
  }
  const restored = await source.handle("preview/provider-records", "GET"),
    semantic = (value) =>
      Object.fromEntries(Object.entries(value).filter(([field]) => field !== "updated"));
  assert.deepEqual(restored.events.map(semantic), before.events.map(semantic));
  assert.deepEqual(restored.activities, before.activities);
  assert.equal(restored.writes.length, 2);
  for (const write of restored.writes) {
    assert.equal(write.method, "PUT");
    assert.equal(write.path, `/athlete/0/events/${event.id}`);
  }
});
