import test from "node:test";
import assert from "node:assert/strict";
import { generateWorkoutDraft, generatedWorkoutModel } from "./workout-generator.mjs";
import {
  isWorkoutGeneratorResult,
  validateWorkoutGeneratorInput,
} from "./workout-generator-model.mjs";
import {
  validateWorkout,
  workoutTotals,
  expandSteps,
  serializeWorkout,
} from "./workout-editor-model.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { createDesktopPreviewFixtures } from "../../tools/desktop-preview-fixtures.mjs";
import { createDesktopCalendarPreview } from "../../tools/desktop-calendar-preview-fixtures.mjs";

const input = {
  date: "2026-10-22",
  sport: "Ride",
  intensity: "percentOfFtp",
  length: "duration",
  target: "range",
  prompt: "Five minute warmup, 3 x 2min work/1min recovery, five minute cooldown.",
};
const config = { openaiKey: "fixture-private-key", model: "existing-configured-model" };
const step = (role, amount, low, high) => ({
  role,
  amount,
  low,
  high,
  label: role,
  notes: "Stay controlled.",
  effort: "",
});
const output = () => ({
  name: "Editable intervals",
  instructions: "Warm up before the repeated efforts.",
  segments: [
    { repetitions: 1, steps: [step("warmup", 300, 50, 60)] },
    { repetitions: 3, steps: [step("active", 120, 90, 100), step("recovery", 60, 40, 50)] },
    { repetitions: 1, steps: [step("cooldown", 300, 40, 50)] },
  ],
});
const envelope = (value = output()) => ({
  status: "completed",
  output: [
    { type: "reasoning", summary: [{ text: "Never expose this hidden content." }] },
    {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: JSON.stringify(value) }],
    },
  ],
});
const transport = (value) => async () => Response.json(value);

test("generation uses configured Responses strict schema and returns an unsaved canonical 19-minute repeat workout", async () => {
  const calls = [];
  const result = await generateWorkoutDraft(config, input, {
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return Response.json(envelope());
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].options.headers.Authorization, "Bearer fixture-private-key");
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, config.model);
  assert.equal(body.store, false);
  assert.equal(body.text.format.strict, true);
  assert.equal(body.text.format.type, "json_schema");
  assert.equal(body.tools, undefined);
  assert.doesNotMatch(calls[0].options.body, /fixture-private-key|INTERVALS|SUPABASE/);
  assert.equal(result.generated, true);
  assert.equal(result.saved, false);
  assert.equal(result.workoutId, undefined);
  assert.equal(result.context, undefined);
  assert.deepEqual(validateWorkout(result.model), []);
  assert.equal(workoutTotals(result.model).seconds, 1140);
  assert.equal(result.model.steps[1].kind, "repeat");
  assert.equal(result.model.steps[1].repetitions, 3);
  assert.equal(expandSteps(result.model.steps).length, 8);
  assert.equal(new Set(expandSteps(result.model.steps).map(({ step }) => step.id)).size, 4);
  assert.equal(isWorkoutGeneratorResult(result, input), true);
  assert.equal(isWorkoutGeneratorResult(result, { ...input, date: "2026-10-23" }), false);
  const description = providerWorkoutDescription(serializeWorkout(result.model));
  assert.doesNotMatch(description, /Never expose|Workout editor v1|output_text|"segments"/);
});

test("selected intensity system, shape, distance and private variants remain server-owned", async () => {
  for (const [intensity, kind, unit] of [
    ["percentOfFtp", "power", "%ftp"],
    ["percentOfMaxHr", "hr", "%hr"],
    ["percentOfThresholdHr", "hr", "%lthr"],
    ["percentOfThresholdPace", "pace", "%pace"],
  ]) {
    const value = output();
    for (const segment of value.segments) for (const step of segment.steps) step.high = null;
    const request = {
      ...input,
      sport: "Other",
      variant: "custom",
      intensity,
      length: "distance",
      target: "target",
    };
    const result = await generateWorkoutDraft(config, request, {
      fetchImpl: transport(envelope(value)),
    });
    assert.equal(result.model.sport, "Other");
    assert.equal(result.model.variant, "custom");
    assert.equal(result.model.date, input.date);
    assert.deepEqual(result.model.steps[0].target, { kind, unit, mode: "single", value: 50 });
    assert.deepEqual(result.model.steps[0].end, { kind: "distance", unit: "m", value: 300 });
  }
  const swim = generatedWorkoutModel({ ...input, sport: "Swim", length: "distance" }, output());
  assert.ok(Math.abs(swim.model.steps[0].end.value * 0.9144 - 300) < 1e-8);
  assert.equal(swim.model.steps[0].end.unit, "yd");
});

