import test from "node:test";
import assert from "node:assert/strict";
import {
  createCalendarAnnotationsService,
  calendarAnnotationsService,
} from "./calendar-annotations.mjs";
import {
  validateCalendarAnnotationEntry,
  isCalendarAnnotation,
  annotationOverlapsRange,
} from "./calendar-annotations-model.mjs";
import { mapIntervalsWorkout, moveIntervalsEvent, calendarCopyBody } from "./intervals.mjs";
import { loadCalendarNote } from "./calendar-notes.mjs";
import { fetchHistoricalCalendar } from "./intervals-history.mjs";
import { projectTrainingContext } from "./fast-context.mjs";
import { retainRecentTrainingContext } from "./training-retention.mjs";

const date = "2026-10-31",
  operation = "annotation-creation-identity";
const goals = (patch = {}) => ({
  kind: "goals",
  date,
  endDate: date,
  title: "Goals",
  goals: [{ id: "first", text: "Steady effort", completed: false }],
  ...patch,
});
const availability = (patch = {}) => ({
  kind: "availability",
  date,
  endDate: "2026-11-02",
  mode: "limited",
  sports: ["Run"],
  reason: "Work",
  description: "Afternoon only",
  ...patch,
});
function memory(options = {}) {
  const values = new Map();
  const record = (key, initial) => ({
    read: async () => structuredClone(values.get(key) ?? initial()),
    update: async (change) => {
      const before = structuredClone(values.get(key) ?? initial()),
        next = structuredClone(before),
        result = change(next);
      if (options.failAll) throw Error("Store unavailable");
      if (options.failCommit && before.pending && !next.pending && next.receipts?.length) {
        options.failCommit = false;
        throw Error("Lost private commit");
      }
      values.set(key, next);
      return structuredClone(result);
    },
  });
  return { record, values };
}
function provider(options = {}) {
  const values = new Map(),
    calls = [];
  let nextId = 100,
    revision = 0;
  const request = async (path, config = {}) => {
    const url = new URL(path, "http://native.invalid");
    calls.push({ path, ...config });
    if (url.pathname === "/athlete/0/events" && !config.method)
      return [...values.values()]
        .filter(
          (value) =>
            value.start_date_local.slice(0, 10) <= url.searchParams.get("newest") &&
            (value.end_date_local
              ? value.end_date_local.slice(0, 10) > url.searchParams.get("oldest")
              : value.start_date_local.slice(0, 10) >= url.searchParams.get("oldest"))
        )
        .map((value) => structuredClone(value));
    if (url.pathname.includes("/activities") || url.pathname.includes("/wellness")) return [];
    if (config.method === "POST") {
      if (options.wait) await options.wait;
      if (options.reject) throw Object.assign(Error("Rejected"), { status: 403 });
      const row = {
        ...JSON.parse(config.body),
        id: nextId++,
        updated: `v${revision++}`,
        customImported: "retain",
      };
      values.set(row.id, row);
      if (options.lostCreate) throw Error("Lost native reply");
      return structuredClone(row);
    }
    const id = Number(url.pathname.split("/").at(-1)),
      row = values.get(id);
    if (!row) throw Object.assign(Error("Not found"), { status: 404 });
    if (config.method === "DELETE") {
      if (!options.ignoreDelete) values.delete(id);
      if (options.lostDelete) throw Error("Lost delete reply");
      return null;
    }
    if (config.method === "PUT") {
      if (!options.ignoreUpdate)
        values.set(id, { ...row, ...JSON.parse(config.body), updated: `v${revision++}` });
      if (options.lostUpdate) throw Error("Lost update reply");
    }
    return structuredClone(values.get(id));
  };
  return {
    request,
    values,
    calls,
    writes: (method) => calls.filter((call) => call.method === method),
  };
}
const create = (p, store) =>
  createCalendarAnnotationsService({
    request: p.request,
    record: store.record,
    now: () => new Date("2026-10-20T12:00:00Z"),
  });
const saved = async (entry = goals(), p = provider(), store = memory()) => ({
  p,
  store,
  result: await create(p, store).create({ operationId: operation, entry }),
});

