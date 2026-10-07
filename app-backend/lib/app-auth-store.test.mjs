import { test } from "node:test";
import assert from "node:assert/strict";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";

const bootstrap = {
  SUPABASE_URL: "https://auth-cache-fixture.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_fixture_cache_abcdefghijklmnopqrstuvwxyz",
};
function database() {
  const rows = new Map();
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    const params = new URL(url).searchParams;
    if (options.method === "POST") {
      const [row] = JSON.parse(options.body);
      rows.set(`${row.scope}:${row.name}`, row);
      return { ok: true, json: async () => [row] };
    }
    const scope = params.get("scope").slice(3),
      name = params.get("name").slice(3);
    const row = rows.get(`${scope}:${name}`);
    if (options.method === "PATCH") {
      const updated = JSON.parse(options.body);
      if (row?.encrypted_value !== params.get("encrypted_value")?.slice(3))
        return { ok: true, json: async () => [] };
      rows.set(`${scope}:${name}`, updated);
      return { ok: true, json: async () => [updated] };
    }
    return { ok: true, json: async () => (row ? [row] : []) };
  };
  return { fetchImpl, calls: () => calls };
}

test("cached encrypted records isolate record names within a namespace", async () => {
  const db = database();
  const options = { namespace: "name-isolation", readCacheMs: 15000 };
  const a = createEncryptedRecordStore(
    bootstrap,
    "same-identity",
    { ...options, name: "A", fresh: () => ({ kind: "a" }) },
    db.fetchImpl
  );
  const b = createEncryptedRecordStore(
    bootstrap,
    "same-identity",
    { ...options, name: "B", fresh: () => ({ kind: "b" }) },
    db.fetchImpl
  );
  assert.deepEqual(await a.read(), { kind: "a" });
  assert.deepEqual(await b.read(), { kind: "b" });
  assert.equal(db.calls(), 2);
});

test("changing the encryption key cannot reuse a previously decoded cache value", async () => {
  const db = database();
  const options = {
    namespace: "key-isolation",
    name: "STATE",
    fresh: () => ({ count: 0 }),
    readCacheMs: 15000,
  };
  const a = createEncryptedRecordStore(bootstrap, "key-test", options, db.fetchImpl);
  await a.update((state) => {
    state.count = 1;
  });
  assert.deepEqual(await a.read(), { count: 1 });
  const b = createEncryptedRecordStore(
    { ...bootstrap, SETTINGS_ENCRYPTION_KEY: "changed-fixture-encryption-material-1234567890" },
    "key-test",
    options,
    db.fetchImpl
  );
  await assert.rejects(b.read(), /could not be unlocked/);
});

test("default auth reads deduplicate pending work but never cache settled authorization state", async () => {
  let calls = 0,
    complete;
  const options = { namespace: "strict-auth", name: "AUTH", fresh: () => ({ sessions: [] }) };
  const source = () => {
    calls++;
    return new Promise((resolve) => {
      complete = resolve;
    });
  };
  const a = createEncryptedRecordStore(bootstrap, "strict", options, source);
  const b = createEncryptedRecordStore(bootstrap, "strict", options, source);
  const first = a.read(),
    second = b.read();
  assert.equal(calls, 1);
  complete({ ok: true, json: async () => [] });
  await Promise.all([first, second]);
  const third = a.read();
  assert.equal(calls, 2);
  complete({ ok: true, json: async () => [] });
  await third;
});
