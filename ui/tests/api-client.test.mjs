import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = new EventTarget();
const { apiFetch, setApiAuthenticated } = await import("../src/lib/api-client.ts");
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

test('calendar validation and push recovery share an overlapping version check', async (t) => {
  let finish, calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; return new Promise(resolve => { finish = resolve; }); });
  setApiAuthenticated(true, true);
  const a = apiFetch('/api/training-updates?version=one');
  const b = apiFetch('/api/training-updates?version=one');
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(json({ unchanged: true, version: 'one' }));
  for (const response of await Promise.all([a, b])) assert.equal((await response.json()).unchanged, true);
});

test("a late 401 from a previous session cannot sign out the current session", async (t) => {
  let finish,
    expired = 0;
  const onExpired = () => expired++;
  window.addEventListener("app-auth-required", onExpired);
  t.after(() => window.removeEventListener("app-auth-required", onExpired));
  t.mock.method(
    globalThis,
    "fetch",
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  setApiAuthenticated(true);
  const old = apiFetch("/api/config");
  await Promise.resolve();
  setApiAuthenticated(false);
  setApiAuthenticated(true);
  finish(json({ error: "Expired old session" }, 401));
  assert.equal((await old).status, 401);
  assert.equal(expired, 0);
  globalThis.fetch = async () => json({ current: true });
  assert.equal((await apiFetch("/api/config")).status, 200);
});

test("overlapping shell reads share transport, have independent bodies, and do not cache settled data", async (t) => {
  let finish,
    calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  setApiAuthenticated(true);
  const first = apiFetch("/api/annual-plans"),
    second = apiFetch("/api/annual-plans");
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(json({ plans: [] }));
  const replies = await Promise.all([first, second]);
  assert.deepEqual(await replies[0].json(), { plans: [] });
  assert.deepEqual(await replies[1].json(), { plans: [] });
  const next = apiFetch("/api/annual-plans");
  await Promise.resolve();
  assert.equal(calls, 2);
  finish(json({ plans: ["changed"] }));
  assert.deepEqual(await (await next).json(), { plans: ["changed"] });
});

test("a current 401 closes the session once, and anonymous calls do not fetch", async (t) => {
  let calls = 0,
    expired = 0;
  const onExpired = () => expired++;
  window.addEventListener("app-auth-required", onExpired);
  t.after(() => window.removeEventListener("app-auth-required", onExpired));
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return json({}, 401);
  });
  setApiAuthenticated(true);
  await apiFetch("/api/config");
  await apiFetch("/api/config");
  assert.equal(expired, 1);
  assert.equal(calls, 1);
});

test("cancelling one shared reader leaves the other reader alive", async (t) => {
  let finish,
    transportSignal,
    calls = 0;
  t.mock.method(globalThis, "fetch", (_url, options) => {
    calls++;
    transportSignal = options.signal;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  setApiAuthenticated(true, true);
  const controller = new AbortController();
  const first = apiFetch("/api/config", { signal: controller.signal });
  const rejection = assert.rejects(first, { name: "AbortError" });
  const second = apiFetch("/api/config");
  await Promise.resolve();
  controller.abort();
  await rejection;
  assert.equal(calls, 1);
  assert.equal(transportSignal.aborted, false);
  finish(json({ theme: "dark" }));
  assert.deepEqual(await (await second).json(), { theme: "dark" });
});

test("shared reads isolate different headers and normalize equivalent header order", async (t) => {
  let calls = 0;
  const replies = [];
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return new Promise((resolve) => {
      replies.push(resolve);
    });
  });
  setApiAuthenticated(true, true);
  const first = apiFetch("/api/config", {
    headers: { "X-Fixture": "one", Accept: "application/json" },
  });
  const same = apiFetch("/api/config", {
    headers: [
      ["accept", "application/json"],
      ["x-fixture", "one"],
    ],
  });
  const different = apiFetch("/api/config", {
    headers: { "X-Fixture": "two", Accept: "application/json" },
  });
  await Promise.resolve();
  assert.equal(calls, 2);
  replies[0](json({ fixture: "one" }));
  replies[1](json({ fixture: "two" }));
  const responses = await Promise.all([first, same, different]);
  assert.deepEqual(await Promise.all(responses.map((response) => response.json())), [
    { fixture: "one" },
    { fixture: "one" },
    { fixture: "two" },
  ]);
});

test("aborted requests and external URLs never reach the transport", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => {
    calls++;
    return json({});
  });
  setApiAuthenticated(true);
  await assert.rejects(apiFetch("https://example.com/api/config"), /local API/);
  await assert.rejects(apiFetch("/api/\\example.com"), /local API/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(apiFetch("/api/config", { signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(calls, 0);
});

test("changing the connection invalidates private caches even if browser storage is blocked", async (t) => {
  let resets = 0;
  const reset = () => resets++;
  window.addEventListener("training-cache-reset", reset);
  t.after(() => window.removeEventListener("training-cache-reset", reset));
  t.mock.method(globalThis, "fetch", async () => json({ saved: true }));
  setApiAuthenticated(true);
  await apiFetch("/api/config", {
    method: "POST",
    body: JSON.stringify({ INTERVALS_API_KEY: "" }),
  });
  assert.equal(resets, 1);
});

test("a connection change discards activity responses issued for the previous provider", async (t) => {
  let completeActivity, activityStarted;
  const entered = new Promise((resolve) => {
    activityStarted = resolve;
  });
  t.mock.method(globalThis, "fetch", (url) => {
    if (url.includes("activities")) {
      activityStarted();
      return new Promise((resolve) => {
        completeActivity = resolve;
      });
    }
    return Promise.resolve(json({ saved: true }));
  });
  setApiAuthenticated(true);
  const previousProvider = apiFetch("/api/activities/i100/summary");
  await entered;
  assert.equal(
    (
      await apiFetch("/api/config", {
        method: "POST",
        body: JSON.stringify({ INTERVALS_API_KEY: "new-fixture-connection" }),
      })
    ).status,
    200
  );
  completeActivity(json({ name: "Previous provider workout" }));
  assert.equal((await previousProvider).status, 401);
});
