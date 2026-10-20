import test from "node:test";
import assert from "node:assert/strict";
import {
  loadWorkoutRecurrence,
  saveWorkoutRecurrence,
  recurrenceDates,
  normalizeRecurrenceRule,
} from "./workout-recurrence.mjs";
const { structuredClone } = globalThis;

const operationId = "00000000-0000-4000-8000-000000000001";
const nextId = "00000000-0000-4000-8000-000000000002";
const cancelId = "00000000-0000-4000-8000-000000000003";
const rule = {
  frequency: "daily",
  interval: 1,
  weekdays: [],
  startDate: "2026-10-20",
  end: { type: "count", count: 3 },
};
function memory(fresh) {
  let state = fresh;
  return {
    read: async () => structuredClone(state),
    update: async (change) => {
      const draft = structuredClone(state),
        result = change(draft);
      state = draft;
      return structuredClone(result);
    },
  };
}
function fixture() {
  const store = memory({ series: {} }),
    records = new Map(),
    events = new Map([
      [
        "1",
        {
          id: 1,
          name: "Repeating run",
          type: "Run",
          category: "WORKOUT",
          description: "- 300s 90% Pace",
          start_date_local: "2026-10-20T06:30:00",
          time_target: 300,
        },
      ],
    ]);
  let posts = 0,
    deletes = 0,
    hidden = false,
    lose = false;
  const request = async (path, options = {}) => {
    if (options.method === "POST") {
      posts++;
      const event = { ...JSON.parse(options.body), id: posts + 1 };
      events.set(String(event.id), event);
      if (lose) throw Error("Response lost");
      return structuredClone(event);
    }
    if (path.includes("?")) return hidden ? [] : structuredClone([...events.values()]);
    const id = path.split("/").at(-1);
    if (!events.has(id)) throw Object.assign(Error("Not found"), { status: 404 });
    if (options.method === "DELETE") {
      deletes++;
      events.delete(id);
      return null;
    }
    return structuredClone(events.get(id));
  };
  const options = {
    store,
    today: "2026-10-20",
    copyRecordFor: (id) => {
      if (!records.has(id)) records.set(id, memory({ operation: null }));
      return records.get(id);
    },
  };
  return {
    store,
    events,
    options,
    request,
    posts: () => posts,
    deletes: () => deletes,
    hide: (value) => (hidden = value),
    lose: (value) => (lose = value),
  };
}
test("daily and custom weekdays respect intervals, end dates and occurrence bounds", () => {
  assert.deepEqual(recurrenceDates(rule), ["2026-10-20", "2026-10-21", "2026-10-22"]);
  assert.deepEqual(
    recurrenceDates({
      ...rule,
      frequency: "weekly",
      interval: 2,
      weekdays: [1, 3, 5],
      end: { type: "count", count: 5 },
    }),
    ["2026-10-21", "2026-10-23", "2026-11-02", "2026-11-04", "2026-11-06"]
  );
  assert.deepEqual(recurrenceDates({ ...rule, end: { type: "until", until: "2026-10-23" } }), [
    "2026-10-20",
    "2026-10-21",
    "2026-10-22",
    "2026-10-23",
  ]);
  assert.throws(() => normalizeRecurrenceRule({ ...rule, weekdays: [9], frequency: "weekly" }));
  assert.throws(() => recurrenceDates({ ...rule, end: { type: "count", count: 53 } }));
  assert.throws(
    () => recurrenceDates({ ...rule, end: { type: "until", until: "2027-10-23" } }),
    /52/
  );
  assert.throws(() => recurrenceDates({ ...rule, startDate: "2026-02-30" }));
});
test("a durable repeat identity creates copies once, preserves time, and is discoverable from any member", async () => {
  const f = fixture();
  const result = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    { operationId, rule },
    f.options
  );
  assert.equal(result.verified, true);
  assert.equal(f.posts(), 2);
  assert.equal(f.events.get("2").start_date_local, "2026-10-21T06:30:00");
  assert.equal(
    (await saveWorkoutRecurrence({}, f.request, "event:1", { operationId, rule }, f.options))
      .verified,
    true
  );
  assert.equal(f.posts(), 2);
  assert.equal((await loadWorkoutRecurrence({}, "event:2", f.options)).series.id, operationId);
  await assert.rejects(
    saveWorkoutRecurrence(
      {},
      f.request,
      "event:1",
      { operationId, rule: { ...rule, interval: 2 } },
      f.options
    ),
    (error) => error.status === 409
  );
});
test("lost provider responses resume without another POST and batches persist progress", async () => {
  const f = fixture();
  f.hide(true);
  f.lose(true);
  const pending = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    { operationId, rule },
    f.options
  );
  assert.equal(pending.verified, false);
  assert.equal(f.posts(), 1);
  const again = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    { operationId, rule },
    f.options
  );
  assert.equal(again.verified, false);
  assert.equal(f.posts(), 1);
  f.hide(false);
  f.lose(false);
  const recovered = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    { operationId, rule },
    { ...f.options, batchSize: 1 }
  );
  assert.equal(recovered.verified, false);
  assert.equal(f.posts(), 1);
  const done = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    { operationId, rule },
    f.options
  );
  assert.equal(done.verified, true);
  assert.equal(f.posts(), 2);
});
test("edits replace future dates while preserving independently edited and completed workouts", async () => {
  const f = fixture();
  const initial = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    { operationId, rule },
    f.options
  );
  f.events.get("2").name = "Individually changed";
  const changed = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    {
      operationId: nextId,
      revision: initial.series.revision,
      rule: { ...rule, interval: 3 },
    },
    f.options
  );
  assert.equal(changed.verified, true);
  assert.equal(changed.series.protectedCount, 1);
  assert.equal(f.events.get("2").name, "Individually changed");
  assert.equal(f.events.has("3"), false);
  assert.equal(f.events.size, 4);
  const completed = [...f.events.values()].find((event) =>
    event.start_date_local.startsWith("2026-10-23")
  );
  completed.paired_activity_id = "i123";
  const cancelled = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    {
      action: "cancel",
      operationId: cancelId,
      revision: changed.series.revision,
    },
    f.options
  );
  assert.equal(cancelled.verified, true);
  assert.equal(cancelled.series.status, "cancelled");
  assert.equal(f.events.has("1"), true);
  assert.equal(f.events.has("2"), true);
  assert.equal(f.events.has(String(completed.id)), true);
});
test("stale revisions, pending replacement, past dates and completed sources fail without new writes", async () => {
  const f = fixture();
  await saveWorkoutRecurrence({}, f.request, "event:1", { operationId, rule }, f.options);
  await assert.rejects(
    saveWorkoutRecurrence(
      {},
      f.request,
      "event:1",
      { operationId: nextId, revision: 0, rule },
      f.options
    ),
    (error) => error.status === 409
  );
  await assert.rejects(
    saveWorkoutRecurrence(
      {},
      f.request,
      "event:1",
      { operationId: nextId, rule: { ...rule, startDate: "2026-10-19" } },
      f.options
    )
  );
  assert.equal(f.posts(), 2);
  const g = fixture();
  g.events.get("1").paired_activity_id = "i123";
  await assert.rejects(
    saveWorkoutRecurrence({}, g.request, "event:1", { operationId, rule }, g.options),
    (error) => error.status === 403
  );
  assert.equal(g.posts(), 0);
});
test("concurrent schedule requests never create duplicate occurrences", async () => {
  const f = fixture();
  const settled = await Promise.allSettled(
    [1, 2, 3].map(() =>
      saveWorkoutRecurrence({}, f.request, "event:1", { operationId, rule }, f.options)
    )
  );
  assert.ok(settled.some((item) => item.status === "fulfilled"));
  assert.equal(f.posts(), 2);
  assert.equal(
    (await saveWorkoutRecurrence({}, f.request, "event:1", { operationId, rule }, f.options))
      .verified,
    true
  );
});

