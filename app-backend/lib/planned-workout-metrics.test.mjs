import { test } from "node:test";
import { createProviderWorkoutMetadata } from "./provider-workout-metadata.mjs";
import assert from "node:assert/strict";
import { fixtureEvent, parseTestWorkout } from "./fixtures/workout-editor-fixtures.mjs";
import {
  loadPlannedWorkoutMetrics,
  savePlannedWorkoutMetrics,
} from "./planned-workout-metrics.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";
import { readPlannedValues, withPlannedValues } from "./planned-workout-values.mjs";
import { readableDescription, readEditorModel } from "./workout-editor-model.mjs";
import { loadWorkoutEditor, saveWorkoutEditor, workoutRevision } from "./workout-editor.mjs";
import { updateWorkoutDescription } from "./workout-description.mjs";
function provider(sport = "Run") {
  let event = fixtureEvent(sport),
    writes = 0;
  const request = async (path, options = {}) => {
    if (path === "/athlete/0") return { sportSettings: [] };
    if (options.method === "PUT") {
      const patch = JSON.parse(options.body);
      writes++;
      event = {
        ...event,
        ...patch,
        workout_doc:
          patch.description == null ? event.workout_doc : parseTestWorkout(patch.description),
      };
    }
    return structuredClone(event);
  };
  return {
    request,
    get event() {
      return event;
    },
    set event(value) {
      event = value;
    },
    get writes() {
      return writes;
    },
  };
}
for (const sport of ["Run", "Ride", "Swim"])
  test(`${sport}: all planned values save and reload without changing intervals or pairing`, async () => {
    const p = provider(sport);
    p.event = { ...p.event, paired_activity_id: "i9" };
    const original = structuredClone(p.event),
      id = `event:${p.event.id}`;
    const { revision } = await loadPlannedWorkoutMetrics(p.request, id);
    const values = {
      duration_seconds: 3720,
      distance_meters: 8000,
      average_speed: 3,
      average_power: 195,
      normalized_power: 217.25,
      calories: 450,
      elevation_gain: 62,
      elevation_loss: 50,
      tss: 86,
      intensity_factor: 0.87,
      work_kj: 700,
    };
    const result = await savePlannedWorkoutMetrics(p.request, id, { values, revision });
    assert.equal(result.verified, true);
    assert.equal(p.writes, 1);
    assert.deepEqual(result.event.workout_doc.steps, original.workout_doc.steps);
    assert.equal(result.event.paired_activity_id, "i9");
    assert.equal(result.event.time_target, 3720);
    assert.equal(result.event.load_target, 86);
    assert.equal(result.event.icu_intensity, original.icu_intensity);
    assert.equal(readPlannedValues(result.event.description).intensity_factor, 0.87);
    assert.equal(result.event.joules, 700000);
    assert.equal(
      result.event.normalized_power,
      undefined,
      "Planned NP stays in private planned metadata, not an invented native event field"
    );
    assert.equal(result.event.icu_pm_np, original.icu_pm_np);
    const actual = {
      id: "i9",
      moving_time: 3600,
      distance: 6000,
      calories: 600,
      icu_training_load: 91,
    };
    const mapped = mapIntervalsWorkout(result.event, "2026-10-14", actual);
    for (const [key, value] of Object.entries(values))
      assert.equal(mapped.workout_summary.planned[key], value);
    assert.equal(mapped.workout_summary.completed.calories, 600);
    assert.equal(mapped.workout_summary.completed.duration_seconds, 3600);
    assert.equal(mapped.status, "completed");
    assert.deepEqual(
      readEditorModel(result.event.description),
      readEditorModel(original.description)
    );
    assert.equal(
      readableDescription(result.event.description),
      readableDescription(original.description)
    );
    await savePlannedWorkoutMetrics(p.request, id, { values, revision });
    assert.equal(p.writes, 1);
  });
