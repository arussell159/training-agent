import test from "node:test";
import assert from "node:assert/strict";
import { validateRecording, uploadWorkoutRecording, exportWorkoutFile } from "./workout-files.mjs";
import { fixtureEvent } from "./fixtures/workout-editor-fixtures.mjs";
import { importWorkout, readEditorModel } from "./workout-editor-model.mjs";
import { readFitWorkoutSteps } from "./fit-workout-verification.mjs";

const config = { INTERVALS_API_KEY: "fixture-key" };
const file = {
  name: "Morning run.tcx",
  data: Buffer.from(
    '<?xml version="1.0"?><TrainingCenterDatabase></TrainingCenterDatabase>'
  ).toString("base64"),
};
test("recording validation rejects unsupported, malformed, empty, oversized and entity-bearing files", () => {
  for (const input of [
    { ...file, name: "x.html" },
    { ...file, name: "x.fit" },
    { ...file, data: "" },
    { ...file, data: "bad!" },
    { ...file, data: "A".repeat(3_000_000) },
    { ...file, data: Buffer.from("<!DOCTYPE a><TrainingCenterDatabase/>").toString("base64") },
  ])
    assert.throws(() => validateRecording(input));
  assert.equal(validateRecording(file).name, "Morning run.tcx");
});
test("upload sends multipart to a fixed provider URL, then verifies the recording and pairing", async () => {
  let uploads = 0;
  const fetchImpl = async (url, options) => {
    uploads++;
    assert.equal(new URL(url).origin, "https://intervals.icu");
    assert.equal(new URL(url).searchParams.get("paired_event_id"), "42");
    assert.ok(new URL(url).searchParams.get("external_id").startsWith("training-agent:"));
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get("file").name, file.name);
    assert.equal(options.headers["Content-Type"], undefined);
    return Response.json({ icu_athlete_id: "i99", activities: [{ id: "i88" }] });
  };
  const request = async (path) =>
    path.includes("/events/")
      ? { id: 42, category: "WORKOUT" }
      : {
          id: "i88",
          icu_athlete_id: "i99",
          start_date_local: "2026-10-20T08:00:00",
          paired_event_id: 42,
        };
  const result = await uploadWorkoutRecording(
    config,
    { ...file, workoutId: "event:42" },
    { fetchImpl, request }
  );
  assert.equal(result.verified, true);
  assert.deepEqual(result.activityIds, ["i88"]);
  assert.equal(uploads, 1);
});
test("retry of a confirmed same-file pairing does not send another upload", async () => {
  const digest = validateRecording(file).digest;
  const result = await uploadWorkoutRecording(
    config,
    { ...file, workoutId: "event:42" },
    {
      fetchImpl: () => {
        throw Error("No upload expected");
      },
      request: async (path) =>
        path.includes("/events/")
          ? { id: 42, category: "WORKOUT", paired_activity_id: "i88" }
          : { id: "i88", paired_event_id: 42, external_id: `training-agent:${digest}` },
    }
  );
  assert.equal(result.verified, true);
});
test("upload cannot replace another existing recording or claim an unverified pairing", async () => {
  await assert.rejects(
    uploadWorkoutRecording(
      config,
      { ...file, workoutId: "event:42" },
      {
        request: async (path) =>
          path.includes("/events/")
            ? { id: 42, category: "WORKOUT", paired_activity_id: "i88" }
            : { id: "i88" },
      }
    ),
    /already has a recording/
  );
  await assert.rejects(
    uploadWorkoutRecording(
      config,
      { ...file, workoutId: "event:42" },
      {
        fetchImpl: async () => Response.json({ activities: [{ id: "i88" }] }),
        request: async (path) =>
          path.includes("/events/")
            ? { id: 42, category: "WORKOUT" }
            : { id: "i88", start_date_local: "2026-10-20" },
      }
    ),
    /link could not be verified/
  );
});
test("draft export preserves structured prescription and generates a valid FIT without a conversion endpoint", async () => {
  const model = importWorkout(fixtureEvent("Run")).model;
  const text = await exportWorkoutFile(config, { model, format: "txt" });
  assert.deepEqual(readEditorModel(Buffer.from(text.data, "base64").toString()).steps, model.steps);
  const result = await exportWorkoutFile(
    config,
    { model, format: "fit" },
    {
      fetchImpl: async () => {
        throw Error("No provider conversion request should be needed");
      },
    }
  );
  assert.ok(result.name.endsWith(".fit"));
  assert.equal(readFitWorkoutSteps(Buffer.from(result.data, "base64")).length, 10);
});

test("saved event FIT export reads authoritative steps and remains usable when conversion endpoints fail", async () => {
  const calls = [];
  const event = { ...fixtureEvent("Run"), id: 42 };
  const result = await exportWorkoutFile(
    config,
    { workoutId: "event:42", format: "fit" },
    {
      fetchImpl: async (url) => {
        calls.push(url);
        return url.endsWith("/athlete/0/events/42")
          ? Response.json(event)
          : new Response("conversion unavailable", { status: 500 });
      },
    }
  );
  assert.equal(calls.length, 1);
  assert.equal(readFitWorkoutSteps(Buffer.from(result.data, "base64")).length, 10);
});

test("FIT percentage pace loads only the matching account threshold and never substitutes one on failure", async () => {
  const model = importWorkout(fixtureEvent("Run")).model;
  model.steps = [model.steps[0]];
  model.steps[0].target = { kind: "pace", unit: "%pace", mode: "single", value: 85 };
  const calls = [];
  const result = await exportWorkoutFile(
    config,
    { model, format: "fit" },
    {
      fetchImpl: async (url) => {
        calls.push(url);
        return Response.json({
          sportSettings: [
            { types: ["Ride"], threshold_pace: 9 },
            { types: ["Run"], threshold_pace: 3 },
          ],
        });
      },
    }
  );
  assert.equal(calls.length, 1);
  assert.ok(calls[0].endsWith("/athlete/0"));
  assert.equal(readFitWorkoutSteps(Buffer.from(result.data, "base64"))[0].targetLow, 2550);
  await assert.rejects(
    exportWorkoutFile(
      config,
      { model, format: "fit" },
      {
        fetchImpl: async () => new Response("unavailable", { status: 500 }),
      }
    ),
    /Set your threshold pace/
  );
});
test("export rejects arbitrary formats and empty workout models", async () => {
  const model = importWorkout(fixtureEvent()).model;
  await assert.rejects(
    exportWorkoutFile(config, { model, format: "../secrets" }),
    /supported workout format/
  );
  await assert.rejects(
    exportWorkoutFile(config, { model: { ...model, steps: [] }, format: "fit" }),
    /Add at least one step/
  );
});
