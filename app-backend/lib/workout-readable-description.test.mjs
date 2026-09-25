import test from "node:test";
import assert from "node:assert/strict";
import {
  appWorkoutDescription,
  eventWorkoutDescription,
  formatWorkoutDescription,
} from "./workout-readable-description.mjs";
import {
  importWorkout,
  newRepeat,
  serializeWorkout,
  expandSteps,
} from "./workout-editor-model.mjs";
import { fakeProvider, fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { loadWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";
import { fetchIntervalsContext, mapIntervalsWorkout } from "./intervals.mjs";
import { projectTrainingContext } from "./fast-context.mjs";

const swimStep = (distance, zone, label = "FS", role = "active") => ({
  id: crypto.randomUUID(),
  kind: "step",
  label,
  notes: "",
  role,
  end: { kind: "distance", value: distance, unit: "yd", pressLap: true },
  target: { kind: "pace", unit: "pace_zone", mode: "single", value: zone },
  cadence: null,
});
const rest = (seconds = 20) => ({
  ...swimStep(0, 1, "Rest", "rest"),
  end: { kind: "time", value: seconds, unit: "s" },
  target: { kind: "none" },
});
const swim = (steps) => ({
  version: 1,
  name: "Swim",
  sport: "Swim",
  date: "2026-10-10",
  notes: "Do not add this advice",
  poolLength: "25y",
  steps,
});

test("app descriptions use ordered headings, stroke, units and exact repeated rests", () => {
  const repeats = {
    ...newRepeat([swimStep(100, 3, "Pull")]),
    repetitions: 3,
    recovery: rest(),
    finalRecovery: true,
  };
  const model = swim([
    swimStep(300, 2, "freestyle with fins", "warmup"),
    rest(),
    repeats,
    swimStep(100, 1, "Choice", "cooldown"),
  ]);
  const original = structuredClone(model);
  assert.equal(
    formatWorkoutDescription(model),
    "Warm Up:\n1 x (300 yd FS with fins in Z2 + 20 secs rest)\n\nMain Set:\n3 x (100 yd Pull in Z3 + 20 sec rests)\n\nWarm Down:\n100 yd Choice in Z1"
  );
  assert.deepEqual(model, original);
});

test("different repeated steps keep their order and show distance per set", () => {
  const group = {
    ...newRepeat([
      swimStep(100, 2),
      rest(10),
      swimStep(200, 3, "Pull"),
      rest(15),
      swimStep(200, 4, "Kick"),
    ]),
    repetitions: 3,
    recovery: rest(25),
    finalRecovery: true,
  };
  assert.equal(
    formatWorkoutDescription(swim([group])),
    "Main Set:\nRepeat 3 sets of 500 yd as below:\n  1 x (100 yd FS in Z2 + 10 sec rests)\n  1 x (200 yd Pull in Z3 + 15 sec rests)\n  1 x (200 yd Kick in Z4 + 25 sec rests)"
  );
});

test("only identical intervals group; progressions and unequal recovery remain separate", () => {
  const model = swim([
    swimStep(100, 2),
    rest(),
    swimStep(100, 2),
    rest(),
    swimStep(100, 3),
    rest(),
    swimStep(200, 3),
    rest(30),
    swimStep(200, 3),
    rest(40),
  ]);
  assert.equal(
    formatWorkoutDescription(model),
    "Main Set:\n2 x (100 yd FS in Z2 + 20 sec rests)\n1 x (100 yd FS in Z3 + 20 secs rest)\n1 x (200 yd FS in Z3 + 30 secs rest)\n1 x (200 yd FS in Z3 + 40 secs rest)"
  );
});

test("omitted final recovery, nested sets and combination swims preserve execution", () => {
  const group = {
    ...newRepeat([swimStep(100, 3)]),
    repetitions: 3,
    recovery: rest(),
    finalRecovery: false,
  };
  assert.equal(
    formatWorkoutDescription(swim([group])),
    "Main Set:\n2 x (100 yd FS in Z3 + 20 sec rests)\n100 yd FS in Z3"
  );
  const combo = {
    ...newRepeat([swimStep(100, 2), swimStep(100, 2, "Drill")]),
    repetitions: 1,
    recovery: rest(),
    finalRecovery: true,
  };
  assert.equal(
    formatWorkoutDescription(swim([combo])),
    "Main Set:\n1 x (100 yd FS in Z2 + 100 yd Drill in Z2 + 20 secs rest)"
  );
  const nested = swim([{ ...group, repetitions: 2, sets: 2, setRecovery: rest(60) }]);
  const before = expandSteps(nested.steps);
  assert.equal(
    formatWorkoutDescription(nested),
    "Main Set:\n1 x (100 yd FS in Z3 + 20 secs rest)\n100 yd FS in Z3\n+ 1 min rest\n1 x (100 yd FS in Z3 + 20 secs rest)\n100 yd FS in Z3"
  );
  assert.deepEqual(expandSteps(nested.steps), before);
});

test("bike zones use configured boundaries and keep exact watts and ramps", () => {
  const model = importWorkout(fixtureEvent()).model;
  const settings = [{ types: ["Ride"], ftp: 250, power_zones: [55, 75, 90, 105, 120, 999] }];
  assert.equal(
    formatWorkoutDescription(model, settings),
    "Warm Up:\n10 mins in Z1 → Z2 (100 → 180 W)\n\nMain Set:\n3 x (3 mins in Z3 (200–220 W) at 85–95 rpm + 1 min in Z1 (100 W) recovery)\n\nWarm Down:\n5 mins in Z2 → Z1 (150 → 90 W)"
  );
  assert.match(formatWorkoutDescription(model), /200–220 W/);
  assert.doesNotMatch(formatWorkoutDescription(model), /\bZ\d/);
});

test("run pace and sub-minute durations stay exact, including recovery pace", () => {
  const model = importWorkout(fixtureEvent("Run")).model;
  model.steps[1].steps[0].end.value = 30;
  model.steps[1].recovery.end.value = 90;
  assert.equal(
    formatWorkoutDescription(model),
    "Warm Up:\n5 mins at 10:00 min/mile\n\nMain Set:\n4 x (30 secs at 7:30–8:00 min/mile + 1 min 30 secs at 10:30 min/mile recovery)\n\nWarm Down:\n5 mins at 10:00 min/mile"
  );
});

test("formatting saved descriptions performs no provider writes or workout mutations", async () => {
  const provider = fakeProvider(fixtureEvent("Swim"));
  const loaded = await loadWorkoutEditor(provider.request, "event:100");
  loaded.model.steps[1].steps[0].label = "Pull";
  const expectedProviderDescription = serializeWorkout(loaded.model);
  const saved = await saveWorkoutEditor(provider.request, "event:100", {
    model: loaded.model,
    revision: loaded.revision,
  });
  const before = provider.event(),
    calls = provider.calls.length;
  const mapped = mapIntervalsWorkout(saved.event, "2026-09-17");
  assert.match(mapped.details, /4 x \(100 yd Pull in Z3 \+ 20 sec rests\)/);
  assert.notEqual(mapped.goal, mapped.details);
  assert.equal(provider.calls.length, calls);
  assert.deepEqual(provider.event(), before);
  assert.equal(provider.event().description, expectedProviderDescription);
  assert.deepEqual(JSON.parse(mapped.structure), saved.event.workout_doc);
  assert.equal(mapped.raw, saved.event);
  assert.equal(mapped.plannedDurationMinutes, Math.round(saved.event.workout_doc.duration / 60));
  assert.equal(mapped.distance_meters, saved.event.workout_doc.distance);
  assert.equal(mapped.sport, "Swim");
  assert.equal(mapped.details, eventWorkoutDescription(provider.event()));
});

test("sync generates app descriptions with athlete zones using read-only requests", async () => {
  const event = fixtureEvent();
  const original = structuredClone(event);
  const calls = [];
  const context = await fetchIntervalsContext(
    async (path, options) => {
      calls.push({ path, options });
      if (path === "/athlete/0")
        return {
          id: "1",
          sportSettings: [{ types: ["Ride"], ftp: 250, power_zones: [55, 75, 90, 105, 120, 999] }],
        };
      if (path.startsWith("/athlete/0/events?")) return [event];
      return [];
    },
    { now: new Date("2026-10-10T12:00:00Z") }
  );
  assert.match(context.planned[0].details, /in Z3 \(200–220 W\)/);
  assert.ok(calls.every((call) => !call.options?.method || call.options.method === "GET"));
  assert.deepEqual(event, original);
});

test("cached structured workouts render locally; completed and unsupported workouts keep their description", () => {
  const event = fixtureEvent("Run");
  const workout = {
    sport: "Run",
    title: "Run",
    status: "upcoming",
    workout_date: "2026-10-10",
    structure: JSON.stringify(event.workout_doc),
  };
  assert.equal(appWorkoutDescription(workout), eventWorkoutDescription(event));
  assert.equal(appWorkoutDescription({ ...workout, status: "completed" }), null);
  assert.equal(appWorkoutDescription({ ...workout, structure: "bad json" }), null);
  assert.equal(
    eventWorkoutDescription({
      ...event,
      workout_doc: { steps: [{ duration: 60, distance: 500, custom: "unsupported" }] },
    }),
    null
  );
});

test("app projection retains generated stroke and zone text after raw data and sport settings are removed", () => {
  const model = swim([swimStep(200, 2, "Back", "warmup"), swimStep(100, 3, "Pull")]);
  const workout = {
    ...mapIntervalsWorkout(fixtureEvent("Swim"), "2026-09-17"),
    editor_model: model,
    raw: undefined,
    app_description_version: undefined,
  };
  const context = {
    athlete: { time_zone: "America/Chicago", sport_settings: [] },
    history: [],
    planned: [workout],
  };
  const projected = projectTrainingContext(context, "full", new Date("2026-09-17T12:00:00Z"));
  assert.match(projected.planned[0].details, /200 yd Back in Z2/);
  assert.match(projected.planned[0].details, /100 yd Pull in Z3/);
  assert.equal(appWorkoutDescription(projected.planned[0]), projected.planned[0].details);
  assert.deepEqual(projected.planned[0].editor_model, model);
  assert.equal(projected.athlete.sport_settings, undefined);
  assert.equal(projected.planned[0].raw, undefined);
});

test("threshold run paces become prescribed pace without changing target values", () => {
  const model = importWorkout(fixtureEvent("Run")).model;
  model.steps = [model.steps[0]];
  model.steps[0].target = { kind: "pace", unit: "%pace", mode: "single", value: 80 };
  const original = structuredClone(model);
  const settings = [{ types: ["Run"], threshold_pace: 1609.344 / 450 }];
  assert.equal(formatWorkoutDescription(model, settings), "Warm Up:\n5 mins at 9:23 min/mile");
  assert.deepEqual(model, original);
});
