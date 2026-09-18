import { test } from "node:test";
import assert from "node:assert/strict";
import {
  fixtureEvent,
  fakeProvider,
  parseTestWorkout,
} from "./fixtures/workout-editor-fixtures.mjs";
import { loadWorkoutEditor, saveWorkoutEditor, workoutRevision } from "./workout-editor.mjs";
import {
  chartSegments,
  clone,
  convertTarget,
  copyNodes,
  expandSteps,
  importWorkout,
  makeTemplate,
  moveNode,
  newRepeat,
  newStep,
  serializeWorkout,
  validateWorkout,
  verifyParsedWorkout,
  workoutTotals,
} from "./workout-editor-model.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";

for (const sport of ["Ride", "Run", "Swim"])
  test(`${sport}: load → edit → save → reload preserves prescription and event identity`, async () => {
    const original = fixtureEvent(sport),
      provider = fakeProvider(original),
      loaded = await loadWorkoutEditor(provider.request, "event:100");
    assert.deepEqual(loaded.issues, []);
    const model = loaded.model;
    model.steps[1].repetitions = 5;
    model.notes = "Keep these custom coaching notes.";
    model.steps[0].notes = sport === "Swim" ? "Freestyle drill with fins" : "Relax shoulders";
    const result = await saveWorkoutEditor(provider.request, "event:100", {
      model,
      revision: loaded.revision,
      reviewed: true,
    });
    assert.equal(result.verified, true);
    const puts = provider.calls.filter((c) => c.method);
    assert.equal(puts.length, 1);
    assert.equal(puts[0].method, "PUT");
    assert.deepEqual(Object.keys(JSON.parse(puts[0].body)).sort(), ["description", "name", "type"]);
    for (const key of [
      "id",
      "uid",
      "calendar_id",
      "external_id",
      "paired_activity_id",
      "start_date_local",
      "end_date_local",
      "color",
      "custom_metadata",
    ])
      assert.deepEqual(result.event[key], original[key]);
    const reloaded = await loadWorkoutEditor(provider.request, "event:100");
    assert.deepEqual(reloaded.issues, []);
    assert.deepEqual(reloaded.model.steps, model.steps);
    assert.equal(reloaded.model.notes, model.notes);
    assert.equal(reloaded.model.name, original.name);
    const mapped = mapIntervalsWorkout(result.event, "2026-09-16");
    assert.doesNotMatch(mapped.details, /Keep these custom/);
    assert.match(mapped.raw.description, /Keep these custom/);
    assert.match(mapped.details, /Warm Up:\n[\s\S]*Main Set:\n[\s\S]*Warm Down:\n/);
    assert.doesNotMatch(mapped.details, /Workout editor v1|```|device definition/);
  });

test("nested sets, last recovery omission and ungroup arithmetic", () => {
  const work = newStep("Ride");
  work.end.value = 120;
  const recovery = newStep("Ride", "recovery");
  recovery.end.value = 30;
  const between = newStep("Ride", "rest");
  between.end.value = 90;
  const group = {
    ...newRepeat([work]),
    repetitions: 3,
    sets: 2,
    recovery,
    finalRecovery: false,
    setRecovery: between,
  };
  const model = { ...importWorkout(fixtureEvent()).model, steps: [group] };
  const totals = workoutTotals(model);
  assert.equal(totals.seconds, 6 * 120 + 4 * 30 + 90);
  assert.equal(totals.recovery, 120);
  assert.equal(totals.rest, 90);
  assert.equal(totals.work, 720);
  const expanded = expandSteps([group]).map((v) => v.step);
  assert.equal(expanded.length, 11);
  assert.equal(workoutTotals({ ...model, steps: copyNodes(expanded) }).seconds, totals.seconds);
  assert.deepEqual(
    verifyParsedWorkout(model, { workout_doc: parseTestWorkout(serializeWorkout(model)) }),
    []
  );
});
test("last recovery inclusion adds exactly one recovery per set", () => {
  const model = importWorkout(fixtureEvent()).model,
    g = newRepeat([newStep("Ride")]);
  g.recovery = newStep("Ride", "rest");
  g.recovery.end.value = 25;
  g.repetitions = 4;
  g.sets = 3;
  g.finalRecovery = false;
  model.steps = [g];
  const before = workoutTotals(model);
  g.finalRecovery = true;
  assert.equal(workoutTotals(model).seconds - before.seconds, 75);
});
test("role changes do not alter the target", () => {
  const model = importWorkout(fixtureEvent()).model,
    step = model.steps[0],
    target = clone(step.target);
  step.role = "recovery";
  assert.deepEqual(step.target, target);
  assert.match(serializeWorkout(model), /ramp 100-180w intensity=recovery/);
});
test("pace and power display conversions are reversible", () => {
  const t = { kind: "pace", unit: "secs/mi", mode: "range", start: 450, end: 480 },
    km = convertTarget(t, "secs/km");
  assert.ok(Math.abs(km.start - 450 / 1.609344) < 1e-8);
  const back = convertTarget(km, "secs/mi");
  assert.ok(Math.abs(back.start - t.start) < 1e-8 && Math.abs(back.end - t.end) < 1e-8);
  const watts = { kind: "power", unit: "w", mode: "ramp", start: 100, end: 200 };
  assert.deepEqual(convertTarget(convertTarget(watts, "%ftp", 250), "w", 250), watts);
  assert.throws(() => convertTarget(watts, "%ftp"), /new prescription/);
});
test("faster pace is a taller chart bar; rest remains present", () => {
  const model = importWorkout(fixtureEvent("Run")).model;
  const c = chartSegments(model);
  assert.ok(c.segments[1].start > c.segments[0].start);
  const rest = newStep("Run", "rest");
  rest.end.value = 1;
  model.steps.push(rest);
  assert.equal(chartSegments(model).segments.at(-1).width, 1);
});
test("open steps and unknown distance durations never yield exact totals", () => {
  const model = importWorkout(fixtureEvent("Swim")).model;
  assert.equal(workoutTotals(model).unknownTime, true);
  assert.equal(chartSegments(model).placeholder, true);
  const lap = newStep("Ride");
  lap.end.kind = "lap";
  model.steps = [lap];
  const t = workoutTotals(model);
  assert.equal(t.open, true);
  assert.equal(t.load, null);
  assert.match(serializeWorkout(model), /Press lap/);
});
test("distance-only axis uses proportional metres; mixed chart labels estimates", () => {
  const model = importWorkout(fixtureEvent("Swim")).model;
  model.steps = model.steps.filter((n) => n.kind === "step");
  const c = chartSegments(model);
  assert.equal(c.axis, "Distance (metres)");
  assert.equal(c.segments[0].width / c.segments[1].width, 2);
  model.steps.push(newStep("Swim", "rest"));
  assert.match(chartSegments(model).axis, /Estimated time/);
});
test("ramp load estimate integrates squared power", () => {
  const model = importWorkout(fixtureEvent()).model;
  model.steps = [
    {
      ...newStep("Ride"),
      end: { kind: "time", value: 3600, unit: "s" },
      target: { kind: "power", unit: "%ftp", mode: "ramp", start: 50, end: 100 },
    },
  ];
  assert.ok(Math.abs(workoutTotals(model).load - (100 * (0.25 + 0.5 + 1)) / 3) < 1e-8);
});
test("reordering guards against cycles and preserves order within parents", () => {
  const nodes = [newStep("Ride"), newRepeat([newStep("Ride")]), newStep("Ride")];
  assert.deepEqual(moveNode(nodes, nodes[1].id, nodes[1].id, 0), nodes);
  const result = moveNode(nodes, nodes[0].id, null, 3);
  assert.equal(result.at(-1).id, nodes[0].id);
  assert.equal(nodes[0].kind, "step");
});
test("saved blocks and inserted copies never share references or identifiers", () => {
  const block = makeTemplate("Work + Recovery Repeats", "Ride"),
    one = copyNodes(block),
    two = copyNodes(block);
  one[0].steps[0].end.value = 7;
  assert.notEqual(block[0].steps[0].end.value, 7);
  assert.notEqual(two[0].steps[0].end.value, 7);
  assert.notEqual(one[0].recovery.id, two[0].recovery.id);
});
test("stale revisions reject writes, including changes to metadata", async () => {
  const p = fakeProvider(fixtureEvent()),
    l = await loadWorkoutEditor(p.request, "event:100");
  p.setEvent({ ...p.event(), custom_metadata: { keep: true, remoteNote: "New metadata" } });
  l.model.name = "Local edit";
  await assert.rejects(
    saveWorkoutEditor(p.request, "event:100", {
      model: l.model,
      revision: l.revision,
      reviewed: true,
    }),
    (e) => e.status === 409
  );
  assert.equal(p.calls.filter((c) => c.method).length, 0);
});
test("permission failures retain a retryable request without creating an event", async () => {
  const p = fakeProvider(fixtureEvent(), { deny: true }),
    l = await loadWorkoutEditor(p.request, "event:100");
  l.model.name = "New title";
  await assert.rejects(
    saveWorkoutEditor(p.request, "event:100", {
      model: l.model,
      revision: l.revision,
      reviewed: true,
    }),
    (e) => e.code === "PERMISSION_DENIED"
  );
  assert.ok(p.calls.every((c) => !c.method || c.method === "PUT"));
  assert.equal(p.event().name, "Ride custom title");
});
test("offline failure cannot return false success", async () => {
  const p = fakeProvider(fixtureEvent(), { fail: true }),
    l = await loadWorkoutEditor(p.request, "event:100");
  l.model.name = "New title";
  await assert.rejects(
    saveWorkoutEditor(p.request, "event:100", {
      model: l.model,
      revision: l.revision,
      reviewed: true,
    }),
    (e) => e.code === "SAVE_UNCONFIRMED"
  );
});
test("uncertain writes are read back, and retry does not write twice", async () => {
  const p = fakeProvider(fixtureEvent(), { uncertain: true }),
    l = await loadWorkoutEditor(p.request, "event:100");
  l.model.name = "Changed";
  const input = { model: l.model, revision: l.revision, reviewed: true };
  assert.equal((await saveWorkoutEditor(p.request, "event:100", input)).verified, true);
  assert.equal((await saveWorkoutEditor(p.request, "event:100", input)).verified, true);
  assert.equal(p.calls.filter((c) => c.method).length, 1);
});
test("title-only success cannot hide a wrong parsed target, count or totals", async () => {
  for (const corrupt of [
    (e) => {
      e.workout_doc.steps[0].power.start = 999;
    },
    (e) => {
      e.workout_doc.steps[1].reps = 2;
    },
    (e) => {
      e.workout_doc.duration += 100;
    },
  ]) {
    const p = fakeProvider(fixtureEvent(), { corrupt }),
      l = await loadWorkoutEditor(p.request, "event:100");
    l.model.name = "Changed";
    await assert.rejects(
      saveWorkoutEditor(p.request, "event:100", {
        model: l.model,
        revision: l.revision,
        reviewed: true,
      }),
      (e) => e.code === "VERIFICATION_FAILED"
    );
  }
});
test("date edits preserve time and event span while patching only changed writable fields", async () => {
  const p = fakeProvider(fixtureEvent()),
    l = await loadWorkoutEditor(p.request, "event:100");
  l.model.date = "2026-10-12";
  const r = await saveWorkoutEditor(p.request, "event:100", {
    model: l.model,
    revision: l.revision,
    reviewed: true,
  });
  assert.equal(r.event.start_date_local, "2026-10-12T06:30:00");
  assert.equal(r.event.end_date_local, "2026-10-12T08:00:00");
});
test("activity IDs and read-only event calendars cannot be edited", async () => {
  const p = fakeProvider(fixtureEvent());
  await assert.rejects(loadWorkoutEditor(p.request, "activity:100"), /completed activities/);
  p.setEvent({ ...p.event(), read_only: true });
  await assert.rejects(loadWorkoutEditor(p.request, "event:100"), (e) => e.status === 403);
});
test("unsupported fields and mismatched editor data fail closed", () => {
  const e = fixtureEvent();
  e.workout_doc.steps[0].custom_target = { value: 3 };
  assert.match(importWorkout(e).issues.join(" "), /custom_target/);
  const model = importWorkout(fixtureEvent()).model;
  const text = serializeWorkout(model);
  const changed = {
    ...fixtureEvent(),
    description: text.replace("100-180w", "101-180w"),
    workout_doc: parseTestWorkout(text),
  };
  assert.match(importWorkout(changed).issues.join(" "), /changed outside/);
});
test("import restores drill words and treats swim metre tokens as exact yard amounts", () => {
  const e = fixtureEvent("Swim");
  e.description =
    "Warm Up:\nOld intervals.\n\nCoach: retain me.\n\nIntervals.icu device definition:\nPool length: 25y\n\n- 100mtr 1:40 Pace free with fins";
  e.workout_doc = {
    options: { pool_length: "25y" },
    steps: [{ distance: 100, duration: 110, pace: { units: "secs", value: 100 } }],
  };
  const r = importWorkout(e);
  assert.equal(r.ambiguousSwim, false);
  assert.equal(r.model.steps[0].end.value, 100);
  assert.equal(r.model.steps[0].end.unit, "yd");
  assert.equal(r.model.steps[0].notes, "free with fins");
  assert.equal(r.model.notes, "Coach: retain me.");
});
test("save generates updated instructions without an import acknowledgement", async () => {
  const p = fakeProvider(fixtureEvent()),
    l = await loadWorkoutEditor(p.request, "event:100");
  assert.equal(l.reviewRequired, false);
  l.model.steps[0].end.value = 420;
  l.model.name = "Changed";
  const saved = await saveWorkoutEditor(p.request, "event:100", {
    model: l.model,
    revision: l.revision,
  });
  assert.equal(saved.verified, true);
  assert.match(saved.event.description, /420s ramp/);
  assert.doesNotMatch(saved.event.description, /600s ramp/);
  assert.equal(p.calls.filter((c) => c.method).length, 1);
});

test("pool defaults retain distance with lap ending and timed rest through save and reload", async () => {
  const event = fixtureEvent("Swim");
  delete event.workout_doc.options.pool_length;
  const p = fakeProvider(event),
    l = await loadWorkoutEditor(p.request, "event:100");
  assert.equal(l.model.poolLength, "25y");
  assert.equal(newStep("Swim").end.pressLap, true);
  assert.equal(newStep("Swim", "rest").end.kind, "time");
  assert.equal(newStep("Ride").target.kind, "power");
  assert.equal(newStep("Run").target.kind, "pace");
  assert.equal(newStep("Swim").target.kind, "pace");
  const work = l.model.steps[1].steps[0],
    rest = l.model.steps[1].recovery;
  assert.equal(work.end.pressLap, true);
  assert.equal(rest.end.kind, "time");
  assert.equal(Boolean(rest.end.pressLap), false);
  work.end.value = 125;
  const saved = await saveWorkoutEditor(p.request, "event:100", {
    model: l.model,
    revision: l.revision,
  });
  assert.match(saved.event.description, /Press lap 125mtr Z3 Pace/);
  assert.deepEqual(verifyParsedWorkout(l.model, saved.event), []);
  const reloaded = await loadWorkoutEditor(p.request, "event:100");
  assert.equal(reloaded.model.steps[1].steps[0].end.value, 125);
  assert.equal(reloaded.model.steps[1].steps[0].end.pressLap, true);
  assert.deepEqual(reloaded.issues, []);
  const corrupted = structuredClone(saved.event);
  delete corrupted.workout_doc.steps[1].press_lap;
  assert.match(verifyParsedWorkout(l.model, corrupted).join(" "), /lap ending/);
});
test("validation rejects empty date, invalid numbers and repeat expansion bombs", () => {
  const model = importWorkout(fixtureEvent()).model;
  assert.match(validateWorkout({ ...model, date: "" }).join(" "), /valid date/);
  model.steps[1].repetitions = 100;
  model.steps[1].sets = 100;
  assert.match(validateWorkout(model).join(" "), /limited/);
});
test("revision is deterministic independent of object key order", () => {
  const e = fixtureEvent();
  assert.equal(
    workoutRevision(e),
    workoutRevision(Object.fromEntries(Object.entries(e).reverse()))
  );
});

test("saved open and unknown-duration workouts keep uncertainty in calendar previews", async () => {
  for (const sport of ["Ride", "Swim"]) {
    const provider = fakeProvider(fixtureEvent(sport));
    const loaded = await loadWorkoutEditor(provider.request, "event:100");
    if (sport === "Ride") loaded.model.steps[0].end.kind = "lap";
    loaded.model.name = "Uncertain duration";
    const saved = await saveWorkoutEditor(provider.request, "event:100", {
      model: loaded.model,
      revision: loaded.revision,
      reviewed: true,
    });
    const mapped = mapIntervalsWorkout(saved.event, "2026-09-16");
    assert.match(mapped.planned_time_label, sport === "Ride" ? /Open/ : /At least/);
    assert.deepEqual(mapped.editor_model.steps, loaded.model.steps);
  }
});
test("unrelated metadata changes in the response cannot be reported as success", async () => {
  const provider = fakeProvider(fixtureEvent(), {
    corrupt: (event) => {
      event.custom_metadata.keep = false;
    },
  });
  const loaded = await loadWorkoutEditor(provider.request, "event:100");
  loaded.model.name = "Edit title";
  await assert.rejects(
    saveWorkoutEditor(provider.request, "event:100", {
      model: loaded.model,
      revision: loaded.revision,
      reviewed: true,
    }),
    (error) => error.code === "VERIFICATION_FAILED"
  );
});
test("malformed drafts and unsupported cadence or localized instructions fail closed", () => {
  const model = importWorkout(fixtureEvent()).model;
  assert.ok(validateWorkout({ ...model, name: 42 }).length);
  assert.ok(validateWorkout({ ...model, steps: [null] }).length);
  const event = fixtureEvent();
  event.workout_doc.steps[0].cadence = { units: "spm", value: 50 };
  assert.match(importWorkout(event).issues.join(" "), /Cadence units/);
  event.workout_doc.locales = ["fr"];
  assert.match(importWorkout(event).issues.join(" "), /Localized/);
});