test("goal normalization removes blank rows, preserves order/completion and blocks wholly empty goals and invalid reference fields", () => {
  assert.deepEqual(
    validateCalendarAnnotationEntry(
      goals({
        title: " ",
        goals: [
          { id: "a", text: "  ", completed: false },
          { id: "b", text: "Second", completed: true },
          { id: "c", text: "First", completed: false },
        ],
      })
    ).goals.map((goal) => [goal.id, goal.completed]),
    [
      ["b", true],
      ["c", false],
    ]
  );
  assert.equal(validateCalendarAnnotationEntry(goals({ title: " " })).title, "Goals");
  for (const entry of [
    goals({ goals: [] }),
    goals({ goals: [{ id: "a", text: " ", completed: true }] }),
    goals({ title: "x".repeat(151) }),
    goals({ date: "2026-02-30" }),
    availability({ sports: [] }),
    availability({ sports: ["Day off"] }),
    availability({ mode: "unavailable", sports: ["Run"] }),
    availability({ endDate: "2026-10-30" }),
    availability({ reason: "Business" }),
  ])
    assert.throws(
      () => validateCalendarAnnotationEntry(entry),
      (error) => error.code === "INVALID_ANNOTATION"
    );
});

test("goals create genuine NOTE events with human text and exact private checklist readback", async () => {
  const entry = goals({
      goals: [
        { id: "a", text: "Own prose\nSecond line", completed: true },
        { id: "b", text: "Next", completed: false },
      ],
    }),
    { p, store, result } = await saved(entry);
  const native = [...p.values.values()][0],
    body = JSON.parse(p.writes("POST")[0].body);
  assert.equal(body.category, "NOTE");
  assert.equal(body.description, "[x] Own prose\nSecond line\n[ ] Next");
  assert.equal(body.end_date_local, "2026-11-01T00:00:00");
  assert.ok(!body.description.includes("Workout editor v1"));
  assert.ok(!body.description.includes('"goals"'));
  assert.equal(result.annotation.creationId, operation);
  assert.ok(isCalendarAnnotation(result.annotation));
  assert.deepEqual((await create(p, store).load(`event:${native.id}`)).goals, entry.goals);
  assert.equal(
    p.calls.filter((call) => !call.method && call.path === `/athlete/0/events/${native.id}`)
      .length >= 2,
    true
  );
});

test("availability writes native flags, reason categories, exact supported sports and an exclusive all-day end", async () => {
  for (const [reason, category] of [
    ["None", "NOTE"],
    ["Appointment", "NOTE"],
    ["Injury", "INJURED"],
    ["Sick", "SICK"],
    ["Vacation", "HOLIDAY"],
    ["Work", "NOTE"],
    ["Other", "NOTE"],
  ]) {
    const { p, result } = await saved(
      availability({ reason, sports: ["Bike", "Mtn Bike", "XC-Ski", "Strength"] })
    );
    const row = [...p.values.values()][0];
    assert.equal(row.category, category);
    assert.equal(row.training_availability, "LIMITED");
    assert.deepEqual(row.can_train_sports, [
      "Ride",
      "MountainBikeRide",
      "WeightTraining",
      "NordicSki",
    ]);
    assert.equal(row.end_date_local, "2026-11-03T00:00:00");
    assert.equal(result.annotation.endDate, "2026-11-02");
    assert.equal(result.annotation.nativeSportsComplete, true);
    assert.equal(row.description.includes(`Reason: ${reason}`), true);
  }
});

test("unsupported exact Brick/Custom selections never become invented native restrictions and clear a previous restrictive list", async () => {
  const { p, store, result } = await saved(availability()),
    service = create(p, store);
  const updated = await service.update(result.workoutId, {
    operationId: "unsupported-sports-operation",
    revision: result.annotation.revision,
    entry: availability({ sports: ["Brick", "Custom"] }),
  });
  const native = p.values.get(Number(result.workoutId.slice(6)));
  assert.equal(native.training_availability, "LIMITED");
  assert.ok(native.can_train_sports.length > 50);
  for (const type of ["Run", "Ride", "Swim", "Other", "Yoga", "NordicSki", "Transition"])
    assert.ok(native.can_train_sports.includes(type));
  assert.equal(native.can_train_sports.includes("Brick"), false);
  assert.equal(native.can_train_sports.includes("Custom"), false);
  assert.deepEqual(updated.annotation.sports, ["Brick", "Custom"]);
  assert.equal(updated.annotation.nativeSportsComplete, false);
  assert.match(updated.annotation.nativeWarning, /cannot enforce/);
});

