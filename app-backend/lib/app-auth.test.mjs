import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createAppAuth, authConfig } from "./app-auth.mjs";
import { createAuthStore } from "./app-auth-store.mjs";
import { memoryAuthStore, testAuthenticator } from "./auth-test-helpers.mjs";

const origin = "https://training.example.test";
const password = "fixture-password-only-1234567890";
const env = { APP_PASSWORD: password, APP_ORIGIN: origin, VERCEL: "1" };
function fixture({ store = memoryAuthStore(), environment = env } = {}) {
  let now = Date.now();
  const handler = createAppAuth({ env: () => environment, now: () => now, getStore: () => store });
  const jar = new Map();
  async function request(path, body, headers = {}, clientJar = jar) {
    const req = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
    Object.assign(req, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        host: "training.example.test",
        origin,
        "content-type": "application/json",
        cookie: [...clientJar].map(([key, value]) => `${key}=${value}`).join("; "),
        ...headers,
      },
    });
    let status, result, responseHeaders;
    const handled = await handler(
      req,
      {
        writeHead: (code, value) => {
          status = code;
          responseHeaders = value;
        },
        end: (value) => {
          result = JSON.parse(value);
        },
      },
      path
    );
    const cookieHeader = responseHeaders?.["Set-Cookie"];
    for (const cookie of cookieHeader
      ? Array.isArray(cookieHeader)
        ? cookieHeader
        : [cookieHeader]
      : []) {
      const [key, value] = cookie.split(";")[0].split("=");
      if (value) clientJar.set(key, value);
      else clientJar.delete(key);
    }
    return { status, result, headers: responseHeaders, handled, session: req.appSession };
  }
  return {
    request,
    jar,
    store,
    advance: (ms) => {
      now += ms;
    },
    handler,
  };
}
const auth = (name) => `/api/auth/${name}`;

test("app authentication blocks every API, fails closed and rejects hostile origins", async () => {
  const f = fixture();
  for (const route of [
    "config",
    "context",
    "activities/123/route",
    "coach/message",
    "annual-plans",
    "workouts/events",
  ])
    assert.equal((await f.request(`/api/${route}`)).status, 401);
  assert.equal(
    (await f.request(auth("password"), { password }, { origin: "https://evil.test" })).status,
    403
  );
  assert.equal(
    (await f.request(auth("password"), { password }, { host: "evil.test" })).status,
    403
  );
  assert.equal(
    (await f.request(auth("password"), { password }, { origin: undefined })).status,
    403
  );
  assert.equal(
    (
      await fixture({
        store: {
          read: async () => {
            throw new Error("secret provider body");
          },
        },
      }).request("/api/config")
    ).status,
    503
  );
  const missing = fixture({ environment: { ...env, APP_PASSWORD: "" } });
  assert.equal((await missing.request(auth("session"))).result.configured, false);
  assert.equal((await missing.request("/api/config")).status, 503);
});

test("remembered sessions survive a fresh server instance, expire, rotate and revoke on logout", async () => {
  const f = fixture();
  const login = await f.request(auth("password"), { password, remember: true });
  assert.equal(login.status, 200);
  assert.match(
    login.headers["Set-Cookie"][0],
    /HttpOnly; SameSite=Strict; Max-Age=7776000; Secure/
  );
  assert.ok(!JSON.stringify(login).includes(password));
  const oldJar = new Map(f.jar);
  const fresh = fixture({ store: f.store });
  assert.equal((await fresh.request("/api/config", undefined, {}, oldJar)).handled, false);
  await f.request(auth("password"), { password });
  assert.equal((await fresh.request("/api/config", undefined, {}, oldJar)).status, 401);
  const loggedOutJar = new Map(f.jar);
  await f.request(auth("logout"), {});
  assert.equal((await fresh.request("/api/config", undefined, {}, loggedOutJar)).status, 401);
  await f.request(auth("password"), { password });
  f.advance(90 * 86400000 + 1);
  assert.equal((await f.request("/api/config")).status, 401);
});

test("unremembered session has no persistent cookie; password change invalidates existing sessions", async () => {
  const f = fixture();
  const login = await f.request(auth("password"), { password, remember: false });
  assert.doesNotMatch(login.headers["Set-Cookie"][0], /Max-Age|Expires/);
  const other = fixture({
    store: f.store,
    environment: { ...env, APP_PASSWORD: `${password}-changed` },
  });
  assert.equal((await other.request("/api/config", undefined, {}, f.jar)).status, 401);
  f.advance(86400001);
  assert.equal((await f.request("/api/config")).status, 401);
});

test("password throttling is durable across instances and clears after the limit window", async () => {
  const f = fixture();
  const other = fixture({ store: f.store });
  for (let i = 0; i < 10; i++)
    assert.equal((await f.request(auth("password"), { password: "bad" })).status, 401);
  assert.equal((await other.request(auth("password"), { password })).status, 429);
  f.advance(900001);
  assert.equal((await f.request(auth("password"), { password })).status, 200);
});