test("conflicts, permissions and invalid values stop before writes", async () => {
  const p = provider(),
    id = `event:${p.event.id}`,
    revision = workoutRevision(p.event);
  p.event = { ...p.event, time_target: 123 };
  await assert.rejects(
    savePlannedWorkoutMetrics(p.request, id, { values: { tss: 50 }, revision }),
    { code: "CONFLICT" }
  );
  for (const values of [
    { tss: 2.5 },
    { duration_seconds: -1 },
    { calories: Infinity },
    { normalized_power: -1 },
    { normalized_power: Infinity },
    { intensity_factor: 5.1 },
    { unknown: 5 },
  ])
    await assert.rejects(savePlannedWorkoutMetrics(p.request, id, { values, revision }));
  p.event = { ...p.event, athlete_cannot_edit: true };
  await assert.rejects(loadPlannedWorkoutMetrics(p.request, id), { code: "READ_ONLY" });
  await assert.rejects(
    savePlannedWorkoutMetrics(p.request, "activity:i9", { values: { tss: 50 }, revision })
  );
  assert.equal(p.writes, 0);
});
test("lost PUT response reconciles once; ignored updates and damaged steps cannot succeed", async () => {
  const p = provider(),
    id = `event:${p.event.id}`;
  const request = async (path, options) => {
    const event = await p.request(path, options);
    if (options?.method === "PUT") throw Error("Lost reply");
    return event;
  };
  const result = await savePlannedWorkoutMetrics(request, id, {
    values: { tss: 50 },
    revision: workoutRevision(p.event),
  });
  assert.equal(result.verified, true);
  assert.equal(p.writes, 1);
  const ignored = provider();
  await assert.rejects(
    savePlannedWorkoutMetrics(
      async () => structuredClone(ignored.event),
      `event:${ignored.event.id}`,
      { values: { calories: 500 }, revision: workoutRevision(ignored.event) }
    ),
    { code: "SAVE_UNCONFIRMED" }
  );
  const damaged = provider();
  await assert.rejects(
    savePlannedWorkoutMetrics(
      async (path, options) => {
        const event = await damaged.request(path, options);
        if (damaged.writes) event.workout_doc.steps = [];
        return event;
      },
      `event:${damaged.event.id}`,
      { values: { tss: 60 }, revision: workoutRevision(damaged.event) }
    ),
    { code: "SAVE_UNCONFIRMED" }
  );
});
test("clearing totals and changing time recalculates pace without rounding untouched fields", async () => {
  const p = provider();
  p.event = {
    ...p.event,
    description: withPlannedValues(p.event.description, {
      duration_seconds: 1000,
      distance_meters: 4000,
      average_speed: 3.123456,
      calories: 450,
    }),
  };
  const result = await savePlannedWorkoutMetrics(p.request, `event:${p.event.id}`, {
    values: { duration_seconds: 2000, calories: null },
    revision: workoutRevision(p.event),
  });
  const mapped = mapIntervalsWorkout(result.event, "2026-10-14");
  assert.equal(mapped.workout_summary.planned.average_speed, 2);
  assert.equal(mapped.workout_summary.planned.calories, null);
  assert.equal(readPlannedValues(result.event.description).distance_meters, 4000);
});
test("description and structured editor saves retain planned values", async () => {
  const p = provider();
  p.event = {
    ...p.event,
    description: withPlannedValues(p.event.description, { calories: 500, tss: 50 }),
  };
  const id = `event:${p.event.id}`;
  await updateWorkoutDescription(p.request, id, "New coaching instructions");
  assert.deepEqual(readPlannedValues(p.event.description), { calories: 500, tss: 50 });
  const loaded = await loadWorkoutEditor(p.request, id);
  loaded.model.name = "Edited workout";
  await saveWorkoutEditor(p.request, id, loaded);
  assert.deepEqual(readPlannedValues(p.event.description), { calories: 500, tss: 50 });
  assert.ok(readEditorModel(p.event.description));
});

test("title, date and time save together with totals and retain a multiday span", async () => {
  const p = provider(),
    id = `event:${p.event.id}`;
  p.event = {
    ...p.event,
    start_date_local: "2026-10-15T06:15:00",
    end_date_local: "2026-10-16T07:30:00",
  };
  const revision = workoutRevision(p.event);
  const result = await savePlannedWorkoutMetrics(p.request, id, {
    revision,
    values: { tss: 80 },
    name: "Changed title",
    date: "2026-10-17",
    time: "08:45",
  });
  assert.equal(result.event.name, "Changed title");
  assert.equal(result.event.start_date_local, "2026-10-17T08:45:00");
  assert.equal(result.event.end_date_local, "2026-10-18T07:30:00");
  await savePlannedWorkoutMetrics(p.request, id, {
    revision,
    values: { tss: 80 },
    name: "Changed title",
    date: "2026-10-17",
    time: "08:45",
  });
  assert.equal(p.writes, 1);
  const fresh = workoutRevision(p.event);
  for (const fields of [{ name: " " }, { date: "invalid" }, { time: "25:00" }])
    await assert.rejects(savePlannedWorkoutMetrics(p.request, id, { revision: fresh, ...fields }));
  assert.equal(p.writes, 1);
});