test("narrow edits preserve imported native properties and unrelated availability fields", async () => {
  const { p, store, result } = await saved(availability()),
    id = Number(result.workoutId.slice(6));
  p.values.get(id).max_training_time = 3600;
  p.values.get(id).attachments = [{ id: 1 }];
  const service = create(p, store),
    loaded = await service.load(result.workoutId);
  await service.update(result.workoutId, {
    operationId: "availability-description-edit",
    revision: loaded.revision,
    entry: availability({ description: "Changed prose" }),
  });
  const patch = JSON.parse(p.writes("PUT")[0].body);
  assert.deepEqual(Object.keys(patch), ["description"]);
  assert.equal(p.values.get(id).customImported, "retain");
  assert.equal(p.values.get(id).max_training_time, 3600);
  assert.deepEqual(p.values.get(id).attachments, [{ id: 1 }]);
});

test("same-operation retries after transport loss and private-commit loss recover one native creation after restart", async () => {
  for (const fault of ["lostCreate", "failCommit"]) {
    const p = provider({ lostCreate: fault === "lostCreate" }),
      store = memory({ failCommit: fault === "failCommit" }),
      input = { operationId: operation, entry: goals() };
    let result;
    try {
      result = await create(p, store).create(input);
    } catch (error) {
      assert.equal(error.code, "ANNOTATION_UNCONFIRMED");
    }
    result = await create(p, store).create({ ...input, reconcileOnly: true });
    assert.equal(result.verified, true);
    assert.equal(p.writes("POST").length, 1);
    assert.equal(p.values.size, 1);
  }
});

test("unchanged replay is idempotent, while reused identities, later updates and external edits never falsely confirm old contents", async () => {
  const { p, store, result } = await saved(),
    service = create(p, store),
    input = { operationId: operation, entry: goals() };
  assert.equal((await service.create(input)).replayed, true);
  assert.equal(p.writes("POST").length, 1);
  await assert.rejects(
    service.create({ ...input, entry: goals({ title: "Different" }) }),
    (error) => error.code === "ANNOTATION_OPERATION_REUSED"
  );
  await service.update(result.workoutId, {
    operationId: "later-confirmed-operation",
    revision: result.annotation.revision,
    entry: goals({ title: "Later title" }),
  });
  await assert.rejects(
    service.create({ ...input, reconcileOnly: true }),
    (error) => error.code === "ANNOTATION_REPLAY_CHANGED"
  );
  const current = await service.load(result.workoutId);
  p.values.get(Number(result.workoutId.slice(6))).description = "Native external text";
  await assert.rejects(
    service.update(result.workoutId, {
      operationId: "later-confirmed-operation",
      revision: result.annotation.revision,
      entry: goals({ title: "Later title" }),
      reconcileOnly: true,
    }),
    (error) => error.code === "ANNOTATION_REPLAY_CHANGED"
  );
  const changed = await service.load(result.workoutId);
  assert.equal(changed.editable, false);
  assert.equal(changed.metadataCurrent, false);
  assert.equal(changed.providerDescription, "Native external text");
  assert.notEqual(current.revision, changed.revision);
});

test("stale revisions and native read-only records block updates and deletion before writes", async () => {
  const { p, store, result } = await saved(),
    service = create(p, store),
    id = Number(result.workoutId.slice(6));
  p.values.get(id).updated = "external-change";
  await assert.rejects(
    service.update(result.workoutId, {
      operationId: "stale-revision-operation",
      revision: result.annotation.revision,
      entry: goals({ title: "Do not write" }),
    }),
    (error) => error.code === "ANNOTATION_CONFLICT"
  );
  p.values.get(id).athlete_cannot_edit = true;
  const loaded = await service.load(result.workoutId);
  assert.equal(loaded.editable, false);
  await assert.rejects(
    service.delete(result.workoutId, {
      operationId: "readonly-delete-operation",
      revision: loaded.revision,
    }),
    (error) => error.status === 403
  );
  assert.equal(p.writes("PUT").length, 0);
  assert.equal(p.writes("DELETE").length, 0);
});

