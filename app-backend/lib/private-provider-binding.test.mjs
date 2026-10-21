import test from "node:test";
import assert from "node:assert/strict";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { createSupabaseSettingsStore } from "./settings-store.mjs";
import { createProviderCredentialSettings } from "./provider-credential-settings.mjs";
import {
  createPrivateProviderBinding,
  privateProviderBinding,
} from "./private-provider-binding.mjs";
import {
  privateBindingContext,
  providerCredentialFingerprint,
  privateBindingHash as hash,
} from "./private-provider-binding-model.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import { copyCalendarWorkout } from "./calendar-workout-copy.mjs";
import { strengthExerciseLibrary, strengthLibraryAccount } from "./strength-exercise-library.mjs";
import { newStrengthExerciseDefinition } from "./strength-exercise-library-model.mjs";
import { workoutTemplateAccount } from "./workout-template.mjs";

const keyA = "synthetic-native-key-A",
  keyB = "synthetic-native-key-B",
  keyC = "synthetic-native-key-C";
const config = {
  SUPABASE_URL: "https://binding-fixture.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_synthetic_private_binding_database",
  SETTINGS_ENCRYPTION_KEY: "synthetic-stable-encryption-material-private-bindings",
  SETTINGS_SCOPE: "fixture-account",
  INTERVALS_API_KEY: keyA,
};
const actor = { id: "trusted-private-owner-A", origin: "https://app.example", readOnly: false };
const opA = "091b691c-b14e-4f0c-b64b-a129e1f1e908",
  opB = "4c2e70a6-a08b-4290-a92b-c88cb6946e26";

function database() {
  const rows = new Map(),
    requests = [];
  let bindingWrites = 0,
    settingsWrites = 0,
    fault = null,
    beforePatch = null;
  const fetchImpl = async (url, options = {}) => {
    const query = new URL(url).searchParams,
      name = query.get("name")?.startsWith("eq.") ? query.get("name").slice(3) : null,
      isSettings = name === "INTERVALS_API_KEY",
      method = options.method || "GET";
    requests.push({ url, options: structuredClone({ ...options, signal: undefined }) });
    if (beforePatch && method === "PATCH" && isSettings) {
      const run = beforePatch;
      beforePatch = null;
      await run();
    }
    const incoming = options.body ? JSON.parse(options.body) : null;
    const kind = isSettings
      ? "settings"
      : (Array.isArray(incoming) ? incoming[0]?.name : incoming?.name) ===
          "PRIVATE_PROVIDER_BINDING"
        ? "binding"
        : name === "PRIVATE_PROVIDER_BINDING"
          ? "binding"
          : "other";
    if (method !== "GET") {
      if (kind === "binding") bindingWrites++;
      if (kind === "settings") settingsWrites++;
    }
    const shouldFail =
      fault &&
      fault.kind === kind &&
      fault.method === method &&
      (fault.nth === undefined ||
        fault.nth === (kind === "binding" ? bindingWrites : settingsWrites));
    if (shouldFail && fault.when === "before") {
      const value = fault;
      fault = null;
      if (value.status)
        return {
          ok: false,
          status: value.status,
          json: async () => ({ private: "must not leak" }),
        };
      throw Error("Synthetic database lost before commit");
    }
    let result;
    if (method === "POST") {
      const accepted = [];
      for (const row of incoming) {
        const k = row.scope + ":" + row.name;
        if (options.headers.Prefer?.includes("ignore-duplicates") && rows.has(k)) continue;
        rows.set(k, structuredClone(row));
        accepted.push(row);
      }
      result = accepted;
    } else {
      let selected = [...rows.values()].filter(
        (row) => row.scope === query.get("scope")?.slice(3) && (!name || row.name === name)
      );
      if (query.get("name")?.startsWith("in.(")) {
        const names = query.get("name").slice(4, -1).split(",");
        selected = selected.filter((row) => names.includes(row.name));
      }
      for (const field of ["encrypted_value", "updated_at"])
        if (query.has(field))
          selected = selected.filter((row) => row[field] === query.get(field).slice(3));
      if (method === "PATCH") {
        result = selected.map((row) => {
          const value = { ...row, ...incoming };
          rows.set(row.scope + ":" + row.name, structuredClone(value));
          return value;
        });
      } else result = selected;
    }
    if (shouldFail && fault?.when === "after") {
      fault = null;
      throw Error("Synthetic database lost after commit");
    }
    return { ok: true, json: async () => structuredClone(result) };
  };
  return {
    rows,
    requests,
    fetchImpl,
    set fault(value) {
      fault = value;
      bindingWrites = 0;
      settingsWrites = 0;
    },
    set beforePatch(value) {
      beforePatch = value;
    },
    get settingsWrites() {
      return settingsWrites;
    },
    get bindingWrites() {
      return bindingWrites;
    },
  };
}
async function fixture() {
  const db = database(),
    probes = [];
  await createSupabaseSettingsStore(config, db.fetchImpl).save({ INTERVALS_API_KEY: keyA });
  let gate = {
      legacyWritersBlocked: true,
      allPrivateFactoriesBound: true,
      revision: "d".repeat(64),
    },
    authority = true,
    revoked = new Set(),
    nativeAthlete = "athlete-one";
  const context = privateBindingContext(config, actor);
  const verifyAthlete = async (key) => {
    probes.push(key);
    if (revoked.has(key)) throw Object.assign(Error("Synthetic revoked key"), { status: 403 });
    return { id: key === keyC ? "different-athlete" : nativeAthlete };
  };
  const legacyAuthority = async () =>
    authority
      ? {
          ...context,
          credentialFingerprint: providerCredentialFingerprint(config, keyA),
          athleteId: "athlete-one",
          evidenceId: "e".repeat(64),
        }
      : null;
  const service = (cfg = config, currentActor = actor, extra = {}) =>
    privateProviderBinding(cfg, currentActor, {
      verifyAthlete,
      legacyAuthority,
      writerGate: async () => gate,
      fetchImpl: db.fetchImpl,
      ...extra,
    });
  const enroll = () =>
    service().enrollLegacy({
      expectedCredentialFingerprint: providerCredentialFingerprint(config, keyA),
    });
  return {
    db,
    probes,
    service,
    enroll,
    verifyAthlete,
    legacyAuthority,
    set gate(value) {
      gate = value;
    },
    set authority(value) {
      authority = value;
    },
    set revoked(value) {
      revoked = value;
    },
    set athlete(value) {
      nativeAthlete = value;
    },
  };
}
async function input(h, candidateKey = keyB, operationId = opA) {
  return {
    operationId,
    expectedBindingRevision: (await h.service().resolve()).bindingRevision,
    candidateKey,
  };
}