function derivedPlannedProvider({ lostAck = false, corrupt } = {}) {
  const p = provider("Ride"),
    records = new Map(),
    outbound = [];
  p.event = { ...p.event, time_target: 600, load_target: 9, icu_intensity: 73.484695 };
  let lost = false;
  const raw = async (path, options = {}) => {
    if (options.method === "PUT") outbound.push(JSON.parse(options.body));
    const result = await p.request(path, options);
    result.icu_intensity =
      result.time_target === 600 && result.load_target === 9
        ? 73.484695
        : Number((Math.sqrt((result.load_target * 3600) / result.time_target) * 10).toFixed(6));
    p.event = { ...p.event, icu_intensity: result.icu_intensity };
    corrupt?.(result, options);
    if (lostAck && options.method === "PUT" && !lost) {
      lost = true;
      throw Error("Acknowledgement lost after native update");
    }
    return result;
  };
  const wrap = () =>
    createProviderWorkoutMetadata({
      record: (key, fresh) => ({
        read: async () => structuredClone(records.get(key) ?? fresh()),
        update: async (change) => {
          const state = structuredClone(records.get(key) ?? fresh());
          change(state);
          records.set(key, state);
          return structuredClone(state);
        },
      }),
    }).wrap(raw);
  return { p, wrap, outbound };
}
test("planned metric edits persist exact private IF and clear/zero independently of provider-derived native intensity", async () => {
  const f = derivedPlannedProvider();
  for (const value of [0.75, 0, null, 0.81]) {
    const request = f.wrap(),
      loaded = await loadPlannedWorkoutMetrics(request, "event:100"),
      values = { duration_seconds: 600, tss: 9, intensity_factor: value };
    const saved = await savePlannedWorkoutMetrics(request, "event:100", {
      values,
      revision: loaded.revision,
    });
    assert.equal(saved.verified, true);
    assert.equal(saved.event.icu_intensity, 73.484695);
    assert.equal(readPlannedValues(saved.event.description).intensity_factor, value);
    assert.equal(f.outbound.at(-1).time_target, 600);
    assert.equal(f.outbound.at(-1).load_target, 9);
    assert.equal(Object.hasOwn(f.outbound.at(-1), "icu_intensity"), false);
    assert.doesNotMatch(
      f.outbound.at(-1).description,
      /training-agent-planned-values|Workout editor v1/
    );
    const reopened = await loadPlannedWorkoutMetrics(f.wrap(), "event:100");
    assert.equal(readPlannedValues(reopened.event.description).intensity_factor, value);
    const writes = f.p.writes;
    await savePlannedWorkoutMetrics(f.wrap(), "event:100", { values, revision: loaded.revision });
    assert.equal(f.p.writes, writes);
  }
});
test("an acknowledged-loss planned edit recovers actual changed native fields and private IF without another PUT", async () => {
  const f = derivedPlannedProvider({ lostAck: true }),
    loaded = await loadPlannedWorkoutMetrics(f.wrap(), "event:100"),
    input = {
      values: { duration_seconds: 601, tss: 9, intensity_factor: 0.75 },
      revision: loaded.revision,
    };
  const saved = await savePlannedWorkoutMetrics(f.wrap(), "event:100", input);
  assert.equal(saved.verified, true);
  assert.equal(saved.event.time_target, 601);
  assert.equal(readPlannedValues(saved.event.description).intensity_factor, 0.75);
  assert.equal(f.p.writes, 1);
  await savePlannedWorkoutMetrics(f.wrap(), "event:100", input);
  assert.equal(f.p.writes, 1);
});
test("native duration/load/prescription mismatches still reject planned metric verification despite exact private IF", async () => {
  for (const corrupt of [
    (event) => event.time_target++,
    (event) => event.load_target++,
    (event) => event.workout_doc.steps[0].duration++,
  ]) {
    let afterWrite = false;
    const f = derivedPlannedProvider({
        corrupt: (event, options) => {
          if (options.method === "PUT") afterWrite = true;
          if (afterWrite) corrupt(event);
        },
      }),
      loaded = await loadPlannedWorkoutMetrics(f.wrap(), "event:100");
    await assert.rejects(
      savePlannedWorkoutMetrics(f.wrap(), "event:100", {
        values: { duration_seconds: 600, tss: 9, intensity_factor: 0.75 },
        revision: loaded.revision,
      }),
      (error) => error.code === "SAVE_UNCONFIRMED"
    );
  }
});