test("concurrent identical creation requests share one durable transport claim", async () => {
  let release;
  const wait = new Promise((resolve) => {
      release = resolve;
    }),
    p = provider({ wait }),
    store = memory(),
    input = { operationId: operation, entry: goals() };
  const first = create(p, store).create(input);
  for (let i = 0; i < 10 && !p.writes("POST").length; i++)
    await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    create(p, store).create(input),
    (error) => error.code === "ANNOTATION_UNCONFIRMED"
  );
  release();
  await first;
  assert.equal(p.writes("POST").length, 1);
});

test("unconfirmed native updates retain drafts and never blindly repeat transport", async () => {
  const options = {},
    p = provider(options),
    store = memory(),
    first = await saved(goals(), p, store),
    service = create(p, store);
  options.ignoreUpdate = true;
  const input = {
    operationId: "unconfirmed-update-operation",
    revision: first.result.annotation.revision,
    entry: goals({ title: "Unconfirmed" }),
  };
  await assert.rejects(
    service.update(first.result.workoutId, input),
    (error) => error.code === "ANNOTATION_UNCONFIRMED"
  );
  await assert.rejects(
    create(p, store).update(first.result.workoutId, { ...input, reconcileOnly: true }),
    (error) => error.code === "ANNOTATION_UNCONFIRMED"
  );
  assert.equal(p.writes("PUT").length, 1);
});

test("native deletion requires independent absence and uncertain replies recover without a second delete", async () => {
  const options = {},
    p = provider(options),
    store = memory(),
    { result } = await saved(goals(), p, store),
    service = create(p, store);
  options.lostDelete = true;
  const input = {
    operationId: "annotation-delete-operation",
    revision: result.annotation.revision,
  };
  assert.equal((await service.delete(result.workoutId, input)).deleted, true);
  assert.equal(
    (await create(p, store).delete(result.workoutId, { ...input, reconcileOnly: true })).replayed,
    true
  );
  assert.equal(p.writes("DELETE").length, 1);
  assert.equal(p.values.size, 0);
  await assert.rejects(service.load(result.workoutId), (error) => error.status === 404);
  assert.deepEqual((await service.list(date, "2026-11-02")).annotations, []);
});

test("a provider that retains an entry after DELETE is never reported as deleted", async () => {
  const p = provider({ ignoreDelete: true }),
    store = memory(),
    { result } = await saved(goals(), p, store);
  await assert.rejects(
    create(p, store).delete(result.workoutId, {
      operationId: "ignored-delete-operation",
      revision: result.annotation.revision,
    }),
    (error) => error.code === "ANNOTATION_UNCONFIRMED"
  );
  assert.equal(p.values.size, 1);
});

test("native moves retain the exact checklist and availability span across month and daylight-saving boundaries", async () => {
  const { p, store, result } = await saved(availability()),
    service = create(p, store);
  await moveIntervalsEvent(p.request, result.workoutId, "2026-11-01");
  const loaded = await service.load(result.workoutId);
  assert.equal(loaded.date, "2026-11-01");
  assert.equal(loaded.endDate, "2026-11-03");
  assert.deepEqual(loaded.sports, ["Run"]);
  assert.equal(loaded.metadataCurrent, true);
  const historical = await fetchHistoricalCalendar(
    p.request,
    { start: "2026-11-02", end: "2026-11-02" },
    { now: new Date("2026-10-20T12:00:00Z") }
  );
  assert.equal(historical.planned.length, 1);
  assert.equal(annotationOverlapsRange(historical.planned[0], "2026-11-02", "2026-11-02"), true);
  const context = await service.hydrateContext(historical);
  assert.equal(context.planned[0].calendar_annotation.endDate, "2026-11-03");
  const fast = projectTrainingContext(context, "week", new Date("2026-11-02T12:00:00Z"));
  assert.equal(fast.planned.length, 1);
  assert.equal(fast.planned[0].calendar_annotation.sports[0], "Run");
});

