import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDurableWorkoutCommits } from "./durable-workout-commits.mjs";
import { newStep, importWorkout, serializeWorkout } from "./workout-editor-model.mjs";
import { fixtureEvent, parseTestWorkout } from "./fixtures/workout-editor-fixtures.mjs";
import { workoutRevision } from "./workout-editor.mjs";

function setup() {
  let state = { version: 1, workouts: {}, operations: {} },
    time = Date.now(),
    failure = null,
    gate = null;
  const events = new Map();
  const calls = [];
  const record = {
    read: async () => structuredClone(state),
    update: async (change) => {
      const next = structuredClone(state);
      const result = change(next);
      state = next;
      return result;
    },
  };
  const request = async (path, options = {}) => {
    calls.push({ path, ...options });
    if (options.method && gate) await gate;
    if (failure && options.method) {
      const e = failure;
      failure = null;
      throw e;
    }
    if (path === "/athlete/0") return { sportSettings: [] };
    if (path.includes("?oldest=")) return structuredClone([...events.values()]);
    if (path === "/athlete/0/events/bulk?upsert=true") {
      const body = JSON.parse(options.body)[0];
      const old = [...events.values()].find((event) => event.external_id === body.external_id);
      const event = {
        ...body,
        id: old?.id || events.size + 201,
        workout_doc: parseTestWorkout(body.description),
      };
      events.set(event.id, event);
      return [structuredClone(event)];
    }
    const id = Number(path.split("/").at(-1));
    const event = events.get(id);
    if (!event) throw Object.assign(Error("Missing"), { status: 404 });
    if (options.method === "DELETE") {
      events.delete(id);
      return null;
    }
    if (options.method === "PUT") {
      const patch = JSON.parse(options.body);
      Object.assign(event, patch, { workout_doc: parseTestWorkout(patch.description) });
    }
    return structuredClone(event);
  };
  const make = (options = {}) =>
    createDurableWorkoutCommits(
      { INTERVALS_API_KEY: "fake" },
      {
        record,
        request,
        write: (_id, action) => action(request),
        clock: () => time,
        random: () => 0.5,
        ...options,
      }
    );
  return {
    make,
    events,
    calls,
    state: () => structuredClone(state),
    time: (value) => {
      time += value;
    },
    fail: (error) => {
      failure = error;
    },
    gate: (value) => {
      gate = value;
    },
  };
}
const model = (sport) => ({
  version: 1,
  name: `Disposable ${sport}`,
  sport,
  date: "2026-10-21",
  notes: "Preserve me",
  ...(sport === "Swim" ? { poolLength: "25y" } : {}),
  steps: [newStep(sport)],
});
const create = (service, m = model("Ride"), id = randomUUID()) =>
  service.accept({
    operationId: id,
    workoutId: `app:${id}`,
    action: "create",
    input: { model: m },
  });
const edit = (service, row, m) =>
  service.accept({
    operationId: randomUUID(),
    workoutId: row.workoutId,
    revision: row.revision,
    action: "edit",
    input: { model: m },
  });

test("all three sports atomically retain full model and pending operation without provider requests", async () => {
  for (const sport of ["Swim", "Ride", "Run"]) {
    const env = setup(),
      service = env.make(),
      m = model(sport);
    const row = await create(service, m);
    assert.equal(env.calls.length, 0);
    const stored = env.state().workouts[row.workoutId];
    assert.deepEqual(stored.input.model, m);
    assert.equal(stored.jobs[0].revision, stored.revision);
    assert.equal(row.durableBoundary, "backend");
    assert.equal(row.syncStatus, "pending");
    assert.deepEqual((await service.editor(row.workoutId)).model, m);
    await service.drain();
    assert.equal(
      (await service.status()).workouts[0].syncStatus,
      "synced",
      JSON.stringify(env.state())
    );
    assert.equal(env.events.size, 1);
  }
});

