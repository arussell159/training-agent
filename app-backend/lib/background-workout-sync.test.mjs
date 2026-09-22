import test from "node:test";
import assert from "node:assert/strict";
import { createBackgroundWorkoutSync } from "../../ui/src/lib/background-workout-sync.mjs";

function fixture() {
  const counts = { issue: 0, probe: 0, imports: 0, edits: 0 };
  let hasNew = false;
  const sync = createBackgroundWorkoutSync({
    issue: async () => {
      counts.issue++;
      return { probe: { token: "before" } };
    },
    probe: async (token) => {
      counts.probe++;
      return { changed: hasNew && token === "before" };
    },
    importWorkouts: async () => {
      counts.imports++;
      return { context: {}, probe: { token: "after" } };
    },
    flushEdits: async () => {
      counts.edits++;
      return {};
    },
  });
  return {
    sync,
    counts,
    add: () => {
      hasNew = true;
    },
  };
}
test("1000 idle checks issue one startup lease and never import/write", async () => {
  const { sync, counts } = fixture();
  await sync.start();
  for (let i = 0; i < 1000; i++) await sync.check();
  assert.deepEqual(counts, { issue: 1, probe: 1000, imports: 0, edits: 0 });
});
test("new workout imports once, then all following checks remain read-only hints", async () => {
  const { sync, counts, add } = fixture();
  await sync.start();
  add();
  await sync.check();
  for (let i = 0; i < 50; i++) await sync.check();
  assert.equal(counts.imports, 1);
  assert.equal(counts.issue, 1);
});
test("concurrent checks share a single operation", async () => {
  const { sync, counts, add } = fixture();
  await sync.start();
  add();
  await Promise.all([sync.check(), sync.check(), sync.check()]);
  assert.equal(counts.imports, 1);
});
test("expired probe pauses without periodic auth/DB lease renewal", async () => {
  let issue = 0,
    imports = 0;
  const sync = createBackgroundWorkoutSync({
    issue: async () => {
      issue++;
      return { probe: { token: "a" } };
    },
    probe: async () => ({ paused: true }),
    importWorkouts: async () => {
      imports++;
    },
    flushEdits: async () => {},
  });
  await sync.start();
  await assert.rejects(sync.check());
  for (let i = 0; i < 10; i++) await sync.check();
  assert.equal(issue, 1);
  assert.equal(imports, 0);
});
test("source failure never falls back to heavy database sync", async () => {
  let imports = 0;
  const sync = createBackgroundWorkoutSync({
    issue: async () => ({ probe: { token: "a" } }),
    probe: async () => {
      throw Error("source unavailable");
    },
    importWorkouts: async () => {
      imports++;
    },
    flushEdits: async () => {},
  });
  await sync.start();
  await assert.rejects(sync.check());
  assert.equal(imports, 0);
});
test("explicit edits remain usable and do not need a new-workout signal", async () => {
  const { sync, counts } = fixture();
  await sync.start();
  await sync.edit();
  assert.equal(counts.edits, 1);
  assert.equal(counts.imports, 0);
});
test("failed bootstrap is not retried by the timer", async () => {
  let calls = 0;
  const sync = createBackgroundWorkoutSync({
    issue: async () => {
      calls++;
      throw Error("offline");
    },
    probe: async () => {},
    importWorkouts: async () => {},
    flushEdits: async () => {},
  });
  await assert.rejects(sync.start());
  for (let i = 0; i < 10; i++) await sync.check();
  assert.equal(calls, 1);
});
test("failed imports stop after three attempts rather than loop forever", async () => {
  let calls = 0;
  const sync = createBackgroundWorkoutSync({
    issue: async () => ({ probe: { token: "a" } }),
    probe: async () => ({ changed: true }),
    importWorkouts: async () => {
      calls++;
      throw Error("offline");
    },
    flushEdits: async () => {},
  });
  await sync.start();
  for (let i = 0; i < 3; i++) await assert.rejects(sync.check());
  await sync.check();
  assert.equal(calls, 3);
});
test("a missing replacement lease stops retries after a successful import", async () => {
  let calls = 0;
  const sync = createBackgroundWorkoutSync({
    issue: async () => ({ probe: { token: "a" } }),
    probe: async () => ({ changed: true }),
    importWorkouts: async () => {
      calls++;
      return { context: {} };
    },
    flushEdits: async () => {},
  });
  await sync.start();
  await assert.rejects(sync.check());
  await sync.check();
  assert.equal(calls, 1);
});
test("an import with no confirmed new ID pauses instead of hammering the database", async () => {
  let calls = 0;
  const sync = createBackgroundWorkoutSync({
    issue: async () => ({ probe: { token: "a", baseline: "same" } }),
    probe: async () => ({ changed: true }),
    importWorkouts: async () => {
      calls++;
      return { context: {}, probe: { token: "b", baseline: "same" } };
    },
    flushEdits: async () => {},
  });
  await sync.start();
  await assert.rejects(sync.check());
  await sync.check();
  assert.equal(calls, 1);
});