test("an ongoing annotation survives retention even when its start lies outside the window", async () => {
  const { p, store, result } = await saved(
      availability({ date: "2026-01-01", endDate: "2026-11-02" })
    ),
    workout = mapIntervalsWorkout(p.values.get(Number(result.workoutId.slice(6))), "2026-11-01");
  const context = {
    athlete: {},
    history: [workout],
    planned: [workout],
    metrics: {},
    wellness_history: [],
  };
  const retained = retainRecentTrainingContext(context, new Date("2026-11-01T12:00:00Z"));
  assert.equal(retained.history.length, 1);
  assert.equal(
    (
      await create(p, store).hydrateContext(
        projectTrainingContext(retained, "week", new Date("2026-11-01T12:00:00Z"))
      )
    ).planned.length,
    1
  );
});

test("foreign notes, generic annotation copy and generic note editing cannot overwrite or degrade private semantics", async () => {
  const { p, store, result } = await saved();
  const row = p.values.get(Number(result.workoutId.slice(6)));
  assert.throws(
    () => calendarCopyBody(row, date),
    (error) => error.code === "ANNOTATION_COPY_UNSUPPORTED"
  );
  await assert.rejects(
    loadCalendarNote(p.request, result.workoutId),
    (error) => error.code === "READ_ONLY"
  );
  p.values.set(999, {
    id: 999,
    category: "NOTE",
    name: "Unrelated",
    description: "Real existing note",
    start_date_local: `${date}T00:00:00`,
  });
  await assert.rejects(
    create(p, store).load("event:999"),
    (error) => error.code === "ANNOTATION_READ_ONLY"
  );
  assert.equal(p.values.get(999).description, "Real existing note");
});

test("corrupt or missing private metadata degrades one native card explicitly while ordinary workouts stay usable", async () => {
  const { p, store, result } = await saved(),
    service = create(p, store),
    workout = result.workout;
  store.values.get(`entry:${operation}`).pending = { action: "update" };
  const ordinary = { id: "event:999", workout_date: date, title: "Ordinary workout" },
    context = await service.hydrateContext({
      athlete: {},
      history: [],
      planned: [workout, ordinary],
    });
  assert.equal(context.planned.length, 2);
  assert.equal(context.planned[1], ordinary);
  assert.equal(context.planned[0].calendar_annotation, undefined);
  assert.match(context.planned[0].calendar_annotation_error, /unavailable/);
  await assert.rejects(
    service.load(result.workoutId),
    (error) => error.code === "ANNOTATION_STORAGE_INVALID"
  );
});

test("externally renamed out-of-bounds native titles are readable without poisoning context validation or enabling writes", async () => {
  const { p, store, result } = await saved(),
    service = create(p, store);
  p.values.get(Number(result.workoutId.slice(6))).name = "x".repeat(200);
  const loaded = await service.load(result.workoutId);
  assert.equal(loaded.editable, false);
  assert.equal(loaded.metadataCurrent, false);
  assert.equal(loaded.title.length, 200);
  assert.equal(isCalendarAnnotation(loaded), true);
  const mapped = mapIntervalsWorkout(p.values.get(Number(result.workoutId.slice(6))), "2026-10-20");
  assert.equal(
    (await service.hydrateContext({ history: [], planned: [mapped] })).planned[0]
      .calendar_annotation.title.length,
    200
  );
});

test("externally timed native entries retain their actual end day and become explicitly read-only", async () => {
  for (const entry of [goals(), availability()]) {
    const { p, store, result } = await saved(entry),
      native = p.values.get(Number(result.workoutId.slice(6)));
    native.start_date_local = `${entry.date}T08:00:00`;
    native.end_date_local = `${entry.endDate}T12:00:00`;
    const loaded = await create(p, store).load(result.workoutId);
    assert.equal(loaded.endDate, entry.endDate);
    assert.equal(loaded.editable, false);
    assert.equal(loaded.metadataCurrent, false);
    assert.match(loaded.nativeWarning, /now has a time/);
    assert.equal(mapIntervalsWorkout(native, "2026-10-20").workout_end_date, entry.endDate);
    assert.equal(isCalendarAnnotation(loaded), true);
  }
});