test("invalid options and missing configuration never call generation transport", async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    throw Error("not called");
  };
  for (const change of [
    { prompt: "" },
    { prompt: "x".repeat(1001) },
    { date: "2026-02-30" },
    { sport: "Brick" },
    { variant: "brick" },
    { intensity: "watts" },
    { target: "ramp" },
    { length: "time" },
    { key: "secret" },
  ]) {
    assert.throws(() => validateWorkoutGeneratorInput({ ...input, ...change }));
    await assert.rejects(
      generateWorkoutDraft(config, { ...input, ...change }, { fetchImpl }),
      (e) => e.status === 400
    );
  }
  await assert.rejects(
    generateWorkoutDraft({}, input, { fetchImpl }),
    (e) => e.code === "GENERATOR_NOT_CONFIGURED"
  );
  assert.equal(calls, 0);
});

test("refusal, unfinished, malformed, empty, unexpected and excessive output fail safely without raw error leakage", async () => {
  for (const value of [
    { ...envelope(), status: "incomplete" },
    { status: "completed", output: [] },
    {
      status: "completed",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "refusal", refusal: "secret-provider-refusal" }],
        },
      ],
    },
    envelope({ ...output(), segments: [] }),
    envelope({ ...output(), sport: "Run" }),
    envelope({ ...output(), instructions: '```\n{"output":"secret-provider-data"}\n```' }),
    envelope({ ...output(), segments: Array(41).fill(output().segments[0]) }),
  ])
    await assert.rejects(
      generateWorkoutDraft(config, input, { fetchImpl: transport(value) }),
      (e) => e.code?.startsWith("GENERATOR_") && !/secret-provider/.test(e.message)
    );
  await assert.rejects(
    generateWorkoutDraft(config, input, {
      fetchImpl: async () => new Response("secret-provider-key", { status: 401 }),
    }),
    (e) => e.code === "GENERATOR_UNAVAILABLE" && !/secret-provider/.test(e.message)
  );
  await assert.rejects(
    generateWorkoutDraft(config, input, { fetchImpl: async () => new Response("not-json") }),
    (e) => e.code === "GENERATOR_INVALID_OUTPUT"
  );
  await assert.rejects(
    generateWorkoutDraft(config, input, {
      fetchImpl: async () => new Response("x".repeat(200001)),
    }),
    (e) => e.code === "GENERATOR_INVALID_OUTPUT"
  );
  for (const mutate of [
    (row) => {
      row.segments[0].steps[0].amount = 0;
    },
    (row) => {
      row.segments[0].steps[0].low = 110;
      row.segments[0].steps[0].high = 100;
    },
    (row) => {
      row.segments[1].repetitions = 101;
    },
    (row) => {
      row.segments[0].steps[0].notes = "x".repeat(501);
    },
  ]) {
    const value = output();
    mutate(value);
    assert.throws(
      () => generatedWorkoutModel(input, value),
      (e) => e.code === "GENERATOR_INVALID_OUTPUT"
    );
  }
});

test("deadline and cancellation release concurrency even if a mocked transport ignores abort", async () => {
  const never = () => new Promise(() => {}),
    controller = new AbortController();
  const cancelled = generateWorkoutDraft(config, input, {
    fetchImpl: never,
    signal: controller.signal,
  });
  controller.abort();
  await assert.rejects(cancelled, (e) => e.code === "GENERATOR_CANCELLED");
  await assert.rejects(
    generateWorkoutDraft(config, input, { fetchImpl: never, timeoutMs: 5 }),
    (e) => e.code === "GENERATOR_TIMEOUT"
  );
  const a = new AbortController(),
    b = new AbortController();
  const first = generateWorkoutDraft(config, input, { fetchImpl: never, signal: a.signal }),
    second = generateWorkoutDraft(config, input, { fetchImpl: never, signal: b.signal });
  await assert.rejects(
    generateWorkoutDraft(config, input, { fetchImpl: never }),
    (e) => e.code === "GENERATOR_BUSY"
  );
  a.abort();
  b.abort();
  await Promise.all([assert.rejects(first), assert.rejects(second)]);
  assert.equal(
    (await generateWorkoutDraft(config, input, { fetchImpl: transport(envelope()) })).saved,
    false
  );
});

test("synthetic preview exercises production generation model path and makes no calendar provider writes", async () => {
  const preview = createDesktopCalendarPreview(
    createDesktopPreviewFixtures(new Date("2026-10-20T12:00:00Z"))
  );
  const before = await preview.handle("preview/provider-records", "GET");
  assert.equal(preview.canWrite("workouts/generate", "POST"), true);
  const result = await preview.handle("workouts/generate", "POST", input);
  assert.equal(isWorkoutGeneratorResult(result, input), true);
  assert.equal(workoutTotals(result.model).seconds, 1140);
  assert.deepEqual(await preview.handle("preview/provider-records", "GET"), before);
});
