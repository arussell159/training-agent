import test from "node:test";
import assert from "node:assert/strict";
import {
  readManualWorkoutDescription,
  serializeManualWorkout,
} from "./workout-manual-description.mjs";
import {
  createWorkoutEditor,
  loadNewWorkoutEditor,
  loadWorkoutEditor,
  saveWorkoutEditor,
} from "./workout-editor.mjs";
import {
  importWorkout,
  newStep,
  serializeWorkout,
  verifyParsedWorkout,
} from "./workout-editor-model.mjs";
import { updateWorkoutDescription } from "./workout-description.mjs";
import {
  fakeProvider,
  fixtureEvent,
  parseTestWorkout,
} from "./fixtures/workout-editor-fixtures.mjs";
import { readPlannedValues, withPlannedValues } from "./planned-workout-values.mjs";
import { readWorkoutCommentText } from "./workout-comment-text.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";
import { pendingMutationContext, validateMutation } from "./mutation-queue.mjs";

const creationId = "172ce7bc-18be-4b1c-8e9f-8d13305490a2";
const commentId = "d7704c47-a625-409d-9f45-fb5c54ca9b9b";

test("desktop manual descriptions read provider prose and exclude native instructions without mutating it", () => {
  const event = fixtureEvent("Run");
  event.description = event.description.replace(
    "Coach: smooth and controlled.",
    "Coach: smooth and controlled.\n- Keep shoulders relaxed."
  );
  const before = structuredClone(event);
  assert.equal(
    readManualWorkoutDescription(event),
    "Coach: smooth and controlled.\n- Keep shoulders relaxed."
  );
  assert.deepEqual(event, before);
  const mapped = mapIntervalsWorkout(event, "2026-10-10");
  assert.equal(mapped.manual_description, readManualWorkoutDescription(event));
  assert.match(mapped.details, /Warm Up:/, "mobile's structured read projection remains unchanged");
  assert.equal(
    readManualWorkoutDescription({ description: "Plain activity notes" }),
    "Plain activity notes"
  );
  assert.equal(
    mapIntervalsWorkout(
      { ...event, id: "i123", description: "Actual ride notes" },
      "2026-10-10",
      null,
      true
    ).manual_description,
    "Actual ride notes"
  );
});

test("legacy generated outline becomes blank or coaching notes while intentionally identical manual prose survives", () => {
  const event = fixtureEvent();
  const model = importWorkout(event).model;
  model.notes = "";
  event.description = serializeWorkout(model);
  event.workout_doc = parseTestWorkout(event.description);
  assert.equal(readManualWorkoutDescription(event), "");
  model.notes = "Do this after breakfast.";
  event.description = serializeWorkout(model);
  assert.equal(readManualWorkoutDescription(event), "Do this after breakfast.");
  assert.equal(readManualWorkoutDescription({ description: "" }, model), "");
  assert.equal(
    readManualWorkoutDescription(
      { description: "Do this after breakfast.", workout_doc: event.workout_doc },
      model
    ),
    "Do this after breakfast."
  );
  const cached = {
    description: serializeWorkout(model)
      .split("\n\nIntervals.icu device definition:\n")[0]
      .slice(4, -4),
    workout_doc: event.workout_doc,
  };
  assert.equal(readManualWorkoutDescription(cached, model), "Do this after breakfast.");
  const intentionallyTyped = "Warm Up:\nKeep the beginning controlled.";
  event.description = serializeManualWorkout(model, intentionallyTyped);
  assert.equal(readManualWorkoutDescription(event), intentionallyTyped);
});

test("manual creation has blank description by default and honors typed prose or an explicit empty string", async () => {
  for (const description of [undefined, "Easy run. Stop if pain returns.", ""]) {
    const provider = fakeProvider(fixtureEvent());
    const loaded = await loadNewWorkoutEditor(provider.request, "2026-10-21", { sport: "Run" });
    assert.equal(loaded.manualDescription, "");
    loaded.model.steps = [newStep("Run")];
    const saved = await createWorkoutEditor(provider.request, {
      model: loaded.model,
      creationId,
      descriptionMode: "manual",
      description,
      values: { duration_seconds: 600 },
      comment: "Meet at the track.",
    });
    assert.equal(saved.verified, true);
    assert.equal(readManualWorkoutDescription(saved.event), description ?? "");
    assert.equal(
      (await loadWorkoutEditor(provider.request, saved.workoutId)).manualDescription,
      description ?? ""
    );
    assert.deepEqual(verifyParsedWorkout(loaded.model, saved.event), []);
    assert.equal(readPlannedValues(saved.event.description).duration_seconds, 600);
    assert.equal(
      readWorkoutCommentText(saved.event.description, saved.workoutId)[0].body,
      "Meet at the track."
    );
    const retry = await createWorkoutEditor(provider.request, {
      model: loaded.model,
      creationId,
      descriptionMode: "manual",
      description,
      values: { duration_seconds: 600 },
      comment: "Meet at the track.",
    });
    assert.equal(retry.workoutId, saved.workoutId);
    assert.equal(provider.calls.filter((call) => call.method === "POST").length, 1);
  }
});

