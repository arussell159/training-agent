import test from "node:test";
import assert from "node:assert/strict";
import { createTrainingUpdates } from "./training-updates.mjs";
import { fetchIntervalsContext } from "./intervals.mjs";
import { contentFingerprint } from "./content-fingerprint.mjs";
import { prepareFastView } from "./fast-context.mjs";
import { retainRecentTrainingContext } from "./training-retention.mjs";

const clock = new Date("2026-10-06T18:00:00Z");
const range = { start: "2026-09-29", end: "2026-12-05" };
const config = { INTERVALS_API_KEY: "fixture" };

test("historical edits and deletions invalidate pushed versions without retaining old workout data", async () => {
  const f = await fixture();
  let saved = f.saved,
    name = "Historical run",
    removed = false;
  const check = createTrainingUpdates({
    readSnapshot: async () => saved,
    request: () => async (path) =>
      path.includes("/activities?") && !removed
        ? [
            {
              id: "old",
              type: "Run",
              name,
              start_date_local: "2012-02-29T08:00:00",
              moving_time: 1800,
              distance: 5000,
            },
          ]
        : [],
    persist: async (_config, next) => {
      saved = retainRecentTrainingContext(next, clock);
    },
    warm: async () => {},
    exportGithub: async () => {},
    waitUntil: () => {},
    now: () => clock,
  });
  const options = { durable: true, full: true, hints: [{ id: "old", date: "2012-02-29" }] };
  const first = await check(config, options);
  assert.match(saved.history_revision, /^[a-f0-9]{64}$/);
  assert.equal(saved.history.length, 0);
  assert.equal(first.context.history.length, 0);
  assert.equal(first.context.history_revision, saved.history_revision);
  const duplicate = await check(config, options);
  assert.equal(duplicate.context.version, first.context.version);
  assert.equal(duplicate.sourceChanged, false);
  name = "Corrected historical run";
  const edited = await check(config, options);
  assert.notEqual(edited.context.version, first.context.version);
  assert.equal(saved.history.length, 0);
  removed = true;
  const deleted = await check(config, options);
  assert.notEqual(deleted.context.version, edited.context.version);
  assert.equal(saved.history.length, 0);
  assert.equal(
    saved.cached_ranges.some((range) => range.start < "2026-01-01"),
    false
  );
});

test("a workout webhook refreshes the affected three days, without reloading profile or annual races", async () => {
  const f = await fixture();
  f.complete();
  const tasks = [];
  const check = createTrainingUpdates({
    readSnapshot: async (_config, options) => {
      assert.equal(options.fresh, true, "targeted jobs must merge the newest durable snapshot");
      return f.saved;
    },
    request: () => f.request,
    persist: async () => {},
    warm: async () => {},
    exportGithub: async () => {},
    waitUntil: (task) => tasks.push(task),
    now: () => clock,
  });
  const result = await check(config, {
    durable: true,
    full: true,
    hints: [{ id: "i10", date: "2026-10-06" }],
  });
  assert.equal(result.context.history[0].activity_id, "i10");
  assert.equal(f.calls.length, 4);
  assert.ok(f.calls.every((path) => path !== "/athlete/0"));
  assert.ok(
    f.calls.some((path) => path === "/athlete/0/activities?oldest=2026-10-05&newest=2026-10-07")
  );
  assert.ok(
    f.calls.some((path) => path === "/athlete/0/wellness?oldest=2026-10-05&newest=2026-10-07")
  );
  await Promise.all(tasks);
});