test("storage failure and malformed provider responses never cause unauthorized writes", async () => {
  const p = provider(),
    service = create(p, memory({ failAll: true }));
  await assert.rejects(service.create({ operationId: operation, entry: goals() }));
  assert.equal(p.writes("POST").length, 0);
  for (const malformed of [null, [], {}, { id: 100, start_date_local: "invalid" }]) {
    let writes = 0;
    const bad = createCalendarAnnotationsService({
      record: memory().record,
      request: async (_path, options = {}) => {
        if (options.method) writes++;
        return malformed;
      },
    });
    await assert.rejects(
      bad.load("event:100"),
      (error) => error.code === "ANNOTATION_PROVIDER_INVALID"
    );
    assert.equal(writes, 0);
  }
});

test("account-scoped metadata cannot cross provider connections or separate stores", async () => {
  const { p, result } = await saved();
  await assert.rejects(
    create(p, memory()).load(result.workoutId),
    (error) => error.code === "ANNOTATION_NOT_FOUND"
  );
  const context = { provider_connection: "foreign", planned: [result.workout], history: [] };
  const isolated = calendarAnnotationsService(
    { INTERVALS_API_KEY: "synthetic-only" },
    async () => {
      throw Error("No provider call expected");
    },
    async () => {
      throw Error("No database call expected");
    }
  );
  assert.equal(await isolated.hydrateContext(context), context);
});

test("private context decoration caches only hydration reads, expires and invalidates while authoritative loads remain fresh", async (t) => {
  let clock = Date.now(),
    reads = 0;
  t.mock.method(Date, "now", () => clock);
  const rows = new Map();
  const fetchImpl = async (url, options = {}) => {
    const params = new URL(url).searchParams;
    if (options.method === "POST") {
      const [row] = JSON.parse(options.body);
      rows.set(`${row.scope}:${row.name}`, row);
      return { ok: true, json: async () => [row] };
    }
    const key = `${params.get("scope").slice(3)}:${params.get("name").slice(3)}`,
      row = rows.get(key);
    if (options.method === "PATCH") {
      if (row?.updated_at !== params.get("updated_at")?.slice(3))
        return { ok: true, json: async () => [] };
      const next = JSON.parse(options.body);
      rows.set(key, next);
      return { ok: true, json: async () => [next] };
    }
    reads++;
    return { ok: true, json: async () => (row ? [row] : []) };
  };
  const p = provider(),
    config = {
      SUPABASE_URL: "https://annotation-fixture.supabase.co",
      SUPABASE_SECRET_KEY: "sb_secret_annotation_fixture",
      INTERVALS_API_KEY: "fixture-one",
    };
  const service = () => calendarAnnotationsService(config, p.request, fetchImpl);
  const created = await service().create({ operationId: operation, entry: goals() });
  const context = { athlete: {}, history: [], planned: [created.workout] };
  let before = reads;
  const [one, two] = await Promise.all([
    service().hydrateContext(context),
    service().hydrateContext(context),
  ]);
  assert.equal(reads - before, 1);
  one.planned[0].calendar_annotation.goals[0].text = "Changed output";
  assert.equal(two.planned[0].calendar_annotation.goals[0].text, "Steady effort");
  before = reads;
  await service().load(created.workoutId);
  assert.equal(reads - before, 1);
  before = reads;
  await service().hydrateContext(context);
  assert.equal(reads, before);
  clock += 2001;
  await service().hydrateContext(context);
  assert.equal(reads, before + 1);
  const current = await service().load(created.workoutId);
  const changed = await service().update(created.workoutId, {
    operationId: "cache-invalidation-operation",
    revision: current.revision,
    entry: goals({ title: "Updated title" }),
  });
  before = reads;
  const hydrated = await service().hydrateContext({
    athlete: {},
    history: [],
    planned: [changed.workout],
  });
  assert.equal(reads - before, 1);
  assert.equal(hydrated.planned[0].calendar_annotation.title, "Updated title");
  const other = await calendarAnnotationsService(
    { ...config, INTERVALS_API_KEY: "fixture-two" },
    p.request,
    fetchImpl
  ).hydrateContext(context);
  assert.equal(other.planned[0].calendar_annotation, undefined);
  assert.match(other.planned[0].calendar_annotation_error, /unavailable/);
});
