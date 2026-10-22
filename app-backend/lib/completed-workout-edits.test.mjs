import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDurableWorkoutCommits } from "./durable-workout-commits.mjs";
import {
  loadCompletedWorkoutEditor,
  saveCompletedWorkout,
  validateCompletedValues,
} from "./completed-workout-edits.mjs";
import {
  loadProviderWorkoutComments,
  saveProviderWorkoutComment,
} from "./provider-workout-comments.mjs";
import { workoutRevision } from "./workout-editor.mjs";
import { withWorkoutCommentText } from "./workout-comment-text.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { fixtureEvent, parseTestWorkout } from "./fixtures/workout-editor-fixtures.mjs";
import { importWorkout } from "./workout-editor-model.mjs";

function fixture() {
  let state = { version: 1, workouts: {}, operations: {} },
    time = Date.parse("2026-10-22T12:00:00Z");
  const counts = { reads: 0, writes: 0, bytes: 0 };
  const events = new Map([[100, fixtureEvent("Run")]]);
  const activities = new Map([
    [
      "i20",
      {
        id: "i20",
        type: "Run",
        name: "Recorded run",
        description: "Original",
        start_date_local: "2026-10-22T07:15:00",
        moving_time: 1800,
        distance: 5000,
        icu_training_load: 35,
        calories: 250,
        workout_doc: { steps: [{ duration: 300 }] },
        streams: [1, 2],
        laps: [{ elapsed_time: 900 }],
        file_type: "fit",
      },
    ],
  ]);
  const messages = new Map();
  const calls = [];
  let failure = null,
    lose = null,
    postVisible = true,
    nativeEventShape = false;
  const record = {
    read: async () => {
      counts.reads++;
      return structuredClone(state);
    },
    update: async (change) => {
      counts.writes++;
      const next = structuredClone(state),
        result = change(next);
      counts.bytes += Buffer.byteLength(JSON.stringify(next));
      state = next;
      return result;
    },
  };
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (options.method && failure) {
      const error = failure;
      failure = null;
      throw error;
    }
    const body = options.body ? JSON.parse(options.body) : {};
    const url = new URL(path, "https://mock.invalid");
    if (path === "/athlete/0") return { id: "synthetic-athlete", sportSettings: [] };
    if (url.pathname === "/athlete/0/activities")
      return [...activities.values()].map(({ id, paired_event_id, external_id }) => ({
        id,
        paired_event_id,
        external_id,
      }));
    if (url.pathname === "/athlete/0/events" && !options.method)
      return structuredClone([...events.values()]);
    if (path === "/athlete/0/events/bulk?upsert=true")
      return body.map((value) => {
        const existing = [...events.values()].find(
          (event) => event.external_id === value.external_id
        );
        const event = {
          ...existing,
          ...value,
          id: existing?.id || events.size + 101,
          workout_doc: parseTestWorkout(value.description),
        };
        events.set(event.id, event);
        return structuredClone(event);
      });
    if (path === "/athlete/0/activities/manual/bulk") {
      const result = body.map((value) => {
        const existing = [...activities.values()].find(
          (activity) => activity.external_id === value.external_id
        );
        const activity = {
          ...existing,
          ...value,
          id: existing?.id || `i${activities.size + 21}`,
          source: "MANUAL",
        };
        activities.set(activity.id, activity);
        events.set(activity.paired_event_id, {
          ...events.get(activity.paired_event_id),
          paired_activity_id: activity.id,
        });
        return structuredClone(activity);
      });
      if (lose === "completion") {
        lose = null;
        throw Error("Lost manual completion response");
      }
      return result;
    }
    const messageId = url.pathname.match(/^\/activity\/([^/]+)\/messages$/)?.[1];
    if (messageId) {
      const rows = messages.get(messageId) || [];
      if (options.method === "POST") {
        const message = {
          id: rows.length + 10,
          content: body.content,
          created: new Date(time).toISOString(),
          athlete_id: "synthetic-athlete",
        };
        if (postVisible) messages.set(messageId, [...rows, message]);
        if (lose === "comment") {
          lose = null;
          throw Error("Lost comment response");
        }
        return { id: message.id };
      }
      return structuredClone(rows);
    }
    const activityId = url.pathname.match(/^\/activity\/([^/]+)$/)?.[1];
    const source = activityId ? activities : events;
    const id = activityId || Number(url.pathname.split("/").at(-1));
    let current = source.get(id);
    if (!current) throw Object.assign(Error("Missing"), { status: 404 });
    if (options.method === "PUT") {
      // The real native PUT ignores moving_time. Duration changes must use
      // the documented manual-upsert contract, never a permissive mock PUT.
      const { moving_time: ignoredMovingTime, ...patch } = body;
      void ignoredMovingTime;
      current = { ...current, ...patch };
      source.set(id, current);
      if (lose === "edit") {
        lose = null;
        throw Error("Lost activity response");
      }
    }
    const result = structuredClone(current);
    if (!activityId && nativeEventShape) delete result.paired_activity_id;
    return result;
  };
  const service = () =>
    createDurableWorkoutCommits(
      {},
      {
        record,
        request,
        write: (_id, action) => action(request),
        clock: () => time,
        random: () => 0.5,
      }
    );
  return {
    service,
    request,
    events,
    activities,
    messages,
    calls,
    counts,
    state: () => structuredClone(state),
    tick: () => {
      time += 300000;
    },
    fail: (value) => {
      failure = value;
    },
    lose: (value) => {
      lose = value;
    },
    hidePost: () => {
      postVisible = false;
    },
    nativeEventShape: () => {
      nativeEventShape = true;
    },
  };
}