test("a delayed create survives navigation and restart; rapid revisions converge with stable identity", async () => {
  const env = setup(),
    service = env.make();
  let release;
  env.gate(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const first = await create(service);
  const draining = service.drain();
  await new Promise((resolve) => setImmediate(resolve));
  let row = first;
  for (let n = 2; n <= 5; n++)
    row = await edit(service, row, { ...model("Ride"), name: `Revision ${n}` });
  assert.equal(row.revision, "app:5");
  assert.equal((await env.make().editor(row.workoutId)).model.name, "Revision 5");
  assert.equal(env.events.size, 0);
  release();
  env.gate(null);
  await draining;
  const final = (await env.make().status()).workouts[0];
  assert.equal(final.syncedRevision, 5);
  assert.equal(final.workoutId, first.workoutId);
  assert.equal(final.providerWorkoutId, "event:201");
  assert.equal([...env.events.values()][0].name, "Revision 5");
  assert.equal(env.events.size, 1);
});

test("an older successful response cannot mark a newer revision synced", async () => {
  const env = setup(),
    service = env.make();
  const first = await create(service);
  await service.drain();
  let release;
  env.gate(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const second = await edit(
    service,
    { ...first, revision: "app:1" },
    { ...model("Ride"), name: "Second" }
  );
  const draining = service.drain();
  await new Promise((resolve) => setImmediate(resolve));
  const third = await edit(service, second, { ...model("Ride"), name: "Third" });
  assert.equal(third.syncedRevision, 1);
  assert.equal(third.syncStatus, "pending");
  release();
  env.gate(null);
  await draining;
  assert.equal((await service.status()).workouts[0].syncedRevision, 3);
});

test("unknown create success reconciles by external identity and never duplicates", async () => {
  const env = setup(),
    service = env.make();
  const first = await create(service);
  const pending = env.state().workouts[first.workoutId];
  // The external write succeeded but its response and worker were lost.
  const body = {
    ...pending.event,
    id: 201,
    workout_doc: parseTestWorkout(pending.event.description),
  };
  env.events.set(201, body);
  env.fail(Error("Connection reset"));
  await service.drain();
  assert.equal(env.events.size, 1);
  assert.equal((await service.status()).workouts[0].syncStatus, "synced");
});

test("rate limiting persists bounded retry with Retry-After and permanent authentication errors remain actionable", async () => {
  const env = setup(),
    service = env.make();
  const first = await create(service);
  env.fail(Object.assign(Error("Create limited"), { status: 429, retryAfterMs: 60_000 }));
  await service.drain();
  assert.equal(env.events.size, 0);
  assert.ok(env.state().workouts[first.workoutId].jobs[0].nextAttemptAt - Date.now() >= 59_000);
  env.time(61_000);
  await service.drain();
  await edit(service, first, { ...model("Ride"), name: "Updated" });
  env.fail(Object.assign(Error("Limited"), { status: 429, retryAfterMs: 60_000 }));
  await service.drain();
  let row = env.state().workouts[first.workoutId];
  assert.equal(row.jobs[0].state, "pending");
  assert.ok(row.jobs[0].nextAttemptAt - Date.now() >= 59_000);
  const before = env.calls.length;
  await service.drain();
  assert.equal(env.calls.length, before);
  env.time(61_000);
  env.fail(Object.assign(Error("Expired"), { status: 401 }));
  await service.drain();
  row = (await service.status()).workouts[0];
  assert.equal(row.syncStatus, "failed");
  assert.match(row.syncError, /permission|denied/i);
  await service.retry(first.workoutId);
  await service.drain();
  assert.equal((await service.status()).workouts[0].syncStatus, "synced");
});

test("two workers coordinate persisted claims and duplicate clicks are idempotent", async () => {
  const env = setup(),
    service = env.make(),
    id = randomUUID();
  const input = {
    operationId: id,
    workoutId: `app:${id}`,
    action: "create",
    input: { model: model("Run") },
  };
  await Promise.all([service.accept(input), service.accept(input)]);
  assert.equal(env.state().workouts[input.workoutId].jobs.length, 1);
  await assert.rejects(service.accept({ ...input, input: { model: model("Ride") } }), /reused/);
  let release;
  env.gate(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const first = service.drain();
  await new Promise((resolve) => setImmediate(resolve));
  await env.make().drain();
  release();
  env.gate(null);
  await first;
  assert.equal(env.calls.filter((call) => call.path.includes("bulk?upsert")).length, 1);
});

test("create-edit-delete dependencies leave no duplicate or resurrected workout", async () => {
  const env = setup(),
    service = env.make();
  const first = await create(service);
  const second = await edit(service, first, { ...model("Ride"), name: "Deleted edit" });
  await service.accept({
    operationId: randomUUID(),
    workoutId: first.workoutId,
    revision: second.revision,
    action: "delete",
  });
  await service.drain();
  assert.equal(env.events.size, 0);
  const row = (await service.status()).workouts[0];
  assert.equal(row.deleted, true);
  assert.equal(row.syncedRevision, 3);
  await service.drain();
  assert.equal(env.events.size, 0);
});

test("first imported deletion accepts a complete model and guards the fresh provider revision and permissions", async () => {
  for (const change of ["none", "external", "readonly"]) {
    const env = setup(),
      service = env.make(),
      event = fixtureEvent();
    env.events.set(event.id, event);
    const saved = await service.accept({
      operationId: randomUUID(),
      workoutId: `event:${event.id}`,
      revision: workoutRevision(event),
      action: "delete",
      input: { model: importWorkout(event).model },
    });
    assert.equal(env.calls.length, 0);
    assert.equal(saved.deleted, true);
    if (change === "external") env.events.get(event.id).name = "External change";
    if (change === "readonly") env.events.get(event.id).read_only = true;
    await service.drain();
    const row = (await service.status()).workouts[0];
    assert.equal(row.syncStatus, change === "none" ? "synced" : "failed");
    assert.equal(env.events.has(event.id), change !== "none");
  }
});

test("a synchronized deletion projects a tombstone over stale and fresh snapshots without null workouts", async () => {
  const env = setup(),
    service = env.make();
  const created = await create(service);
  await service.drain();
  const linked = (await service.status()).workouts[0];
  await service.accept({
    operationId: randomUUID(),
    workoutId: created.workoutId,
    revision: linked.revision,
    action: "delete",
  });
  await service.drain();
  const unrelated = { id: "event:999", title: "Retained workout", workout_date: "2026-10-21" };
  for (const synced_at of [undefined, "2020-01-01T00:00:00Z", "2030-01-01T00:00:00Z"]) {
    const projected = await service.project({
      synced_at,
      history: [],
      planned: [created.workout, { ...linked.workout, id: linked.providerWorkoutId }, unrelated],
    });
    assert.equal(projected.planned.length, 1);
    assert.equal(projected.planned[0].id, unrelated.id);
    assert.ok(projected.history.every((workout) => workout?.id === unrelated.id));
  }
});

test("a newer edit behind a failed create stays actionable and explicit retry resumes the dependency in order", async () => {
  const env = setup(),
    service = env.make();
  const first = await create(service);
  env.fail(Object.assign(Error("Credential expired"), { status: 401 }));
  await service.drain();
  assert.equal((await service.status()).workouts[0].syncStatus, "failed");
  const second = await edit(service, first, { ...model("Ride"), name: "Newer retained edit" });
  assert.equal(second.syncStatus, "failed");
  assert.ok(second.syncError);
  await service.drain();
  assert.equal(env.events.size, 0);
  await service.retry(first.workoutId);
  await service.drain();
  const final = (await service.status()).workouts[0];
  assert.equal(final.syncStatus, "synced");
  assert.equal(final.syncedRevision, 2);
  assert.equal(env.events.size, 1);
  assert.equal(env.events.get(201).name, "Newer retained edit");
});

test("genuine external conflict keeps both accepted model and external data intact", async () => {
  const env = setup(),
    service = env.make(),
    event = fixtureEvent();
  env.events.set(event.id, event);
  const m = importWorkout(event).model;
  const accepted = await service.accept({
    operationId: randomUUID(),
    workoutId: `event:${event.id}`,
    action: "edit",
    revision: workoutRevision(event),
    baseEvent: event,
    input: { model: { ...m, name: "Local revision" } },
  });
  env.events.get(event.id).name = "External revision";
  await service.drain();
  const row = (await service.status()).workouts[0];
  assert.equal(row.syncStatus, "failed");
  assert.match(row.syncError, /changed|conflict/i);
  assert.equal(row.model.name, "Local revision");
  assert.equal(row.externalConflict.name, "External revision");
  assert.equal(env.events.get(event.id).name, "External revision");
  await assert.rejects(service.retry(accepted.workoutId), /both versions/);
  await assert.rejects(edit(service, { ...accepted, revision: "app:0" }, m), /another tab/);
});

test("local acceptance failure cannot leave an accepted revision without its operation", async () => {
  const env = setup(),
    service = env.make();
  await assert.rejects(create(service, { ...model("Run"), date: "bad" }));
  assert.deepEqual(env.state().workouts, {});
  assert.deepEqual(env.state().operations, {});
});

test("invalid planned values and form payloads reject as definite400 input failures before retaining a revision", async () => {
  for (const extra of [
    { values: { invented: 1 } },
    { values: { duration_seconds: 1.5 } },
    { values: { intensity_factor: 6 } },
    { time: "25:00" },
    { comment: { invalid: true } },
    { description: 123 },
    { personal: { privateNotes: 123 } },
  ]) {
    const env = setup(),
      service = env.make();
    await assert.rejects(
      service.accept({
        operationId: randomUUID(),
        action: "create",
        input: { model: model("Ride"), ...extra },
      }),
      (error) => error.status === 400
    );
    assert.deepEqual(env.state().workouts, {});
    assert.deepEqual(env.state().operations, {});
    assert.equal(env.calls.length, 0);
  }
});

test("storage outages keep their retryable classification and valid comments do not require a provider identity at acceptance", async () => {
  const storage = Error("Database unavailable");
  const failing = createDurableWorkoutCommits(
    { INTERVALS_API_KEY: "fake" },
    {
      record: {
        read: async () => ({ workouts: {}, operations: {} }),
        update: async () => {
          throw storage;
        },
      },
      request: async () => null,
    }
  );
  await assert.rejects(create(failing), (error) => error === storage && error.status !== 400);
  const env = setup(),
    service = env.make();
  const operationId = randomUUID();
  const created = await service.accept({
    operationId,
    action: "create",
    input: { model: model("Ride"), comment: "Accepted before external creation" },
  });
  assert.equal(created.syncStatus, "pending");
  assert.match(created.event.description, /Accepted before external creation/);
  const updated = await service.accept({
    operationId: randomUUID(),
    workoutId: created.workoutId,
    revision: created.revision,
    action: "edit",
    input: { model: { ...model("Ride"), name: "New title" }, comment: "Another retained comment" },
  });
  assert.equal(updated.revision, "app:2");
  assert.match(updated.event.description, /Another retained comment/);
  assert.equal(env.calls.length, 0);
});

test("an empty desktop start time and custom structured description survive acceptance and reopen", async () => {
  const env = setup(),
    service = env.make();
  const id = randomUUID();
  const accepted = await service.accept({
    operationId: id,
    action: "create",
    input: { model: model("Run"), time: "", description: "Custom coaching instructions" },
  });
  assert.equal(accepted.event.start_date_local, "2026-10-21T00:00:00");
  assert.equal((await service.editor(accepted.workoutId)).scheduledTime, "");
  await service.drain();
  const reopened = await service.editor(accepted.workoutId);
  assert.equal(reopened.descriptionOverride, "Custom coaching instructions");
  assert.equal(reopened.scheduledTime, "");
  const edit = await service.accept({
    operationId: randomUUID(),
    action: "edit",
    workoutId: accepted.workoutId,
    revision: "app:1",
    input: { model: { ...model("Run"), name: "Updated" }, time: "07:15" },
  });
  assert.equal(edit.event.start_date_local, "2026-10-21T07:15:00");
  assert.equal((await service.editor(edit.workoutId)).scheduledTime, "07:15:00");
});

test("personal fields and recurrence are retained atomically and resume after sidecar failure", async () => {
  const env = setup();
  let unavailable = true,
    personalValue = null,
    repeatCalls = 0;
  const personalService = {
    read: async () => ({ revision: 0 }),
    save: async (_id, input) => {
      if (unavailable) throw Error("Storage unavailable");
      personalValue = input.value;
    },
  };
  const options = {
    personalService,
    recurrence: async () => {
      repeatCalls++;
      return { verified: true };
    },
  };
  const service = env.make(options),
    id = randomUUID();
  const personal = {
    privateNotes: "Private and offline",
    tags: ["test"],
    equipment: "Bike",
    autoCalculate: true,
  };
  const recurrence = { operationId: randomUUID(), rule: { retained: true } };
  const saved = await service.accept({
    operationId: id,
    action: "create",
    input: { model: model("Ride"), personal, recurrence },
  });
  assert.deepEqual(env.state().workouts[saved.workoutId].input.personal, personal);
  assert.deepEqual(env.state().workouts[saved.workoutId].input.recurrence, recurrence);
  await service.drain();
  assert.equal(env.events.size, 1);
  assert.equal((await service.status()).workouts[0].syncStatus, "pending");
  unavailable = false;
  env.time(4000);
  await env.make(options).drain();
  assert.deepEqual(personalValue, personal);
  assert.equal(repeatCalls, 1);
  assert.equal(env.events.size, 1);
  assert.equal((await service.status()).workouts[0].syncStatus, "synced");
});

test("later external edits and deletions retain both versions and cannot be silently masked by synchronized projection", async () => {
  const env = setup(),
    service = env.make();
  const saved = await create(service);
  await service.drain();
  env.events.get(201).name = "External edit after sync";
  const mapped = { id: "event:201", title: "External edit after sync", workout_date: "2026-10-21" };
  const stale = await service.project({ history: [], planned: [] });
  assert.equal(stale.planned[0].title, "Disposable Ride");
  const projection = await service.project({
    synced_at: new Date(Date.now() + 1000).toISOString(),
    history: [],
    planned: [mapped],
  });
  assert.equal(projection.planned[0].title, "External edit after sync");
  env.time(61_000);
  await service.drain();
  const conflict = (await service.status()).workouts[0];
  assert.equal(conflict.syncStatus, "failed");
  assert.equal(conflict.model.name, "Disposable Ride");
  assert.equal(conflict.externalConflict.name, "External edit after sync");
  assert.equal(
    (await service.editor(saved.workoutId)).externalConflict.name,
    "External edit after sync"
  );
  const other = setup(),
    otherService = other.make();
  await create(otherService);
  await otherService.drain();
  other.events.delete(201);
  other.time(61_000);
  await otherService.drain();
  assert.equal((await otherService.status()).workouts[0].externalConflict.deleted, true);
});

async function reviewedConflict(options = {}, extras = {}) {
  const env = setup(),
    service = env.make(options);
  const operationId = randomUUID();
  const created = await service.accept({
    operationId,
    action: "create",
    input: { model: model("Ride"), ...extras },
  });
  await service.drain();
  env.events.get(201).name = "Reviewed external version";
  env.time(61_000);
  await service.drain();
  const review = await service.reviewConflict(created.workoutId);
  const input = {
    operationId: randomUUID(),
    expectedRevision: review.revision,
    candidateRevision: review.candidateRevision,
    choice: "local",
  };
  return { env, service, created, review, input };
}

test("explicitly keeping the app version archives both copies and still guards the reviewed external revision", async () => {
  const { env, service, created, review, input } = await reviewedConflict();
  assert.equal(review.local.model.name, "Disposable Ride");
  assert.equal(review.provider.model.name, "Reviewed external version");
  assert.equal(review.provider.event.name, "Reviewed external version");
  assert.equal(review.canKeepLocal, true);
  const resolution = await service.resolveConflict(created.workoutId, input);
  assert.equal(resolution.revision, "app:2");
  assert.equal(resolution.syncStatus, "pending");
  assert.equal(env.events.get(201).name, "Reviewed external version");
  const archived = env.state().workouts[created.workoutId].resolutionHistory[0];
  assert.equal(archived.local.input.model.name, "Disposable Ride");
  assert.equal(archived.provider.name, "Reviewed external version");
  await service.drain();
  assert.equal(env.events.get(201).name, "Disposable Ride");
  assert.equal((await service.status()).workouts[0].syncStatus, "synced");
  assert.equal(env.events.size, 1);
});

test("provider adoption preserves exact parsed prescription and archived local model without sending an external write", async () => {
  const { env, service, created } = await reviewedConflict();
  const externalModel = {
    ...model("Ride"),
    name: "Provider prescription",
    notes: "External notes",
    steps: [newStep("Ride")],
  };
  externalModel.steps[0].end.value = 123;
  const external = env.events.get(201);
  Object.assign(external, {
    name: externalModel.name,
    description: serializeWorkout(externalModel),
    workout_doc: parseTestWorkout(serializeWorkout(externalModel)),
  });
  const review = await service.reviewConflict(created.workoutId);
  const writes = env.calls.filter((call) => call.method).length;
  const resolved = await service.resolveConflict(created.workoutId, {
    operationId: randomUUID(),
    expectedRevision: review.revision,
    candidateRevision: review.candidateRevision,
    choice: "provider",
  });
  assert.equal(resolved.syncStatus, "synced");
  assert.deepEqual(resolved.input.model, review.provider.model);
  assert.equal(resolved.input.revision, resolved.revision);
  assert.equal((await service.editor(created.workoutId)).model.notes, "External notes");
  assert.equal(env.calls.filter((call) => call.method).length, writes);
  assert.equal(
    env.state().workouts[created.workoutId].resolutionHistory[0].local.input.model.name,
    "Disposable Ride"
  );
});

test("resolution rejects newer local saves and newer provider changes instead of rebasing silently", async () => {
  const local = await reviewedConflict();
  await edit(local.service, local.created, { ...model("Ride"), name: "New local save" });
  await assert.rejects(
    local.service.resolveConflict(local.created.workoutId, local.input),
    /out of date/
  );
  assert.equal((await local.service.status()).workouts[0].model.name, "New local save");
  const remote = await reviewedConflict();
  remote.env.events.get(201).name = "Changed after review";
  await assert.rejects(
    remote.service.resolveConflict(remote.created.workoutId, remote.input),
    /changed again/
  );
  assert.equal(remote.env.events.get(201).name, "Changed after review");
  assert.equal(remote.env.state().workouts[remote.created.workoutId].resolutionHistory, undefined);
});

test("provider adoption retains and completes private metadata and repeat work before reporting the accepted revision synced", async () => {
  const personal = {
    privateNotes: "Retained personal note",
    tags: ["private"],
    equipment: "Bike",
    autoCalculate: true,
  };
  const recurrence = { operationId: randomUUID(), rule: { retained: true } };
  const values = [],
    repeats = [];
  const { env, service, created, review } = await reviewedConflict(
    {
      personalService: {
        read: async () => ({ revision: 0 }),
        save: async (_id, input) => {
          values.push(input.value);
        },
      },
      recurrence: async (_id, input) => {
        repeats.push(input);
        return { verified: true };
      },
    },
    { personal, recurrence }
  );
  const beforeWrites = env.calls.filter((call) => call.method).length;
  const resolved = await service.resolveConflict(created.workoutId, {
    operationId: randomUUID(),
    expectedRevision: review.revision,
    candidateRevision: review.candidateRevision,
    choice: "provider",
  });
  assert.equal(resolved.syncStatus, "pending");
  assert.deepEqual(resolved.input.personal, personal);
  assert.deepEqual(resolved.input.recurrence, recurrence);
  await service.drain();
  assert.deepEqual(values.at(-1), personal);
  assert.deepEqual(repeats.at(-1), recurrence);
  assert.equal(values.length, 2);
  assert.equal((await service.status()).workouts[0].syncStatus, "synced");
  assert.equal(env.calls.filter((call) => call.method).length, beforeWrites);
});

test("a lost resolution reply retries the identical operation without another revision or duplicate archive", async () => {
  const { env, service, created, input } = await reviewedConflict();
  const first = await service.resolveConflict(created.workoutId, input);
  env.events.get(201).name = "A later external edit";
  const calls = env.calls.length;
  const replay = await env.make().resolveConflict(created.workoutId, input);
  assert.equal(replay.revision, first.revision);
  assert.equal(env.calls.length, calls);
  assert.equal(env.state().workouts[created.workoutId].resolutionHistory.length, 1);
  await assert.rejects(
    service.resolveConflict(created.workoutId, { ...input, choice: "provider" }),
    /reused/
  );
  await service.drain();
  assert.equal((await service.status()).workouts[0].syncStatus, "failed");
  assert.equal(env.events.get(201).name, "A later external edit");
});

test("external deletion can be explicitly adopted while retaining the local copy, never resurrected by keep-local", async () => {
  const { env, service, created } = await reviewedConflict();
  env.events.delete(201);
  const review = await service.reviewConflict(created.workoutId);
  assert.equal(review.provider.deleted, true);
  assert.equal(review.canKeepLocal, false);
  const input = {
    operationId: randomUUID(),
    expectedRevision: review.revision,
    candidateRevision: review.candidateRevision,
    choice: "local",
  };
  await assert.rejects(service.resolveConflict(created.workoutId, input), /separate copy/);
  const resolved = await service.resolveConflict(created.workoutId, {
    ...input,
    choice: "provider",
  });
  assert.equal(resolved.deleted, true);
  assert.equal(
    env.state().workouts[created.workoutId].resolutionHistory[0].local.input.model.name,
    "Disposable Ride"
  );
  await service.drain();
  assert.equal(env.events.size, 0);
});

test("unsupported provider fields and active worker claims cannot be resolved by silently flattening data", async () => {
  const unsupported = await reviewedConflict();
  unsupported.env.events.get(201).workout_doc.options = { unsupported: true };
  const review = await unsupported.service.reviewConflict(unsupported.created.workoutId);
  assert.equal(review.canAcceptProvider, false);
  await assert.rejects(
    unsupported.service.resolveConflict(unsupported.created.workoutId, {
      operationId: randomUUID(),
      expectedRevision: review.revision,
      candidateRevision: review.candidateRevision,
      choice: "provider",
    }),
    /unsupported/
  );
  const running = setup(),
    service = running.make();
  const first = await create(service);
  let release;
  running.gate(
    new Promise((resolve) => {
      release = resolve;
    })
  );
  const drain = service.drain();
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(service.reviewConflict(first.workoutId), /still checking/);
  release();
  running.gate(null);
  await drain;
});
