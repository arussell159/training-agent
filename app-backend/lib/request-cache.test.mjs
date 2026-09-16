import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestCache } from "./request-cache.mjs";
test("read cache deduplicates concurrent requests, isolates accounts and expires", async () => {
  let calls = 0,
    time = 0;
  const cache = createRequestCache({ ttl: 10, now: () => time });
  const source = async () => {
    calls++;
    return { value: 1 };
  };
  const a = cache.wrap(source, "a"),
    b = cache.wrap(source, "b");
  const [x, y] = await Promise.all([a("/x"), a("/x")]);
  x.value = 2;
  assert.equal(y.value, 1);
  assert.equal(calls, 1);
  await b("/x");
  assert.equal(calls, 2);
  time = 11;
  await a("/x");
  assert.equal(calls, 3);
});
test("writes invalidate cached reads and failures are retryable", async () => {
  let calls = 0;
  const cache = createRequestCache();
  const r = cache.wrap(async () => {
    calls++;
    return calls;
  }, "a");
  await r("/x");
  await r("/x", { method: "PUT" });
  assert.equal(await r("/x"), 3);
  let attempts = 0;
  const failing = cache.wrap(async () => {
    if (++attempts === 1) throw Error("retry");
    return 1;
  }, "b");
  await assert.rejects(failing("/x"));
  assert.equal(await failing("/x"), 1);
});