test("completed editor reads native metadata/messages and only patches authored fields, including local date/time", async () => {
  const f = fixture();
  f.messages.set("i20", [{ id: 1, content: "Native feedback", created: "2026-10-22T08:00:00Z" }]);
  const editor = await loadCompletedWorkoutEditor(f.request, "activity:i20");
  assert.equal(editor.scheduledTime, "07:15");
  assert.equal(editor.comments[0].body, "Native feedback");
  assert.equal(editor.completedValues.duration_seconds, 1800);
  const before = structuredClone(f.activities.get("i20"));
  const result = await saveCompletedWorkout(f.request, "activity:i20", {
    revision: editor.revision,
    model: { ...editor.model, name: "Updated run", date: "2026-11-01" },
    time: "01:30",
    description: "A complete description",
    completedValues: { calories: 270 },
  });
  assert.equal(result.verified, true);
  assert.equal(result.event.start_date_local, "2026-11-01T01:30:00");
  for (const field of ["workout_doc", "laps", "streams", "file_type"])
    assert.deepEqual(result.event[field], before[field]);
  const patch = JSON.parse(f.calls.find((call) => call.method === "PUT").body);
  assert.equal(patch.workout_doc, undefined);
  assert.equal(patch.laps, undefined);
});

test("completed edits reject stale metadata/unsupported derived values and read back a lost PUT once", async () => {
  const f = fixture(),
    before = f.activities.get("i20");
  await assert.rejects(
    saveCompletedWorkout(f.request, "activity:i20", { revision: "old", description: "Changed" }),
    { status: 409 }
  );
  assert.throws(() => validateCompletedValues({ normalized_power: 240 }), /cannot be edited/);
  assert.throws(() => validateCompletedValues({ duration_seconds: 1.5 }), /whole seconds/);
  f.lose("edit");
  const input = { revision: workoutRevision(before), description: "Confirmed despite lost reply" };
  assert.equal((await saveCompletedWorkout(f.request, "activity:i20", input)).verified, true);
  assert.equal((await saveCompletedWorkout(f.request, "activity:i20", input)).verified, true);
  assert.equal(f.calls.filter((call) => call.method === "PUT").length, 1);
});

test("durable completed edit retains acceptance without provider traffic and verifies after restart", async () => {
  const f = fixture(),
    editor = await loadCompletedWorkoutEditor(f.request, "activity:i20");
  const service = f.service(),
    command = {
      workoutId: "activity:i20",
      operationId: randomUUID(),
      action: "edit-activity",
      input: {
        model: editor.model,
        revision: editor.revision,
        description: "Durable description",
        completedValues: { calories: 300 },
      },
    };
  const count = f.calls.length;
  await service.accept(command);
  await service.accept(command);
  assert.equal(f.calls.length, count);
  await f.service().drain();
  const status = (await service.status()).workouts[0];
  assert.equal(status.verified, true);
  assert.equal(status.workout.status, "completed");
  assert.equal(status.workout.actualDurationMinutes, 30);
  const reopened = await service.editor("activity:i20");
  assert.equal(reopened.manualDescription, "Durable description");
  assert.equal(reopened.completedValues.calories, 300);
});