test("cross-midnight recovery reconciles attempted copies and expires unsent past dates", async () => {
  const f = fixture();
  f.hide(true);
  f.lose(true);
  await saveWorkoutRecurrence({}, f.request, "event:1", { operationId, rule }, f.options);
  assert.equal(f.posts(), 1);
  f.hide(false);
  f.lose(false);
  const recovered = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    { operationId, rule },
    {
      ...f.options,
      today: "2026-10-23",
    }
  );
  assert.equal(recovered.verified, true);
  assert.equal(f.posts(), 1);
  assert.equal(
    recovered.series.occurrences.find((item) => item.date === "2026-10-22").state,
    "expired"
  );
  const cancelled = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    {
      action: "cancel",
      operationId: cancelId,
      revision: recovered.series.revision,
    },
    { ...f.options, today: "2026-10-23" }
  );
  assert.equal(cancelled.verified, true);
  assert.equal(f.events.size, 2);
});

test("editing a series from a copied member keeps the original date unique", async () => {
  const f = fixture();
  const initial = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:1",
    { operationId, rule },
    f.options
  );
  const changed = await saveWorkoutRecurrence(
    {},
    f.request,
    "event:2",
    {
      operationId: nextId,
      revision: initial.series.revision,
      rule: { ...rule, interval: 2 },
    },
    f.options
  );
  assert.equal(changed.verified, true);
  assert.equal(
    [...f.events.values()].filter((event) => event.start_date_local.startsWith(rule.startDate))
      .length,
    1
  );
  assert.equal(f.events.has("2"), true);
});
