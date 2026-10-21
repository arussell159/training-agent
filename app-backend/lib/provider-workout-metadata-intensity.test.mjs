import test from "node:test";
import assert from "node:assert/strict";
import {
  createProviderWorkoutMetadata,
  providerWorkoutDescription,
} from "./provider-workout-metadata.mjs";
import { newStep, readEditorModel } from "./workout-editor-model.mjs";
import { serializeManualWorkout } from "./workout-manual-description.mjs";
import { readPlannedValues, withPlannedValues } from "./planned-workout-values.mjs";
import { parseTestWorkout } from "./fixtures/workout-editor-fixtures.mjs";

function fixture({ change = () => {}, factor = 0.75 } = {}) {
  const records = new Map();
  const record = (key, fresh) => ({
    read: async () => structuredClone(records.get(key) ?? fresh()),
    update: async (update) => {
      const value = structuredClone(records.get(key) ?? fresh());
      const result = update(value);
      records.set(key, value);
      return structuredClone(result);
    },
  });
  const step = newStep();
  step.end = { kind: "time", value: 600, unit: "s" };
  step.target = { kind: "power", unit: "%ftp", mode: "range", start: 70, end: 80 };
  const model = {
    version: 1,
    name: "Legacy lost reply",
    sport: "Ride",
    date: "2026-11-01",
    notes: "Steady.",
    poolLength: "",
    steps: [step],
  };
  const text = withPlannedValues(serializeManualWorkout(model, "Steady."), {
    duration_seconds: 600,
    tss: 9,
    intensity_factor: factor,
  });
  const body = {
    category: "WORKOUT",
    type: "Ride",
    name: model.name,
    start_date_local: "2026-11-01T00:00:00",
    description: text,
    external_id: "training-agent:editor:0814c6be-e890-45f5-9501-af7879185e69",
    time_target: 600,
    load_target: 9,
    icu_intensity: 75,
  };
  let current;
  const raw = async (_path, options = {}) => {
    if (options.method) {
      current = { ...JSON.parse(options.body), id: 100, icu_intensity: 73.484695 };
      current.workout_doc = parseTestWorkout(current.description);
      change(current);
      throw Error("Lost acknowledgement after native commit");
    }
    return structuredClone(current);
  };
  const wrap = () => createProviderWorkoutMetadata({ record }).wrap(raw);
  return { records, body, model, text, wrap, raw: () => current };
}

test("legacy lost create ACK reconciles provider-derived intensity with exact private IF and native prescription", async () => {
  const f = fixture();
  await assert.rejects(
    f.wrap()("/athlete/0/events", { method: "POST", body: JSON.stringify(f.body) }),
    /Lost acknowledgement/
  );
  assert.equal(Object.keys(f.records.get("index").pending).length, 1);
  const reopened = await f.wrap()("/athlete/0/events/100");
  assert.equal(reopened.description, f.text);
  assert.equal(readPlannedValues(reopened.description).intensity_factor, 0.75);
  assert.deepEqual(readEditorModel(reopened.description), f.model);
  assert.equal(reopened.icu_intensity, 73.484695);
  assert.equal(Object.keys(f.records.get("index").pending).length, 0);
  assert.equal(f.raw().description, providerWorkoutDescription(f.text));
  assert.doesNotMatch(f.raw().description, /Workout editor v1|"intensity_factor"/);
});

for (const [label, change] of [
  [
    "duration",
    (row) => {
      row.time_target = 601;
    },
  ],
  [
    "load",
    (row) => {
      row.load_target = 10;
    },
  ],
  [
    "title",
    (row) => {
      row.name = "External edit";
    },
  ],
  [
    "sport",
    (row) => {
      row.type = "Run";
    },
  ],
  [
    "date",
    (row) => {
      row.start_date_local = "2026-11-02T00:00:00";
    },
  ],
  [
    "identity",
    (row) => {
      row.external_id += "-other";
    },
  ],
  [
    "native prescription",
    (row) => {
      row.workout_doc.steps[0].duration = 601;
    },
  ],
])
  test(`legacy derived-intensity recovery still rejects changed ${label}`, async () => {
    const f = fixture({ change });
    await assert.rejects(
      f.wrap()("/athlete/0/events", { method: "POST", body: JSON.stringify(f.body) }),
      /Lost acknowledgement/
    );
    const reopened = await f.wrap()("/athlete/0/events/100");
    assert.deepEqual(readPlannedValues(reopened.description), {});
    assert.equal(Object.keys(f.records.get("index").pending).length, 1);
    assert.equal(Object.keys(f.records.get("index").entries).length, 0);
  });

test("legacy intensity recovery requires private IF to match the immutable original authored factor", async () => {
  const f = fixture({ factor: 0.74 });
  await assert.rejects(
    f.wrap()("/athlete/0/events", { method: "POST", body: JSON.stringify(f.body) }),
    /Lost acknowledgement/
  );
  assert.deepEqual(readPlannedValues((await f.wrap()("/athlete/0/events/100")).description), {});
  assert.equal(Object.keys(f.records.get("index").pending).length, 1);
});

test("derived-intensity compatibility never acknowledges an existing-record PUT", async () => {
  const f = fixture();
  await assert.rejects(
    f.wrap()("/athlete/0/events/100", { method: "PUT", body: JSON.stringify(f.body) }),
    /Lost acknowledgement/
  );
  assert.deepEqual(readPlannedValues((await f.wrap()("/athlete/0/events/100")).description), {});
  assert.equal(Object.keys(f.records.get("index").pending).length, 1);
});

for (const factor of [null, 0])
  test(`legacy lost create preserves exact private IF ${factor}`, async () => {
    const f = fixture({ factor });
    f.body.icu_intensity = factor == null ? null : 0;
    await assert.rejects(
      f.wrap()("/athlete/0/events", { method: "POST", body: JSON.stringify(f.body) }),
      /Lost acknowledgement/
    );
    const reopened = await f.wrap()("/athlete/0/events/100");
    assert.equal(readPlannedValues(reopened.description).intensity_factor, factor);
    assert.equal(Object.keys(f.records.get("index").pending).length, 0);
  });

test("legacy derived intensity cannot choose between two different private intents", async () => {
  const f = fixture();
  await assert.rejects(
    f.wrap()("/athlete/0/events", { method: "POST", body: JSON.stringify(f.body) }),
    /Lost acknowledgement/
  );
  const second = {
    ...f.body,
    description: withPlannedValues(f.text, {
      duration_seconds: 600,
      tss: 9,
      intensity_factor: 0.74,
    }),
    icu_intensity: 74,
  };
  await assert.rejects(
    f.wrap()("/athlete/0/events", { method: "POST", body: JSON.stringify(second) }),
    /Lost acknowledgement/
  );
  await assert.rejects(f.wrap()("/athlete/0/events/100"), /Multiple pending/);
  assert.equal(Object.keys(f.records.get("index").pending).length, 2);
  assert.equal(Object.keys(f.records.get("index").entries).length, 0);
});