test("create with completed values and comment yields one plan, one paired activity and one native message", async () => {
  const f = fixture(),
    service = f.service(),
    id = `app:${randomUUID()}`;
  const model = { ...importWorkout(f.events.get(100)).model, name: "One completed session" };
  await service.accept({
    workoutId: id,
    operationId: randomUUID(),
    action: "create",
    input: {
      model,
      description: "Full session description",
      completedValues: { duration_seconds: 1900, distance_meters: 5500, tss: 40 },
      comment: "Session feedback",
      commentId: randomUUID(),
    },
  });
  await service.drain();
  const saved = (await service.status()).workouts[0];
  assert.equal(saved.verified, true);
  assert.equal(saved.workout.status, "completed");
  assert.equal(saved.workout.workout_summary.completed.duration_seconds, 1900);
  assert.equal(saved.completedActivity.description, "Full session description");
  assert.equal(f.messages.get(saved.completedActivity.id)[0].content, "Session feedback");
  assert.equal([...f.events.values()].filter((row) => row.name === model.name).length, 1);
  assert.equal([...f.activities.values()].filter((row) => row.name === model.name).length, 1);
  await service.drain();
  assert.equal(
    f.calls.filter((call) => call.path.endsWith("/messages") && call.method === "POST").length,
    1
  );
});

test("unknown manual completion recovers paired activity by stable identity without a duplicate", async () => {
  const f = fixture(),
    service = f.service(),
    event = f.events.get(100);
  await service.accept({
    workoutId: "event:100",
    operationId: randomUUID(),
    action: "complete",
    baseEvent: event,
    input: {
      revision: workoutRevision(event),
      model: importWorkout(event).model,
      completedValues: { duration_seconds: 1800 },
    },
  });
  f.lose("completion");
  await service.drain();
  assert.equal((await service.status()).workouts[0].verified, false);
  f.tick();
  await f.service().drain();
  assert.equal((await service.status()).workouts[0].verified, true);
  assert.equal(
    [...f.activities.values()].filter((activity) => activity.paired_event_id === 100).length,
    1
  );
});

test("native comment lost POST reply reconciles exactly once and preserves activity description/recordings", async () => {
  const f = fixture(),
    service = f.service(),
    operationId = randomUUID();
  const command = {
    workoutId: "activity:i20",
    operationId,
    action: "comment",
    input: { comment: "Native comment", commentId: operationId },
  };
  const before = structuredClone(f.activities.get("i20"));
  await service.accept(command);
  f.lose("comment");
  await service.drain();
  assert.equal((await service.status()).workouts[0].verified, true);
  await f.service().accept(command);
  await service.drain();
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
  assert.deepEqual(f.activities.get("i20"), before);
  assert.equal(
    (await loadProviderWorkoutComments(f.request, "activity:i20")).comments[0].body,
    "Native comment"
  );
});

test("unconfirmed native comment never posts again after restart, retries or repeated recovery", async () => {
  const f = fixture(),
    service = f.service(),
    id = randomUUID();
  await service.accept({
    workoutId: "activity:i20",
    operationId: id,
    action: "comment",
    input: { comment: "Uncertain", commentId: id },
  });
  f.hidePost();
  f.lose("comment");
  await service.drain();
  for (let attempt = 0; attempt < 4; attempt++) {
    f.tick();
    await f.service().drain();
  }
  const row = (await service.status()).workouts[0];
  assert.equal(row.syncStatus, "failed");
  assert.equal(row.verified, false);
  assert.match(row.syncError, /without posting a duplicate/);
  await service.retry("activity:i20");
  await f.service().drain();
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
});

