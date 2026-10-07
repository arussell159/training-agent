import test from "node:test";
import assert from "node:assert/strict";
import {
  createIntervalsOAuth,
  freshIntervalsOAuth,
  OAUTH_SCOPES,
  intervalsOrigin,
} from "./intervals-oauth.mjs";

function fixture(
  token = { access_token: "private-token", athlete: { id: "1" }, scope: OAUTH_SCOPES }
) {
  const record = freshIntervalsOAuth();
  let time = 1_000,
    calls = 0;
  const store = {
    read: async () => structuredClone(record),
    update: async (change) => change(record),
  };
  const oauth = createIntervalsOAuth({
    config: { INTERVALS_CLIENT_ID: "1250", INTERVALS_CLIENT_SECRET: "private-client-secret" },
    origin: "https://app.example",
    store,
    athlete: async () => ({ id: "1" }),
    now: () => time,
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(url, "https://intervals.icu/api/oauth/token");
      assert.equal(options.body.get("client_secret"), "private-client-secret");
      return Response.json(token);
    },
  });
  return {
    oauth,
    record,
    calls: () => calls,
    expire: () => {
      time += 600_001;
    },
  };
}
async function start(f) {
  const result = await f.oauth.start();
  const query = new URL(result.url).searchParams;
  assert.equal(query.get("scope"), OAUTH_SCOPES);
  assert.match(result.cookie, /HttpOnly; SameSite=Lax.*Secure/);
  query.set("code", "fixture-code");
  return { query, cookie: result.cookie.split(";")[0] };
}
test("OAuth binds callback to initiating browser, consumes state once, and never returns secrets", async () => {
  const f = fixture(),
    { query, cookie } = await start(f);
  await assert.rejects(f.oauth.callback(query, ""), /expired/);
  assert.equal(f.calls(), 0);
  assert.equal((await f.oauth.callback(query, cookie)).scopesComplete, true);
  await assert.rejects(f.oauth.callback(query, cookie), /already used/);
  assert.equal(f.calls(), 1);
  assert.equal(f.record.connection.token, "private-token");
  const status = await f.oauth.status();
  assert.equal(status.oauthConnected, true);
  assert.equal(JSON.stringify(status).includes("private"), false);
});
test("expired state and wrong athletes cannot establish a webhook connection", async () => {
  const f = fixture(),
    first = await start(f);
  f.expire();
  await assert.rejects(f.oauth.callback(first.query, first.cookie), /expired/);
  assert.equal(f.calls(), 0);
  const wrong = fixture({ access_token: "token", athlete: { id: "2" }, scope: OAUTH_SCOPES }),
    second = await start(wrong);
  await assert.rejects(wrong.oauth.callback(second.query, second.cookie), /same athlete/);
  assert.equal(wrong.record.connection, undefined);
});
test("declined consent avoids token exchange and missing scopes stay visible", async () => {
  const f = fixture(),
    { query, cookie } = await start(f);
  query.set("error", "access_denied");
  await assert.rejects(f.oauth.callback(query, cookie), /declined/);
  assert.equal(f.calls(), 0);
  const partial = fixture({ access_token: "token", athlete: { id: "1" }, scope: "ACTIVITY:READ" }),
    p = await start(partial);
  assert.equal((await partial.oauth.callback(p.query, p.cookie)).scopesComplete, false);
  assert.equal((await partial.oauth.status()).scopesComplete, false);
});
test("production OAuth origins cannot be derived from an untrusted Host", () => {
  assert.throws(() => intervalsOrigin({ VERCEL: "1" }, { headers: { host: "evil.example" } }));
  assert.equal(
    intervalsOrigin({ APP_ORIGIN: "https://app.example" }, { headers: {} }),
    "https://app.example"
  );
  assert.throws(() => intervalsOrigin({ APP_ORIGIN: "https://app.example/path" }, { headers: {} }));
});