for (const sport of ["Ride", "Run", "Swim"])
  test(`${sport}: structured and planned edits retain manual/provider prose and confirmed native steps`, async () => {
    const provider = fakeProvider(fixtureEvent(sport), { uncertain: true });
    const loaded = await loadWorkoutEditor(provider.request, "event:100");
    assert.equal(loaded.manualDescription, "Coach: smooth and controlled.");
    loaded.model.steps[0].end.value += 30;
    const input = {
      model: loaded.model,
      revision: loaded.revision,
      descriptionMode: "manual",
      values: { calories: 400, tss: 42 },
      comment: "Stay controlled.",
      commentId,
    };
    const saved = await saveWorkoutEditor(provider.request, "event:100", input);
    assert.equal(saved.verified, true);
    assert.equal(readManualWorkoutDescription(saved.event), "Coach: smooth and controlled.");
    assert.deepEqual(verifyParsedWorkout(loaded.model, saved.event), []);
    assert.equal(readPlannedValues(saved.event.description).calories, 400);
    assert.equal(
      readWorkoutCommentText(saved.event.description, "event:100")[0].body,
      "Stay controlled."
    );
    for (const field of [
      "uid",
      "external_id",
      "calendar_id",
      "paired_activity_id",
      "custom_metadata",
    ])
      assert.deepEqual(saved.event[field], fixtureEvent(sport)[field]);
    await saveWorkoutEditor(provider.request, "event:100", input);
    assert.equal(provider.calls.filter((call) => call.method === "PUT").length, 1);
    const fresh = await loadWorkoutEditor(provider.request, "event:100");
    const cleared = await saveWorkoutEditor(provider.request, "event:100", {
      model: fresh.model,
      revision: fresh.revision,
      descriptionMode: "manual",
      description: "",
    });
    assert.equal(readManualWorkoutDescription(cleared.event), "");
    const clearFresh = await loadWorkoutEditor(provider.request, "event:100");
    clearFresh.model.name = "Renamed on a later edit";
    const later = await saveWorkoutEditor(provider.request, "event:100", {
      model: clearFresh.model,
      revision: clearFresh.revision,
    });
    assert.equal(
      readManualWorkoutDescription(later.event),
      "",
      "a later legacy client does not regenerate cleared prose"
    );
  });

test("manual description can contain native-looking code without adding executable workout steps", async () => {
  const provider = fakeProvider(fixtureEvent("Ride"));
  const loaded = await loadWorkoutEditor(provider.request, "event:100");
  const description =
    "Keep this sample as instructions only:\n```\n- 30s 900w\n```\n\nIntervals.icu device definition:\n- 5s 800w";
  const saved = await saveWorkoutEditor(provider.request, "event:100", {
    model: loaded.model,
    revision: loaded.revision,
    descriptionMode: "manual",
    description,
  });
  assert.equal(readManualWorkoutDescription(saved.event), description);
  assert.deepEqual(verifyParsedWorkout(loaded.model, saved.event), []);
  assert.deepEqual(saved.event.workout_doc.steps, provider.event().workout_doc.steps);
  const remote = {
    ...saved.event,
    description: saved.event.description.replace("Keep this sample", "Changed remotely"),
  };
  assert.match(
    readManualWorkoutDescription(remote),
    /^Changed remotely/,
    "provider-visible edits win over stale inert metadata"
  );
});

test("desktop summary description updates retain provider execution, planned values and comments", async () => {
  const provider = fakeProvider(fixtureEvent("Run"));
  provider.setEvent({
    ...provider.event(),
    description: withPlannedValues(provider.event().description, { tss: 42 }),
  });
  const originalSteps = provider.event().workout_doc.steps;
  await updateWorkoutDescription(provider.request, "event:100", "- 30s 900w\nStay easy.", {
    descriptionMode: "manual",
  });
  assert.equal(readManualWorkoutDescription(provider.event()), "- 30s 900w\nStay easy.");
  assert.deepEqual(provider.event().workout_doc.steps, originalSteps);
  assert.equal(readPlannedValues(provider.event().description).tss, 42);
  await updateWorkoutDescription(provider.request, "event:100", "", { descriptionMode: "manual" });
  assert.equal(readManualWorkoutDescription(provider.event()), "");
  assert.deepEqual(provider.event().workout_doc.steps, originalSteps);
});

test("manual mode survives durable mutation validation, and pending blank prose never falls back to generated text", () => {
  const mutation = validateMutation({
    operationId: creationId,
    id: "event:100",
    type: "description",
    description: "",
    descriptionMode: "manual",
  });
  assert.equal(mutation.descriptionMode, "manual");
  const updated = pendingMutationContext(
    {
      history: [],
      planned: [
        {
          id: "event:100",
          workout_date: "2026-10-21",
          manual_description: "Old",
          details: "Generated",
        },
      ],
    },
    mutation,
    1
  );
  assert.equal(updated.planned[0].manual_description, "");
  assert.throws(
    () => validateMutation({ ...mutation, descriptionMode: "generated" }),
    /Invalid description mode/
  );
});

test("manual saves fail closed on remote prose conflicts and corrupted native readback", async () => {
  const provider = fakeProvider(fixtureEvent("Ride"));
  const loaded = await loadWorkoutEditor(provider.request, "event:100");
  provider.setEvent({
    ...provider.event(),
    description: "Coach changed this.\n\n" + provider.event().description,
  });
  await assert.rejects(
    saveWorkoutEditor(provider.request, "event:100", {
      model: loaded.model,
      revision: loaded.revision,
      descriptionMode: "manual",
      description: "Local draft",
    }),
    (error) => error.code === "CONFLICT"
  );
  assert.equal(provider.calls.filter((call) => call.method === "PUT").length, 0);
  const corrupted = fakeProvider(fixtureEvent("Ride"), {
    corrupt: (event) => {
      event.workout_doc.steps[0].duration = 1;
    },
  });
  const fresh = await loadWorkoutEditor(corrupted.request, "event:100");
  await assert.rejects(
    saveWorkoutEditor(corrupted.request, "event:100", {
      model: fresh.model,
      revision: fresh.revision,
      descriptionMode: "manual",
      description: "My own text",
    }),
    (error) => error.code === "VERIFICATION_FAILED"
  );
});