test("provider ordering of same-day planned workouts does not trigger an export", () => {
  const a = { id: "event:1", workout_date: "2026-10-10", title: "Run", completed: false };
  const b = { id: "event:2", workout_date: "2026-10-10", title: "Swim", completed: false };
  const context = { athlete: { id: "1" }, history: [], planned: [a, b] };
  assert.equal(
    prepareFastView(config, context).version,
    prepareFastView(config, { ...context, planned: [b, a] }).version
  );
});
async function fixture() {
  let activities = [];
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path === "/athlete/0") return { id: "1", name: "Athlete", sportSettings: [] };
    if (path.includes("/activities?")) return activities;
    return [];
  };
  const saved = await fetchIntervalsContext(request, { range, now: clock });
  calls.length = 0;
  return {
    saved,
    calls,
    request,
    complete: () => {
      activities = [
        {
          id: "i10",
          type: "Run",
          name: "New run",
          start_date_local: "2026-10-06T12:00:00",
          moving_time: 1800,
          distance: 5000,
        },
      ];
    },
  };
}
test("opening checks new workouts directly and returns before database writes finish", async () => {
  const f = await fixture();
  f.complete();
  const gate = Promise.withResolvers(),
    tasks = [];
  let persisted = 0;
  const check = createTrainingUpdates({
    readSnapshot: async () => f.saved,
    request: () => f.request,
    persist: async () => {
      persisted++;
      await gate.promise;
    },
    warm: async () => {},
    waitUntil: (task) => tasks.push(task),
    now: () => clock,
  });
  const [a, b] = await Promise.all([check(config), check(config)]);
  assert.equal(a.context.history[0].activity_id, "i10");
  assert.equal(a.sourceChanged, true);
  assert.deepEqual(a, b);
  assert.equal(f.calls.length, 6);
  assert.equal(f.calls.filter((path) => path === "/athlete/0").length, 1);
  assert.equal(persisted, 1);
  gate.resolve();
  await tasks[0];
});
test("unchanged foreground checks do not write training data", async () => {
  const f = await fixture(),
    tasks = [];
  let writes = 0;
  const check = createTrainingUpdates({
    readSnapshot: async () => f.saved,
    request: () => f.request,
    persist: async () => {
      writes++;
    },
    warm: async () => {},
    exportGithub: async () => {},
    waitUntil: (task) => tasks.push(task),
    now: () => clock,
  });
  const result = await check(config);
  await tasks[0];
  assert.equal(result.sourceChanged, false);
  assert.equal(writes, 0);
});

test("database JSON key ordering does not trigger another write or invalidate recordings", async () => {
  const f = await fixture();
  f.complete();
  const saved = await fetchIntervalsContext(f.request, { range, now: clock });
  const reordered = JSON.parse(
    JSON.stringify(saved, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, value[key]])
          )
        : value
    )
  );
  assert.equal(contentFingerprint(saved), contentFingerprint(reordered));
  const tasks = [];
  let writes = 0;
  const check = createTrainingUpdates({
    readSnapshot: async () => reordered,
    request: () => f.request,
    persist: async () => {
      writes++;
    },
    warm: async () => {},
    exportGithub: async () => {},
    waitUntil: (task) => tasks.push(task),
    now: () => clock,
  });
  const result = await check(config);
  await tasks[0];
  assert.equal(result.sourceChanged, false);
  assert.equal(writes, 0);
});

test("webhook reconciliation refreshes the full retained window and waits for persistence", async () => {
  const f = await fixture();
  f.complete();
  const gate = Promise.withResolvers();
  let finished = false;
  const tasks = [];
  const check = createTrainingUpdates({
    readSnapshot: async () => f.saved,
    request: () => f.request,
    persist: () => gate.promise,
    warm: async () => {},
    exportGithub: async () => {},
    waitUntil: (task) => tasks.push(task),
    now: () => clock,
  });
  const result = check(config, { durable: true, full: true }).then((value) => {
    finished = true;
    return value;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(finished, false);
  assert.ok(
    f.calls.some((path) => path.includes("/activities?oldest=2026-07-09")),
    "old retained activities must be reconciled too"
  );
  gate.resolve();
  assert.equal((await result).sourceChanged, true);
  await Promise.all(tasks);
});

test("failed durable persistence rejects the webhook job instead of acknowledging success", async () => {
  const f = await fixture();
  const check = createTrainingUpdates({
    readSnapshot: async () => f.saved,
    request: () => f.request,
    persist: async () => {
      throw Error("save unavailable");
    },
    warm: async () => {},
    exportGithub: async () => {},
    waitUntil: () => {},
    now: () => clock,
  });
  await assert.rejects(check(config, { durable: true, full: true }), /save unavailable/);
});