test("legacy comments remain readable without implicit native migration and planned comments reach human provider text safely", async () => {
  const f = fixture(),
    id = randomUUID();
  const text = withWorkoutCommentText("Original", [
    {
      id: `comment-${id}`,
      type: "pre",
      body: "Keep easy\n- 10m 300w\n```",
      created_at: "2026-10-22T08:00:00Z",
    },
  ]);
  const projection = providerWorkoutDescription(text);
  assert.match(projection, /\[Workout comments\]/);
  assert.match(projection, /> - 10m 300w/);
  assert.doesNotMatch(projection, /training-agent-workout-comments-v1/);
  f.activities.get("i20").description = text;
  const loaded = await loadProviderWorkoutComments(f.request, "activity:i20");
  assert.equal(loaded.comments.length, 1);
  assert.equal(loaded.needsSync, false);
  assert.equal(f.calls.filter((call) => call.method).length, 0);
  await assert.rejects(
    saveProviderWorkoutComment(f.request, {
      workoutId: "activity:i20",
      body: "New",
      creationId: randomUUID(),
    }),
    { code: "DURABLE_COMMENT_REQUIRED" }
  );
});

test("mocked storage budget: no idle writes, one coalesced intent and bounded durable state transitions", async () => {
  const f = fixture(),
    service = f.service();
  await service.drain();
  assert.equal(f.counts.writes, 0);
  const before = f.activities.get("i20");
  const accepted = await service.accept({
    workoutId: "activity:i20",
    operationId: randomUUID(),
    action: "edit-activity",
    baseEvent: before,
    input: { revision: workoutRevision(before), description: "Budgeted edit" },
  });
  assert.equal(accepted.durableBoundary, "backend");
  await service.drain();
  assert.equal(f.counts.writes, 3); // accept, cross-instance claim, verified receipt
  const settled = { ...f.counts },
    providerCalls = f.calls.length;
  await service.drain();
  await service.drain();
  assert.equal(f.counts.writes, settled.writes);
  assert.equal(f.calls.length, providerCalls);
  assert.ok(f.counts.bytes < 30000);
});

test("unknown native sport is preserved during description edits and unavailable Strava stubs fail closed", async () => {
  const f = fixture();
  f.activities.get("i20").type = "Pickleball";
  const editor = await loadCompletedWorkoutEditor(f.request, "activity:i20");
  assert.equal(editor.model.sport, "Other");
  const result = await saveCompletedWorkout(f.request, "activity:i20", {
    model: editor.model,
    revision: editor.revision,
    description: "Preserve native sport",
  });
  assert.equal(result.event.type, "Pickleball");
  f.activities.get("i20").source = "STRAVA";
  await assert.rejects(loadCompletedWorkoutEditor(f.request, "activity:i20"), {
    code: "READ_ONLY",
  });
});

test("native ICU distance override wins over unchanged original recording distance for readback and projections", async () => {
  const f = fixture(),
    before = f.activities.get("i20");
  const edited = await saveCompletedWorkout(f.request, "activity:i20", {
    revision: workoutRevision(before),
    completedValues: { distance_meters: 5250.25 },
  });
  assert.equal(edited.event.distance, 5000);
  assert.equal(edited.event.icu_distance, 5250.25);
  const loaded = await loadCompletedWorkoutEditor(f.request, "activity:i20");
  assert.equal(loaded.completedValues.distance_meters, 5250.25);
  const service = f.service();
  await service.accept({
    workoutId: "activity:i20",
    operationId: randomUUID(),
    action: "edit-activity",
    baseEvent: edited.event,
    input: { revision: edited.revision, completedValues: { distance_meters: 5500 } },
  });
  await service.drain();
  const row = (await service.status()).workouts[0];
  assert.equal(row.workout.workout_summary.completed.distance_meters, 5500);
  assert.equal(row.workout.completed_data.distance, 5500);
});