test("standalone refresh preserves verified legacy storage token, owner/cache scope and native athlete while rotating only transport fingerprint", async () => {
  const h = await fixture(),
    enrolled = await h.enroll(),
    before = await h.service().resolve();
  assert.equal(before.privateDataConnection, providerConnection(config));
  assert.equal(before.cacheScope, providerConnection(config));
  const original = await input(h),
    result = await h.service().refresh(original),
    after = await h.service({ ...config, INTERVALS_API_KEY: keyB }).resolve();
  assert.equal(result.verified, true);
  assert.notEqual(result.bindingRevision, enrolled.bindingRevision);
  assert.equal(after.privateDataConnection, before.privateDataConnection);
  assert.equal(after.cacheScope, before.cacheScope);
  assert.equal(after.ownerHash, before.ownerHash);
  assert.equal(after.athleteId, before.athleteId);
  assert.equal(after.credentialFingerprint, providerCredentialFingerprint(config, keyB));
  assert.equal(after.writesAllowed, true);
  assert.equal(
    (await createSupabaseSettingsStore(config, h.db.fetchImpl).read(["INTERVALS_API_KEY"]))
      .INTERVALS_API_KEY,
    keyB,
    "New CAS writer remains compatible with existing settings reader"
  );
  const probeCount = h.probes.length,
    patches = h.db.settingsWrites;
  assert.equal((await h.service().refresh(original)).verified, true);
  assert.equal(h.db.settingsWrites, patches);
  assert.equal(h.probes.length, probeCount);
  const publicText = JSON.stringify({ result, inspection: await h.service().inspect(opA) });
  for (const secret of [keyA, keyB, config.SUPABASE_SECRET_KEY, config.SETTINGS_ENCRYPTION_KEY])
    assert.equal(publicText.includes(secret), false);
  for (const row of h.db.rows.values()) assert.ok(row.encrypted_value.startsWith("v1."));
});
test("enrollment is explicit server-authorized and verifies the configured old key; absent/unbound/revoked legacy evidence cannot be adopted", async () => {
  const h = await fixture();
  await assert.rejects(h.service().resolve(), { code: "PRIVATE_BINDING_ENROLLMENT_REQUIRED" });
  await assert.rejects(
    h
      .service(config, actor, { legacyAuthority: undefined })
      .enrollLegacy({ expectedCredentialFingerprint: providerConnection(config) }),
    { code: "PRIVATE_BINDING_ENROLLMENT_REQUIRED" }
  );
  h.authority = false;
  await assert.rejects(h.enroll(), { code: "PRIVATE_BINDING_ENROLLMENT_REQUIRED" });
  h.authority = true;
  h.revoked = new Set([keyA]);
  await assert.rejects(h.enroll(), { status: 403, code: "PRIVATE_BINDING_PROVIDER_UNAVAILABLE" });
  assert.equal(h.db.rows.size, 1);
  assert.equal(h.db.settingsWrites, 0);
});
test("revoked old credential refresh needs an existing owner/athlete binding; only the candidate is probed after enrollment", async () => {
  const h = await fixture();
  await h.enroll();
  h.revoked = new Set([keyA]);
  const original = await input(h),
    count = h.probes.length;
  assert.equal((await h.service().refresh(original)).verified, true);
  assert.deepEqual(h.probes.slice(count), [keyB]);
});
test("different athlete/owner/origin/scope/database/encryption and invalid trusted identity fail closed without replacing credentials", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h),
    count = h.db.settingsWrites;
  await assert.rejects(h.service().refresh({ ...original, candidateKey: keyC }), {
    code: "PRIVATE_BINDING_ATHLETE_CHANGED",
  });
  await assert.rejects(h.service(config, { ...actor, id: "another-owner" }).resolve(), {
    code: "PRIVATE_BINDING_OWNER_CHANGED",
  });
  for (const [cfg, current] of [
    [config, { ...actor, origin: "https://other.example" }],
    [{ ...config, SETTINGS_SCOPE: "other-scope" }, actor],
    [{ ...config, SUPABASE_URL: "https://other-db.supabase.co" }, actor],
  ])
    await assert.rejects(h.service(cfg, current).resolve());
  await assert.rejects(
    h
      .service({ ...config, SETTINGS_ENCRYPTION_KEY: "different-encryption-material-1234567890" })
      .resolve(),
    { code: "PRIVATE_BINDING_STORAGE" }
  );
  assert.throws(() => h.service(config, { ...actor, origin: "https://app.example/path" }));
  await assert.rejects(h.service(config, { ...actor, readOnly: true }).refresh(original), {
    code: "PRIVATE_BINDING_READ_ONLY",
  });
  assert.equal(h.db.settingsWrites, count);
  assert.equal((await createProviderCredentialSettings(config, h.db.fetchImpl).read()).key, keyA);
});
test("old-writer gate is mandatory, fresh before claiming, and never inferred from user input", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h);
  for (const gate of [
    null,
    { legacyWritersBlocked: true, allPrivateFactoriesBound: false, revision: "d".repeat(64) },
    { legacyWritersBlocked: false, allPrivateFactoriesBound: true, revision: "d".repeat(64) },
  ]) {
    h.gate = gate;
    await assert.rejects(h.service().refresh(original), {
      code: "PRIVATE_BINDING_WRITERS_UNVERIFIED",
    });
  }
  await assert.rejects(h.service().refresh({ ...original, legacyWritersBlocked: true }), {
    code: "PRIVATE_BINDING_INVALID",
  });
  assert.equal(h.db.settingsWrites, 0);
  assert.equal((await h.service().resolve()).writesAllowed, true);
  const retained = await fixture();
  await retained.enroll();
  const pending = await input(retained);
  retained.db.fault = { kind: "binding", method: "PATCH", nth: 1, when: "after" };
  await assert.rejects(retained.service().refresh(pending));
  retained.gate = null;
  await assert.rejects(retained.service().refresh(pending), {
    code: "PRIVATE_BINDING_WRITERS_UNVERIFIED",
  });
  assert.equal(retained.db.settingsWrites, 0);
});
test("lost journal preparation/claim/finalization replies converge after fresh instances without duplicate settings write", async () => {
  for (const nth of [1, 2, 3]) {
    const h = await fixture();
    await h.enroll();
    const original = await input(h);
    h.db.fault = { kind: "binding", method: "PATCH", nth, when: "after" };
    await assert.rejects(h.service().refresh(original));
    if (nth === 1) {
      assert.equal((await h.service().resolve()).status, "refreshing");
      assert.equal(h.db.settingsWrites, 0);
      assert.equal((await h.service().refresh(original)).verified, true);
    }
    if (nth === 2) {
      assert.equal(h.db.settingsWrites, 0);
      await assert.rejects(h.service().refresh({ ...original, reconcileOnly: true }), {
        code: "PRIVATE_BINDING_UNCONFIRMED",
      });
      assert.equal(h.db.settingsWrites, 0);
    }
    if (nth === 3) {
      assert.equal(
        (await h.service().refresh({ ...original, reconcileOnly: true })).verified,
        true
      );
      assert.equal(h.db.settingsWrites, 1);
    }
  }
});
test("lost committed settings response and failed independent readback retain same journal and safely finish on recheck", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h);
  h.db.fault = { kind: "settings", method: "PATCH", when: "after" };
  assert.equal((await h.service().refresh(original)).verified, true);
  assert.equal(h.db.settingsWrites, 1);
  assert.equal((await h.service().inspect(opA)).current, true);
  const b = await fixture();
  await b.enroll();
  const attempted = await input(b);
  let failNextRead = false;
  const settings = createProviderCredentialSettings(config, b.db.fetchImpl),
    wrapped = {
      read: async () => {
        if (failNextRead) {
          failNextRead = false;
          throw Error("Lost readback");
        }
        return settings.read();
      },
      compareAndSet: async (value) => {
        const saved = await settings.compareAndSet(value);
        failNextRead = true;
        return saved;
      },
    };
  const ctx = privateBindingContext(config, actor),
    service = createPrivateProviderBinding({
      config,
      actor,
      settings: wrapped,
      record: (initial) =>
        createEncryptedRecordStore(
          config,
          `${ctx.origin}:intervals:private-provider-binding`,
          {
            namespace: "private-provider-binding",
            name: "PRIVATE_PROVIDER_BINDING",
            fresh: initial,
            timestampCas: true,
          },
          b.db.fetchImpl
        ),
      verifyAthlete: b.verifyAthlete,
      writerGate: async () => ({
        legacyWritersBlocked: true,
        allPrivateFactoriesBound: true,
        revision: "d".repeat(64),
      }),
    });
  await assert.rejects(service.refresh(attempted));
  assert.equal((await b.service().inspect(opA)).status, "settings-confirmed");
  assert.equal((await b.service().refresh({ ...attempted, reconcileOnly: true })).verified, true);
  assert.equal(b.db.settingsWrites, 1);
});
test("unknown settings precommit outcome stays pending and never blindly resends or grants a new UUID", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h);
  h.db.fault = { kind: "settings", method: "PATCH", when: "before" };
  await assert.rejects(h.service().refresh(original), { code: "PRIVATE_BINDING_UNCONFIRMED" });
  assert.equal((await h.service().inspect(opA)).status, "unconfirmed");
  assert.equal((await h.service().resolve()).writesAllowed, false);
  await assert.rejects(h.service().refresh({ ...original, reconcileOnly: true }), {
    code: "PRIVATE_BINDING_UNCONFIRMED",
  });
  await assert.rejects(h.service().refresh(original), { code: "PRIVATE_BINDING_UNCONFIRMED" });
  await assert.rejects(h.service().refresh({ ...original, operationId: opB }), {
    code: "PRIVATE_BINDING_REFRESH_PENDING",
  });
  assert.equal(h.db.settingsWrites, 1);
  assert.equal((await createProviderCredentialSettings(config, h.db.fetchImpl).read()).key, keyA);
});
test("third-key settings race is protected by exact ciphertext+timestamp CAS and cannot be overwritten by original/replayed intent", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h);
  h.db.beforePatch = () =>
    createSupabaseSettingsStore(config, h.db.fetchImpl).save({ INTERVALS_API_KEY: keyC });
  await assert.rejects(h.service().refresh(original), { code: "PRIVATE_BINDING_SETTINGS_CHANGED" });
  assert.equal((await createProviderCredentialSettings(config, h.db.fetchImpl).read()).key, keyC);
  assert.equal((await h.service().inspect(opA)).status, "conflict");
  await assert.rejects(h.service().refresh({ ...original, reconcileOnly: true }), {
    code: "PRIVATE_BINDING_SETTINGS_CHANGED",
  });
  assert.equal((await createProviderCredentialSettings(config, h.db.fetchImpl).read()).key, keyC);
  assert.equal(h.db.settingsWrites, 1);
});
test("same operation payload is immutable and older committed replay after later successful refresh is explicit conflict", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h);
  await h.service().refresh(original);
  await assert.rejects(h.service().refresh({ ...original, candidateKey: keyA }), {
    code: "PRIVATE_BINDING_INTENT_CHANGED",
  });
  const next = await input(h, keyA, opB);
  await h.service().refresh(next);
  await assert.rejects(h.service().refresh(original), { code: "PRIVATE_BINDING_REPLAY_CHANGED" });
  assert.equal((await h.service().inspect(opA)).current, false);
  assert.equal((await h.service().inspect(opB)).current, true);
  assert.equal(h.db.settingsWrites, 2);
});
test("concurrent identical refreshes share one settings claim and converge without cross-instance currentActor", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h),
    results = await Promise.allSettled([
      h.service().refresh(original),
      h.service().refresh(original),
    ]);
  assert.ok(results.some((row) => row.status === "fulfilled"));
  assert.equal(h.db.settingsWrites, 1);
  assert.equal((await h.service().refresh({ ...original, reconcileOnly: true })).verified, true);
});
test("fixed encryption material allows backend-secret renewal; fallback material change cannot decrypt binding", async () => {
  const h = await fixture();
  await h.enroll();
  const renewed = {
    ...config,
    SUPABASE_SECRET_KEY: "sb_secret_synthetic_renewed_backend_authority",
  };
  assert.equal(
    (await h.service(renewed).resolve()).privateDataConnection,
    providerConnection(config)
  );
  const fallback = { ...config, SETTINGS_ENCRYPTION_KEY: undefined },
    db = database();
  await createSupabaseSettingsStore(fallback, db.fetchImpl).save({ INTERVALS_API_KEY: keyA });
  const ctx = privateBindingContext(fallback, actor),
    service = privateProviderBinding(fallback, actor, {
      fetchImpl: db.fetchImpl,
      verifyAthlete: async () => ({ id: "athlete-one" }),
      legacyAuthority: async () => ({
        ...ctx,
        credentialFingerprint: providerConnection(fallback),
        athleteId: "athlete-one",
        evidenceId: "e".repeat(64),
      }),
    });
  await service.enrollLegacy({ expectedCredentialFingerprint: providerConnection(fallback) });
  await assert.rejects(
    privateProviderBinding(
      { ...fallback, SUPABASE_SECRET_KEY: "sb_secret_changed_fallback_encryption" },
      actor,
      { fetchImpl: db.fetchImpl }
    ).resolve(),
    { code: "PRIVATE_BINDING_STORAGE" }
  );
});
test("stable token addresses legacy encrypted namespaces and original pending copy claim; custom exercise IDs stay actor-stable", async () => {
  const h = await fixture(),
    C = providerConnection(config),
    personalHost = "app.example";
  const descriptors = [
    ["workout-editor-data", "WORKOUT_EDITOR_DATA", `${C}/index`],
    [
      "workout-personal",
      "WORKOUT_PERSONAL",
      `${personalHost}/${C}/workout/draft:unlisted-legacy-draft-identity`,
    ],
    ["workout-personal", "WORKOUT_PERSONAL", `${personalHost}/${C}/attachment/${"b".repeat(64)}`],
    ["calendar-wellness", "CALENDAR_WELLNESS", `${C}:index`],
    ["calendar-annotations", "CALENDAR_ANNOTATIONS", `${C}:entry:unlisted-legacy-entry`],
    ["race-event-details", "RACE_EVENT_DETAILS", `${C}:event:9`],
    ["calendar-entry-transfer", "CALENDAR_ENTRY_TRANSFER", `${C}:${opA}`],
    ["workout-recurrence", "WORKOUT_RECURRENCE", C],
    ["mutation-queue", "MUTATION_QUEUE", C],
    ["intervals-webhook", "INTERVALS_WEBHOOK", C],
    ["intervals-oauth", "INTERVALS_OAUTH", `${actor.origin}:${C}:same-client`],
    ["section11-export", "SECTION11_EXPORT", `${C}:repo@branch`],
  ];
  const S = workoutTemplateAccount(config, actor),
    templateKey = hash({ accountScope: S, operationId: opA });
  descriptors.push(["workout-templates", "WORKOUT_TEMPLATE", `${S}/${templateKey}`]);
  const seeds = descriptors.map(([namespace, name, id], i) => ({
    namespace,
    name,
    id,
    value: {
      identity: i,
      prepared: { operationId: opA, state: i % 2 ? "attempted" : "rejected" },
      revision: 7,
    },
  }));
  for (const seed of seeds)
    await createEncryptedRecordStore(
      config,
      seed.id,
      { namespace: seed.namespace, name: seed.name, fresh: () => ({}) },
      h.db.fetchImpl
    ).update((state) => Object.assign(state, seed.value));
  const exerciseLibrary = strengthExerciseLibrary(config, actor, h.db.fetchImpl),
    catalog = await exerciseLibrary.list(),
    definition = { ...newStrengthExerciseDefinition(), title: "Persistent custom definition" },
    exercise = await exerciseLibrary.create({
      accountScope: catalog.accountScope,
      catalogRevision: catalog.revision,
      operationId: "synthetic-independent-exercise-create",
      definition,
    });
  const events = [],
    copyId = "30b52a96-21b0-44d8-8849-6b317b2433d8";
  let nativePosts = 0,
    failReadback = false;
  const request = async (path, options = {}) => {
    if (options.method === "POST") {
      nativePosts++;
      const row = { id: 22, ...JSON.parse(options.body) };
      events.push(row);
      failReadback = true;
      throw Error("Synthetic native response lost");
    }
    if (path.includes("/events?")) {
      if (failReadback) {
        failReadback = false;
        throw Error("Temporary lost native lookup");
      }
      return structuredClone(events);
    }
    if (path.endsWith("/events/1"))
      return {
        id: 1,
        category: "WORKOUT",
        type: "Ride",
        name: "Actual retained copy intent",
        description: "- 60s 150w",
        start_date_local: "2026-10-21T00:00:00",
      };
    return structuredClone(events[0]);
  };
  const claim = (storageToken) =>
    createEncryptedRecordStore(
      config,
      `${storageToken}/copy/${copyId}`,
      {
        namespace: "calendar-copy",
        name: "CALENDAR_COPY",
        fresh: () => ({ operation: null }),
        timestampCas: true,
      },
      h.db.fetchImpl
    );
  await assert.rejects(
    copyCalendarWorkout(
      config,
      request,
      "event:1",
      { date: "2026-10-22", creationId: copyId },
      { record: claim(C) }
    )
  );
  assert.equal(nativePosts, 1);
  await h.enroll();
  await h.service().refresh(await input(h));
  const resolved = await h.service({ ...config, INTERVALS_API_KEY: keyB }).resolve();
  assert.equal(resolved.privateDataConnection, C);
  for (const seed of seeds) {
    const read = await createEncryptedRecordStore(
      { ...config, INTERVALS_API_KEY: keyB },
      seed.id,
      { namespace: seed.namespace, name: seed.name, fresh: () => ({}) },
      h.db.fetchImpl
    ).read();
    assert.deepEqual(read, seed.value);
  }
  const copied = await copyCalendarWorkout(
    { ...config, INTERVALS_API_KEY: keyB },
    request,
    "event:1",
    { date: "2026-10-22", creationId: copyId, reconcileOnly: true },
    { record: claim(resolved.privateDataConnection) }
  );
  assert.equal(copied.workoutId, "event:22");
  assert.equal(copied.verified, true);
  assert.equal(nativePosts, 1);
  assert.equal(
    hash({
      actor: strengthLibraryAccount(config, actor),
      provider: resolved.privateDataConnection,
    }),
    S
  );
  assert.notEqual(
    workoutTemplateAccount({ ...config, INTERVALS_API_KEY: keyB }, actor),
    S,
    "Existing factories remain unwired: this test does not claim completed integration"
  );
  const after = await strengthExerciseLibrary(
    { ...config, INTERVALS_API_KEY: keyB },
    actor,
    h.db.fetchImpl
  ).list();
  assert.equal(after.exercises[0].id, exercise.exercise.id);
  assert.deepEqual(after.exercises[0].parameters, exercise.exercise.parameters);
});
test("definite settings rejection never commits a candidate, including failed rejection receipt persistence", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h);
  h.db.fault = { kind: "settings", method: "PATCH", when: "before", status: 403 };
  await assert.rejects(h.service().refresh(original), {
    status: 403,
    code: "PRIVATE_BINDING_SETTINGS_REJECTED",
  });
  assert.equal((await h.service().inspect(opA)).status, "rejected");
  assert.equal((await h.service().resolve()).writesAllowed, true);
  assert.equal((await createProviderCredentialSettings(config, h.db.fetchImpl).read()).key, keyA);
  const b = await fixture();
  await b.enroll();
  const attempted = await input(b),
    ctx = privateBindingContext(config, actor),
    underlying = createEncryptedRecordStore(
      config,
      `${ctx.origin}:intervals:private-provider-binding`,
      {
        namespace: "private-provider-binding",
        name: "PRIVATE_PROVIDER_BINDING",
        fresh: () => ({}),
        timestampCas: true,
      },
      b.db.fetchImpl
    );
  const service = createPrivateProviderBinding({
    config,
    actor,
    settings: createProviderCredentialSettings(config, b.db.fetchImpl),
    verifyAthlete: b.verifyAthlete,
    writerGate: async () => ({
      legacyWritersBlocked: true,
      allPrivateFactoriesBound: true,
      revision: "d".repeat(64),
    }),
    record: () => ({
      read: underlying.read,
      update: (change) =>
        underlying.update((state) => {
          const result = change(state);
          if (state.receipts.some((receipt) => receipt.status === "rejected"))
            throw Error("Synthetic rejection receipt failure");
          return result;
        }),
    }),
  });
  b.db.fault = { kind: "settings", method: "PATCH", when: "before", status: 403 };
  await assert.rejects(service.refresh(attempted), {
    status: 403,
    code: "PRIVATE_BINDING_SETTINGS_REJECTED",
  });
  assert.equal((await b.service().inspect(opA)).status, "unconfirmed");
  assert.equal((await createProviderCredentialSettings(config, b.db.fetchImpl).read()).key, keyA);
  await assert.rejects(b.service().refresh({ ...attempted, reconcileOnly: true }), {
    code: "PRIVATE_BINDING_UNCONFIRMED",
  });
  assert.equal(b.db.settingsWrites, 1);
});
test("invalid or same-current credential input never probes/writes and a malformed native athlete cannot establish binding", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h),
    probes = h.probes.length;
  for (const patch of [
    { operationId: "bad" },
    { expectedBindingRevision: "wrong" },
    { candidateKey: " key " },
    { candidateKey: "x".repeat(1025) },
    { candidateKey: keyA },
    { actor: "untrusted-selector" },
    { reconcileOnly: "true" },
  ])
    await assert.rejects(h.service().refresh({ ...original, ...patch }));
  assert.equal(h.probes.length, probes);
  assert.equal(h.db.settingsWrites, 0);
  const b = await fixture();
  await assert.rejects(
    b
      .service(config, actor, { verifyAthlete: async () => ({ id: 0 }) })
      .enrollLegacy({ expectedCredentialFingerprint: providerConnection(config) }),
    { code: "PRIVATE_BINDING_ATHLETE_INVALID" }
  );
  assert.equal(b.db.rows.size, 1);
});
test("UUID-only recheck finishes an already saved candidate from encrypted journal without retaining or resending browser credential", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h);
  h.db.fault = { kind: "binding", method: "PATCH", nth: 3, when: "before" };
  await assert.rejects(h.service().refresh(original));
  assert.equal((await h.service().inspect(opA)).status, "settings-confirmed");
  const patches = h.db.settingsWrites;
  const result = await h.service().recheck(opA);
  assert.equal(result.verified, true);
  assert.equal((await h.service().inspect(opA)).current, true);
  assert.equal(h.db.settingsWrites, patches);
  assert.equal((await h.service().recheck(opA)).verified, true);
  await assert.rejects(h.service().recheck(opB), { status: 404 });
  assert.equal(h.db.settingsWrites, patches);
  assert.equal(JSON.stringify(result).includes(keyB), false);
  assert.equal(
    (await h.service(config, { ...actor, readOnly: true }).resolve()).writesAllowed,
    false
  );
});
test("settings CAS also protects a third credential written within the exact same timestamp", async () => {
  const h = await fixture();
  await h.enroll();
  const original = await input(h),
    row = [...h.db.rows.values()].find((row) => row.name === "INTERVALS_API_KEY"),
    time = row.updated_at;
  h.db.beforePatch = async () => {
    await createSupabaseSettingsStore(config, h.db.fetchImpl).save({ INTERVALS_API_KEY: keyC });
    [...h.db.rows.values()].find((row) => row.name === "INTERVALS_API_KEY").updated_at = time;
  };
  await assert.rejects(h.service().refresh(original), { code: "PRIVATE_BINDING_SETTINGS_CHANGED" });
  assert.equal((await createProviderCredentialSettings(config, h.db.fetchImpl).read()).key, keyC);
  assert.equal(h.db.settingsWrites, 1);
});
test("corrupt, unexpected or excessive stored shapes fail before stringification, provider verification or settings writes", async () => {
  const h = await fixture();
  let serialized = 0;
  const states = [
    {
      version: 1,
      ownerHash: null,
      environmentHash: null,
      binding: null,
      operation: null,
      receipts: [],
      extra: {
        toJSON() {
          serialized++;
          return "unexpected";
        },
      },
    },
    {
      version: 1,
      ownerHash: null,
      environmentHash: null,
      binding: null,
      operation: null,
      receipts: Array(257).fill({}),
    },
    {
      version: 1,
      ownerHash: privateBindingContext(config, actor).ownerHash,
      environmentHash: null,
      binding: null,
      operation: null,
      receipts: [],
    },
  ];
  for (const state of states) {
    const service = createPrivateProviderBinding({
      config,
      actor,
      record: () => ({
        read: async () => state,
        update: async () => {
          throw Error("No update permitted");
        },
      }),
      settings: createProviderCredentialSettings(config, h.db.fetchImpl),
      verifyAthlete: h.verifyAthlete,
    });
    await assert.rejects(service.resolve(), { code: "PRIVATE_BINDING_CORRUPT" });
  }
  assert.equal(serialized, 0);
  assert.equal(h.probes.length, 0);
  assert.equal(h.db.settingsWrites, 0);
});
test("trusted authority/deployment dependency failures never echo candidate credentials or bypass ownership", async () => {
  const h = await fixture();
  await assert.rejects(
    h
      .service(config, actor, {
        legacyAuthority: async () => {
          throw Error(keyA);
        },
      })
      .enrollLegacy({ expectedCredentialFingerprint: providerConnection(config) }),
    (error) =>
      error.code === "PRIVATE_BINDING_AUTHORITY_UNAVAILABLE" && !error.message.includes(keyA)
  );
  await h.enroll();
  const original = await input(h);
  await assert.rejects(
    h
      .service(config, actor, {
        writerGate: async () => {
          throw Error(keyB);
        },
      })
      .refresh(original),
    (error) => error.code === "PRIVATE_BINDING_WRITERS_UNVERIFIED" && !error.message.includes(keyB)
  );
  await assert.rejects(
    h
      .service(config, actor, {
        verifyAthlete: async () => {
          throw Error(keyB);
        },
      })
      .refresh(original),
    (error) =>
      error.code === "PRIVATE_BINDING_PROVIDER_UNAVAILABLE" && !error.message.includes(keyB)
  );
  assert.equal(h.db.settingsWrites, 0);
});
