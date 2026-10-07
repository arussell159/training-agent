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

test("slow pending reads remain deduplicated and their TTL starts on completion", async () => {
  let time = 0,
    calls = 0,
    complete;
  const cache = createRequestCache({ ttl: 10, now: () => time });
  const request = cache.wrap(() => {
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  }, "slow");
  const first = request("/slow");
  await Promise.resolve();
  time = 100;
  const second = request("/slow");
  await Promise.resolve();
  assert.equal(calls, 1);
  complete({ count: 1 });
  await Promise.all([first, second]);
  time = 109;
  assert.deepEqual(await request("/slow"), { count: 1 });
  assert.equal(calls, 1);
});

test("a cancelled subscriber cannot cancel another reader or populate it with an error", async () => {
  let complete,
    calls = 0;
  const cache = createRequestCache();
  const request = cache.wrap((path, options) => {
    calls++;
    assert.equal(options.signal, undefined);
    return new Promise((resolve) => {
      complete = resolve;
    });
  }, "cancellation");
  const controller = new AbortController();
  const cancelled = request("/shared", { signal: controller.signal });
  const active = request("/shared");
  await Promise.resolve();
  controller.abort();
  await assert.rejects(cancelled, { name: "AbortError" });
  complete({ retained: true });
  assert.deepEqual(await active, { retained: true });
  assert.deepEqual(await request("/shared"), { retained: true });
  assert.equal(calls, 1);
  await assert.rejects(request("/other", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(calls, 1);
});

test("writes preserve other accounts and invalidate reads that overlap the write", async () => {
  const cache = createRequestCache();
  let calls = 0,
    finishWrite;
  const source = async (path, options) => {
    if (options.method === "PUT")
      return new Promise((resolve) => {
        finishWrite = resolve;
      });
    return ++calls;
  };
  const a = cache.wrap(source, "account-a"),
    b = cache.wrap(source, "account-b");
  assert.equal(await a("/x"), 1);
  assert.equal(await b("/x"), 2);
  const writing = a("/x", { method: "PUT" });
  assert.equal(await a("/x"), 3);
  assert.equal(await b("/x"), 2);
  finishWrite(null);
  await writing;
  assert.equal(await a("/x"), 4);
  assert.equal(await b("/x"), 2);
});

test("custom request options never reuse a different representation", async () => {
  const request = createRequestCache().wrap(
    async (path, options) => options.headers?.Accept || "default",
    "options"
  );
  assert.equal(await request("/x"), "default");
  assert.equal(await request("/x", { headers: { Accept: "text/plain" } }), "text/plain");
  assert.equal(
    await request("/x", { headers: { Accept: "application/json" } }),
    "application/json"
  );
  assert.equal(await request("/x"), "default");
});
