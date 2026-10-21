import test from "node:test";
import assert from "node:assert/strict";
import {
  newStep,
  newRepeat,
  validateWorkout,
  workoutTotals,
  chartSegments,
  targetLabel,
  serializeWorkout,
  importWorkout,
  verifyParsedWorkout,
  workoutProviderWarnings,
} from "./workout-editor-model.mjs";
import {
  fixtureEvent,
  fakeProvider,
  parseTestWorkout,
} from "./fixtures/workout-editor-fixtures.mjs";
import { createWorkoutEditor, loadWorkoutEditor, saveWorkoutEditor } from "./workout-editor.mjs";
import { createProviderWorkoutMetadata } from "./provider-workout-metadata.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { encodeWorkoutFit } from "./workout-fit-export.mjs";
import { encodeWorkoutTextFormat } from "./workout-text-exports.mjs";
import { exportWorkoutFile } from "./workout-files.mjs";
import { generateWorkoutDraft } from "./workout-generator.mjs";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";

const model = () => ({
  version: 1,
  name: "Effort prescription",
  sport: "Run",
  date: "2026-10-22",
  notes: "Use the prescribed effort.",
  poolLength: "",
  steps: [
    {
      ...newStep("Run"),
      end: { kind: "time", unit: "s", value: 600 },
      target: { kind: "rpe", unit: "rpe", mode: "range", start: 1, end: 8 },
    },
  ],
});
const creationId = "6fa84a86-08ba-439b-b920-07e225d5d18f";
function store() {
  const records = new Map();
  return (request) =>
    createProviderWorkoutMetadata({
      record: (key, fresh) => ({
        read: async () => structuredClone(records.get(key) ?? fresh()),
        update: async (change) => {
          const state = structuredClone(records.get(key) ?? fresh()),
            result = change(state);
          records.set(key, state);
          return structuredClone(result);
        },
      }),
    }).wrap(request);
}
test("typed RPE validates observed integer1–10 target/range without a physiological estimate", () => {
  const value = model();
  assert.deepEqual(validateWorkout(value), []);
  assert.equal(targetLabel(value.steps[0].target), "1–8 RPE");
  assert.equal(workoutTotals(value).seconds, 600);
  assert.equal(workoutTotals(value).load, null);
  assert.equal(workoutTotals(value).unknownDistance, true);
  assert.equal(chartSegments(value).segments[0].start, 0.1);
  for (const target of [
    { kind: "rpe", unit: "rpe", mode: "single", value: 0 },
    { kind: "rpe", unit: "rpe", mode: "single", value: 11 },
    { kind: "rpe", unit: "rpe", mode: "single", value: 6.5 },
    { kind: "rpe", unit: "rpe", mode: "range", start: 8, end: 1 },
    { kind: "rpe", unit: "rpe", mode: "ramp", start: 1, end: 8 },
    { kind: "rpe", unit: "%ftp", mode: "single", value: 7 },
  ]) {
    const invalid = model();
    invalid.steps[0].target = target;
    assert.notEqual(validateWorkout(invalid).length, 0);
  }
  assert.equal(workoutProviderWarnings(value).length, 1);
});
test("native RPE cue preserves numeric intent before duration without introducing a physiological target", () => {
  const value = model(),
    description = serializeWorkout(value),
    clean = providerWorkoutDescription(description),
    doc = parseTestWorkout(clean);
  assert.match(clean, /- RPE 1-8 600s/);
  assert.doesNotMatch(clean, /Workout editor v1|"version"/);
  assert.equal(doc.steps[0].text, "RPE 1-8");
  assert.equal(doc.steps[0].power, undefined);
  assert.equal(doc.steps[0].pace, undefined);
  assert.equal(doc.steps[0].hr, undefined);
  assert.deepEqual(verifyParsedWorkout(value, { workout_doc: doc }), []);
  assert.notEqual(
    verifyParsedWorkout(value, {
      workout_doc: { ...doc, steps: [{ ...doc.steps[0], text: "RPE 1-9" }] },
    }).length,
    0
  );
  assert.notEqual(
    verifyParsedWorkout(value, {
      workout_doc: { ...doc, steps: [{ ...doc.steps[0], power: { units: "%ftp", value: 75 } }] },
    }).length,
    0
  );
});