async function enroll(f, device = testAuthenticator(origin, "training.example.test")) {
  await f.request(auth("password"), { password });
  const options = (await f.request(auth("passkeys/register/options"), {})).result;
  const result = await f.request(auth("passkeys/register/verify"), {
    response: device.registration(options),
    name: "Test device",
  });
  assert.equal(result.status, 200, JSON.stringify(result.result));
  return device;
}
test("real WebAuthn registration and signed authentication support passkeys, counters and removal", async () => {
  const f = fixture();
  const device = await enroll(f);
  assert.equal((await f.request(auth("session"))).result.hasPasskey, true);
  await f.request(auth("logout"), {});
  const options = (await f.request(auth("passkeys/authenticate/options"), { remember: true }))
    .result;
  const assertion = device.authentication(options, { userHandle: (await f.store.read()).userID });
  const signedIn = await f.request(auth("passkeys/authenticate/verify"), { response: assertion });
  assert.equal(signedIn.status, 200, JSON.stringify(signedIn.result));
  assert.equal(signedIn.result.authenticated, true);
  assert.equal((await f.store.read()).credentials[0].counter, 1);
  assert.equal((await f.request("/api/config")).handled, false);
  assert.equal(
    (await f.request(auth("passkeys/authenticate/verify"), { response: assertion })).status,
    400
  );
  const next = (await f.request(auth("passkeys/authenticate/options"), {})).result;
  assert.equal(
    (
      await f.request(auth("passkeys/authenticate/verify"), {
        response: device.authentication(next, { counter: 1 }),
      })
    ).status,
    400
  );
  await f.request(auth("passkeys/remove"), { id: signedIn.result.passkeys[0].id });
  assert.equal((await f.request(auth("session"))).result.hasPasskey, false);
});

test("registration needs recent authentication and rejects wrong origin, missing verification, expired or replayed challenges", async () => {
  const f = fixture();
  const device = testAuthenticator(origin, "training.example.test");
  assert.equal((await f.request(auth("passkeys/register/options"), {})).status, 403);
  await f.request(auth("password"), { password });
  for (const override of [{ site: "https://evil.test" }, { userVerified: false }]) {
    const options = (await f.request(auth("passkeys/register/options"), {})).result;
    const response = device.registration(options, override);
    assert.equal((await f.request(auth("passkeys/register/verify"), { response })).status, 400);
    assert.equal(
      (
        await f.request(auth("passkeys/register/verify"), {
          response: device.registration(options),
        })
      ).status,
      400
    );
  }
  const options = (await f.request(auth("passkeys/register/options"), {})).result;
  f.advance(300001);
  assert.equal(
    (await f.request(auth("passkeys/register/verify"), { response: device.registration(options) }))
      .status,
    400
  );
  f.advance(300000);
  assert.equal((await f.request(auth("passkeys/register/options"), {})).status, 403);
  assert.equal((await f.store.read()).credentials.length, 0);
});

test("passkey assertions reject tampering, another browser, missing UV, wrong origin/RP and user handle", async () => {
  const f = fixture();
  const device = await enroll(f);
  await f.request(auth("logout"), {});
  for (const override of [
    { site: "https://evil.test" },
    { userVerified: false },
    { userHandle: "wrong" },
    { tamper: true },
    { otherBrowser: true },
    { otherRP: true },
  ]) {
    const options = (await f.request(auth("passkeys/authenticate/options"), {})).result;
    const response = override.otherRP
      ? testAuthenticator(origin, "evil.test").authentication(options)
      : device.authentication(options, override);
    if (override.tamper) response.response.signature = Buffer.alloc(64).toString("base64url");
    const result = await f.request(
      auth("passkeys/authenticate/verify"),
      { response },
      {},
      override.otherBrowser ? new Map() : f.jar
    );
    assert.equal(result.status, 400, JSON.stringify(override));
    assert.equal((await f.request("/api/config")).status, 401);
  }
});

test("auth storage encrypts data, survives reload and handles compare-and-swap conflicts", async () => {
  const bootstrap = {
    SUPABASE_URL: "https://db.test",
    SUPABASE_SECRET_KEY: "sb_secret_fixture_only_12345678901234567890",
  };
  let row;
  const fetchImpl = async (url, options) => {
    const params = new URL(url).searchParams;
    let rows;
    if (options.method === "POST") {
      rows = row ? [] : JSON.parse(options.body);
      row ||= rows[0];
    } else if (options.method === "PATCH") {
      rows =
        row?.encrypted_value === params.get("encrypted_value")?.slice(3)
          ? [JSON.parse(options.body)]
          : [];
      if (rows.length) row = rows[0];
    } else rows = row ? [row] : [];
    // Snapshot before yielding simulates overlapping serverless requests.
    const snapshot = structuredClone(rows);
    await Promise.resolve();
    return { ok: true, json: async () => snapshot };
  };
  const a = createAuthStore(bootstrap, origin, fetchImpl),
    b = createAuthStore(bootstrap, origin, fetchImpl);
  await Promise.all([
    a.update((s) => {
      s.sessions.push({ id: "private-a" });
    }),
    b.update((s) => {
      s.sessions.push({ id: "private-b" });
    }),
  ]);
  assert.equal((await a.read()).sessions.length, 2);
  assert.doesNotMatch(JSON.stringify(row), /private-a|private-b|userID/);
  assert.deepEqual(await a.read(), await createAuthStore(bootstrap, origin, fetchImpl).read());
  await assert.rejects(
    createAuthStore({ ...bootstrap, SETTINGS_ENCRYPTION_KEY: "changed" }, origin, fetchImpl).read(),
    /could not be unlocked/
  );
});

test("deployment origins are fixed, localhost is supported and the existing coach password can be reused", () => {
  assert.equal(
    authConfig({ COACH_ACCESS_PASSWORD: password }, { headers: { host: "localhost:4173" } })
      .passkeysSupported,
    true
  );
  assert.equal(
    authConfig({ COACH_ACCESS_PASSWORD: password }, { headers: { host: "127.0.0.1:4173" } })
      .configured,
    true
  );
  assert.throws(() => authConfig({ VERCEL: "1" }, { headers: { host: "evil.test" } }));
});
