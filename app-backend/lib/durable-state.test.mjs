import test from "node:test";
import assert from "node:assert/strict";
import { createDurableState } from "./durable-state.mjs";

test("legacy file is migrated once and the database wins over stale local cache", async () => {
  const rows = {};
  let cacheReads = 0;
  const getStore = async () => ({
    read: async () => ({ ...rows }),
    save: async (patch) => Object.assign(rows, patch),
  });
  const state = createDurableState({
    getStore,
    readFile: async () => {
      cacheReads++;
      return '{"saved":1}';
    },
  });
  assert.deepEqual(await state.read("APP_DATA", "cache", null), { saved: 1 });
  await state.write("APP_DATA", { saved: 2 });
  const fresh = createDurableState({ getStore, readFile: async () => '{"saved":999}' });
  assert.deepEqual(await fresh.read("APP_DATA", "cache", null), { saved: 2 });
  assert.equal(cacheReads, 1);
});

test("failed database write never succeeds locally; cache failure does not undo a database save", async () => {
  let cacheWrites = 0;
  const failing = createDurableState({
    getStore: async () => ({
      save: async () => {
        throw new Error("Database unavailable");
      },
    }),
    writeFile: async () => {
      cacheWrites++;
    },
  });
  await assert.rejects(failing.write("APP_DATA", { saved: 1 }, "cache"), /Database unavailable/);
  assert.equal(cacheWrites, 0);
  let saved = false;
  const working = createDurableState({
    getStore: async () => ({
      save: async () => {
        saved = true;
      },
    }),
    writeFile: async () => {
      throw new Error("Read-only cache");
    },
  });
  await working.write("APP_DATA", { saved: 2 }, "cache");
  assert.equal(saved, true);
});