test("a provider that drops the RPE cue cannot confirm creation or cause duplicate retries", async () => {
  const p = fakeProvider(fixtureEvent("Run")),
    wrap = store();
  const raw = async (path, options = {}) => {
    const result = await p.request(path, options);
    if (!options.method && /\/events\/\d+$/.test(path))
      return {
        ...result,
        workout_doc: {
          ...result.workout_doc,
          steps: result.workout_doc.steps.map((step) => ({ ...step, text: "" })),
        },
      };
    return result;
  };
  const input = { model: model(), creationId };
  await assert.rejects(
    createWorkoutEditor(wrap(raw), input),
    (error) => error.code === "CREATE_UNCONFIRMED"
  );
  await assert.rejects(
    createWorkoutEditor(wrap(raw), { ...input, reconcileOnly: true }),
    (error) => error.code === "CREATE_UNCONFIRMED"
  );
  assert.equal(p.calls.filter((call) => call.method === "POST").length, 1);
});
test("RPE create/restart/edit retains exact target and warns about native provider limitation", async () => {
  const p = fakeProvider(fixtureEvent("Run")),
    wrap = store(),
    request = wrap(p.request),
    value = model();
  value.steps.push(
    newRepeat([
      { ...newStep("Run"), target: { kind: "rpe", unit: "rpe", mode: "single", value: 7 } },
    ])
  );
  const created = await createWorkoutEditor(request, { model: value, creationId });
  assert.equal(created.verified, true);
  assert.equal(created.warnings.length, 1);
  for (const call of p.calls.filter((call) => call.body))
    assert.doesNotMatch(JSON.parse(call.body).description, /Workout editor v1|"target"/);
  const loaded = await loadWorkoutEditor(wrap(p.request), created.workoutId);
  assert.deepEqual(loaded.model.steps[0].target, value.steps[0].target);
  assert.equal(loaded.warnings.length, 1);
  loaded.model.steps[0].target = { kind: "rpe", unit: "rpe", mode: "single", value: 10 };
  const edited = await saveWorkoutEditor(request, created.workoutId, {
    model: loaded.model,
    revision: loaded.revision,
  });
  assert.equal(edited.verified, true);
  assert.equal(edited.warnings.length, 1);
  assert.match(providerWorkoutDescription(edited.event.description), /- RPE 10 600s/);
});
test("native imported RPE cues retain explicit numeric target or reject conflicting/invalid cues", () => {
  const value = model(),
    description = providerWorkoutDescription(serializeWorkout(value)),
    event = {
      name: value.name,
      type: "Run",
      start_date_local: value.date + "T00:00:00",
      description,
      workout_doc: parseTestWorkout(description),
    };
  const imported = importWorkout(event);
  assert.deepEqual(imported.model.steps[0].target, value.steps[0].target);
  assert.deepEqual(imported.issues, []);
  const bad = {
    ...event,
    workout_doc: {
      ...event.workout_doc,
      steps: [{ ...event.workout_doc.steps[0], text: "RPE 11" }],
    },
  };
  assert.notEqual(importWorkout(bad).issues.length, 0);
  const conflict = {
    ...event,
    workout_doc: {
      ...event.workout_doc,
      steps: [{ ...event.workout_doc.steps[0], power: { units: "%ftp", value: 75 } }],
    },
  };
  assert.notEqual(importWorkout(conflict).issues.length, 0);
});
test("unsupported device formats reject numeric RPE while Text retains exact prescription without private JSON", async () => {
  const value = model();
  assert.throws(() => encodeWorkoutFit(value), /numeric RPE/);
  for (const format of ["zwo", "mrc", "erg"])
    assert.throws(
      () => encodeWorkoutTextFormat({ ...value, sport: "Ride" }, format),
      /numeric RPE/
    );
  const file = await exportWorkoutFile(
    { INTERVALS_API_KEY: "fixture-key" },
    { model: value, format: "txt" }
  );
  const text = Buffer.from(file.data, "base64").toString();
  assert.match(text, /RPE 1-8 600s/);
  assert.match(text, /Effort prescription/);
  assert.doesNotMatch(text, /Workout editor v1|"target"|"version"/);
});
test("RPE generation now yields numeric private targets and a real limitation warning without provider writes", async () => {
  const preview = createDesktopCalendarPreview(
      createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z"))
    ),
    input = {
      date: "2026-10-22",
      sport: "Run",
      intensity: "RPE",
      length: "duration",
      target: "range",
      prompt: "Warmup, three repeats, cooldown.",
    };
  const before = await preview.handle("preview/provider-records", "GET"),
    generated = await preview.handle("workouts/generate", "POST", input);
  assert.equal(generated.model.steps[0].target.kind, "rpe");
  assert.deepEqual(generated.model.steps[0].target, {
    kind: "rpe",
    unit: "rpe",
    mode: "range",
    start: 1,
    end: 3,
  });
  assert.equal(generated.warnings.length, 1);
  assert.equal(generated.saved, false);
  assert.equal(workoutTotals(generated.model).load, null);
  assert.deepEqual(await preview.handle("preview/provider-records", "GET"), before);
  const invalid = {
    name: "Invalid RPE",
    instructions: "",
    segments: [
      {
        repetitions: 1,
        steps: [
          {
            label: "Effort",
            notes: "",
            effort: "",
            role: "active",
            amount: 600,
            low: 6.5,
            high: 8,
          },
        ],
      },
    ],
  };
  await assert.rejects(
    generateWorkoutDraft({ openaiKey: "fixture", model: "fixture" }, input, {
      fetchImpl: async () =>
        Response.json({
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: JSON.stringify(invalid) }],
            },
          ],
        }),
    }),
    (error) => error.code === "GENERATOR_INVALID_OUTPUT"
  );
});