test("completed external conflict supports reviewed provider adoption and narrow local resolution without changing streams", async () => {
  for (const choice of ["local", "provider"]) {
    const f = fixture(),
      service = f.service(),
      editor = await loadCompletedWorkoutEditor(f.request, "activity:i20");
    await service.accept({
      workoutId: "activity:i20",
      operationId: randomUUID(),
      action: "edit-activity",
      input: {
        model: editor.model,
        revision: editor.revision,
        description: "App description",
        completedValues: { calories: 275 },
      },
    });
    await service.drain();
    const streams = structuredClone(f.activities.get("i20").streams);
    f.activities.get("i20").description = "Provider description";
    f.activities.get("i20").calories = 300;
    f.tick();
    await service.drain();
    const compared = await service.reviewConflict("activity:i20");
    assert.equal(compared.canKeepLocal, true);
    assert.equal(compared.canAcceptProvider, true);
    assert.equal(compared.provider.completedValues.calories, 300);
    const resolved = await service.resolveConflict("activity:i20", {
      operationId: randomUUID(),
      expectedRevision: compared.revision,
      candidateRevision: compared.candidateRevision,
      choice,
    });
    if (choice === "local") await service.drain();
    assert.equal((await service.status()).workouts[0].verified, true);
    assert.equal(
      f.activities.get("i20").description,
      choice === "local" ? "App description" : "Provider description"
    );
    assert.deepEqual(f.activities.get("i20").streams, streams);
    assert.ok(resolved.accepted);
  }
});

test("native activity messages from another author cannot verify an unknown comment POST", async () => {
  const f = fixture(),
    service = f.service(),
    operationId = randomUUID();
  await service.accept({
    workoutId: "activity:i20",
    operationId,
    action: "comment",
    input: { comment: "Same text", commentId: operationId },
  });
  f.hidePost();
  f.lose("comment");
  await service.drain();
  f.messages.set("i20", [
    { id: 99, athlete_id: "someone-else", content: "Same text", created: new Date().toISOString() },
  ]);
  f.tick();
  await f.service().drain();
  assert.equal((await service.status()).workouts[0].verified, false);
  assert.equal(f.calls.filter((call) => call.method === "POST").length, 1);
});

test("native Event has no reverse activity field; canonical Activity link verifies without later false conflict", async () => {
  const f = fixture(),
    service = f.service(),
    event = f.events.get(100);
  f.nativeEventShape();
  await service.accept({
    workoutId: "event:100",
    operationId: randomUUID(),
    action: "complete",
    baseEvent: event,
    input: {
      revision: workoutRevision(event),
      model: importWorkout(event).model,
      completedValues: { duration_seconds: 1800 },
    },
  });
  await service.drain();
  const saved = (await service.status()).workouts[0];
  assert.equal(saved.verified, true);
  assert.equal(saved.workout.status, "completed");
  assert.equal(saved.completedActivity.paired_event_id, 100);
  f.tick();
  await service.drain();
  assert.equal((await service.status()).workouts[0].externalConflict, null);
});

test("completed activity projection merges into its paired plan without duplicate cards or lost prescription", async () => {
  const f = fixture(),
    service = f.service(),
    activity = f.activities.get("i20");
  await service.accept({
    workoutId: "activity:i20",
    operationId: randomUUID(),
    action: "edit-activity",
    baseEvent: activity,
    input: {
      revision: workoutRevision(activity),
      description: "Pending actual prose",
      completedValues: { calories: 300 },
    },
  });
  const plan = {
    id: "event:100",
    activity_id: "i20",
    title: "Planned prescription",
    workout_date: "2026-10-22",
    editor_model: importWorkout(f.events.get(100)).model,
    workout_summary: { planned: { duration_seconds: 1800 }, completed: { duration_seconds: 1800 } },
  };
  const projected = await service.project({ history: [plan], planned: [], athlete: {} });
  assert.equal(projected.history.length, 1);
  assert.equal(projected.history[0].id, "event:100");
  assert.deepEqual(projected.history[0].editor_model, plan.editor_model);
  assert.equal(projected.history[0].workout_summary.planned.duration_seconds, 1800);
  assert.equal(projected.history[0].workout_summary.completed.calories, 300);
});

