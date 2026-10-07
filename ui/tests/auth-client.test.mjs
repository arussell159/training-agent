import test from "node:test";
import assert from "node:assert/strict";
import { authRequest } from "../src/lib/app-auth.ts";

const session = {
  configured: true,
  authenticated: true,
  hasPasskey: false,
  passkeysSupported: false,
};
const json = (value) =>
  new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

test('early HTML session verification is consumed once and still validated', async (t) => {
  const previous = globalThis.window;
  globalThis.window = { __trainingSessionRequest: Promise.resolve(json(session)) };
  t.after(() => { if (previous === undefined) delete globalThis.window; else globalThis.window = previous; });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return json(session); });
  assert.deepEqual(await authRequest('session'), session);
  assert.equal(calls, 0);
  assert.equal(window.__trainingSessionRequest, undefined);
  await authRequest('session'); assert.equal(calls, 1);
  window.__trainingSessionRequest = Promise.resolve(json({ authenticated: true }));
  await assert.rejects(authRequest('session'), /invalid session/);
});

test("concurrent session checks share one request but a settled result is never cached", async (t) => {
  let finish,
    calls = 0;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const a = authRequest("session"),
    b = authRequest("session");
  assert.equal(calls, 1);
  finish(json(session));
  assert.deepEqual(await a, session);
  assert.deepEqual(await b, session);
  const next = authRequest("session");
  assert.equal(calls, 2);
  finish(json({ ...session, authenticated: false }));
  assert.equal((await next).authenticated, false);
});

test("a login or logout detaches older pending session reads", async (t) => {
  const requests = [];
  t.mock.method(
    globalThis,
    "fetch",
    (url, options) => new Promise((resolve) => requests.push({ url, options, resolve }))
  );
  const old = authRequest("session");
  const logout = authRequest("logout", {});
  const current = authRequest("session");
  assert.equal(requests.length, 3);
  requests[1].resolve(json({ ok: true }));
  requests[2].resolve(json({ ...session, authenticated: false }));
  requests[0].resolve(json(session));
  await logout;
  assert.equal((await current).authenticated, false);
  assert.equal((await old).authenticated, true);
});

test("malformed sessions and non-JSON responses fail clearly and allow retry", async (t) => {
  t.mock.method(globalThis, "fetch", async () => json({ authenticated: true }));
  await assert.rejects(authRequest("session"), /invalid session/);
  globalThis.fetch = async () => new Response("<html>upstream unavailable</html>", { status: 502 });
  await assert.rejects(authRequest("session"), /invalid response/);
  globalThis.fetch = async () => json(session);
  assert.deepEqual(await authRequest("session"), session);
});

test("stalled response bodies time out and the next session check starts fresh", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let signal;
  t.mock.method(globalThis, "fetch", async (_, options) => {
    signal = options.signal;
    return { ok: true, json: () => new Promise(() => {}) };
  });
  const pending = authRequest("session");
  const rejection = assert.rejects(pending, /took too long/);
  await Promise.resolve();
  t.mock.timers.tick(20_000);
  await rejection;
  assert.equal(signal.aborted, true);
  globalThis.fetch = async () => json(session);
  assert.deepEqual(await authRequest("session"), session);
});

test("malformed optional authentication metadata cannot reach settings controls", async (t) => {
  for (const metadata of [
    { passkeys: {} },
    { passkeys: [null] },
    { passkeys: [{ id: "one", name: "key", created: "yesterday" }] },
    { verifiedAt: "today" },
    { expiresAt: null },
    { remember: "false" },
    { recentlyVerified: 1 },
  ]) {
    t.mock.method(globalThis, "fetch", async () => json({ ...session, ...metadata }));
    await assert.rejects(authRequest("session"), /invalid session/);
  }
  globalThis.fetch = async () => json({ ...session, passkeys: [], verifiedAt: 0, remember: false });
  assert.deepEqual(await authRequest("session"), {
    ...session,
    passkeys: [],
    verifiedAt: 0,
    remember: false,
  });
  globalThis.fetch = async () =>
    json({ ...session, passkeys: [{ id: "legacy-key", name: "Existing passkey" }] });
  assert.equal((await authRequest("session")).passkeys[0].name, "Existing passkey");
});
