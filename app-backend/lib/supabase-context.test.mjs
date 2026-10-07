import { test } from "node:test";
import assert from "node:assert/strict";
import { createContextStore } from "./supabase-context.mjs";

const config = (project) => ({
  SUPABASE_URL: `https://${project}.supabase.co`,
  SUPABASE_SECRET_KEY: "sb_secret_mock_context_abcdefghijklmnopqrstuvwxyz",
});
const response = (value) => ({ ok: true, text: async () => JSON.stringify(value) });

test("context reads coalesce across store instances and return independent copies", async () => {
  let calls = 0,
    complete;
  const fetchImpl = () => {
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  const a = createContextStore(config("context-coalesce"), undefined, fetchImpl);
  const b = createContextStore(config("context-coalesce"), undefined, fetchImpl);
  const first = a.getSyncRecord("row"),
    second = b.getSyncRecord("row");
  assert.equal(calls, 1);
  complete(response([{ cursor: { nested: { count: 1 } } }]));
  const [x, y] = await Promise.all([first, second]);
  x.nested.count = 2;
  assert.equal(y.nested.count, 1);
  assert.equal((await a.getSyncRecord("row")).nested.count, 1);
  assert.equal(calls, 1);
});

test("context writes invalidate only their project, including overlapping reads", async () => {
  let calls = 0,
    complete;
  const fetchImpl = async (url, options) => {
    if (options.method === "POST")
      return new Promise((resolve) => {
        complete = resolve;
      });
    return response([{ cursor: { count: ++calls } }]);
  };
  const a = createContextStore(config("context-write-a"), undefined, fetchImpl);
  const b = createContextStore(config("context-write-b"), undefined, fetchImpl);
  assert.equal((await a.getSyncRecord("row")).count, 1);
  assert.equal((await b.getSyncRecord("row")).count, 2);
  const writing = a.upsert("sync_state", []);
  assert.equal((await a.getSyncRecord("row")).count, 3);
  assert.equal((await b.getSyncRecord("row")).count, 2);
  complete({ ok: true, text: async () => "" });
  await writing;
  assert.equal((await a.getSyncRecord("row")).count, 4);
  assert.equal((await b.getSyncRecord("row")).count, 2);
});

test("database errors do not expose provider response bodies and remain retryable", async () => {
  let calls = 0;
  const store = createContextStore(config("context-errors"), undefined, async () => {
    if (++calls === 1)
      return {
        ok: false,
        status: 503,
        text: async () => {
          throw Error("Private diagnostic must not be read");
        },
      };
    return response([{ cursor: { recovered: true } }]);
  });
  await assert.rejects(store.getSyncRecord("row"), /request failed \(503\)/);
  assert.deepEqual(await store.getSyncRecord("row"), { recovered: true });
  assert.equal(calls, 2);
});