test("later metadata saves cannot supersede an accepted comment or inherit and repost its text", async () => {
  const f = fixture(),
    service = f.service(),
    activity = f.activities.get("i20"),
    commentId = randomUUID();
  const first = await service.accept({
    workoutId: "activity:i20",
    operationId: randomUUID(),
    action: "edit-activity",
    baseEvent: activity,
    input: {
      revision: workoutRevision(activity),
      description: "First metadata",
      completedValues: { calories: 300 },
      comment: "Do not lose or duplicate",
      commentId,
    },
  });
  await service.accept({
    workoutId: "activity:i20",
    operationId: randomUUID(),
    action: "edit-activity",
    input: { revision: first.revision, description: "Later metadata" },
  });
  assert.equal(f.state().workouts["activity:i20"].jobs[0].state, "pending");
  await service.drain();
  assert.equal((await service.status()).workouts[0].verified, true);
  assert.equal(
    f.calls.filter((call) => call.method === "POST" && call.path.endsWith("/messages")).length,
    1
  );
  assert.equal(f.activities.get("i20").description, "Later metadata");
  const writes = f.calls
    .filter((call) => call.method === "PUT")
    .map((call) => JSON.parse(call.body));
  assert.equal(writes[1].calories, undefined);
});

test("app-owned manual durations are also read-only and rejected without any native mutation", async () => {
  const f = fixture(),
    activity = f.activities.get("i20");
  Object.assign(activity, {
    source: "MANUAL",
    external_id: "training-agent:completion:100",
    paired_event_id: 100,
    file_type: null,
    streams: [],
    laps: [],
    average_heartrate: 140,
    total_elevation_gain: 23.5,
    elapsed_time: 1800,
  });
  const editor = await loadCompletedWorkoutEditor(f.request, "activity:i20");
  assert.equal(editor.completedEditableFields.includes("duration_seconds"), false);
  assert.match(editor.completedReadOnlyReasons.duration_seconds, /managed by Intervals/);
  await assert.rejects(
    saveCompletedWorkout(f.request, "activity:i20", {
      revision: editor.revision,
      completedValues: { duration_seconds: 2000 },
    }),
    { code: "ACTIVITY_DURATION_READ_ONLY" }
  );
  assert.equal(f.activities.get("i20").moving_time, 1800);
  assert.equal(f.activities.get("i20").average_heartrate, 140);
  assert.equal(f.activities.get("i20").total_elevation_gain, 23.5);
  assert.equal(f.activities.size, 1);
  assert.equal(f.calls.filter((call) => call.method === "PUT").length, 0);
  assert.equal(
    f.calls.filter((call) => call.method === "POST" && call.path.endsWith("manual/bulk")).length,
    0
  );
});

test("recorded and foreign manual durations are read-only without attempting a native write", async () => {
  for (const source of ["UPLOAD", "MANUAL"]) {
    const f = fixture(),
      activity = f.activities.get("i20");
    Object.assign(activity, {
      source,
      external_id: "another-app:manual",
      file_type: source === "UPLOAD" ? "fit" : null,
    });
    const editor = await loadCompletedWorkoutEditor(f.request, "activity:i20");
    assert.equal(editor.completedEditableFields.includes("duration_seconds"), false);
    await assert.rejects(
      saveCompletedWorkout(f.request, "activity:i20", {
        revision: editor.revision,
        completedValues: { duration_seconds: 2000 },
      }),
      { code: "ACTIVITY_DURATION_READ_ONLY" }
    );
    assert.equal(f.calls.filter((call) => call.method).length, 0);
  }
});

test("a retained comment identity across different Save operations verifies one native message without posting again", async () => {
  const f = fixture(),
    service = f.service(),
    commentId = randomUUID();
  const first = await service.accept({
    workoutId: "activity:i20",
    operationId: randomUUID(),
    action: "comment",
    input: { comment: "Same retained intent", commentId },
  });
  await service.drain();
  const second = await service.accept({
    workoutId: "activity:i20",
    operationId: randomUUID(),
    action: "comment",
    input: { revision: first.revision, comment: "Same retained intent", commentId },
  });
  await service.drain();
  assert.equal((await service.status()).workouts[0].verified, true);
  assert.equal(
    f.calls.filter((call) => call.method === "POST" && call.path.endsWith("messages")).length,
    1
  );
  await service.accept({
    workoutId: "activity:i20",
    operationId: randomUUID(),
    action: "comment",
    input: { revision: second.revision, comment: "Different retained intent", commentId },
  });
  await service.drain();
  assert.equal((await service.status()).workouts[0].syncStatus, "failed");
  assert.equal(
    f.calls.filter((call) => call.method === "POST" && call.path.endsWith("messages")).length,
    1
  );
});
