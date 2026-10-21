import test from "node:test";
import assert from "node:assert/strict";
import {
  createProviderWorkoutMetadata,
  providerWorkoutDescription,
} from "./provider-workout-metadata.mjs";
import { createIntervalsClient } from "./intervals.mjs";
import {
  loadWorkoutEditor,
  loadNewWorkoutEditor,
  saveWorkoutEditor,
  createWorkoutEditor,
} from "./workout-editor.mjs";
import {
  fixtureEvent,
  fakeProvider,
  parseTestWorkout,
} from "./fixtures/workout-editor-fixtures.mjs";
import {
  serializeManualWorkout,
  readManualWorkoutDescription,
} from "./workout-manual-description.mjs";
import { importWorkout, newStep, verifyParsedWorkout } from "./workout-editor-model.mjs";
import { withPlannedValues, readPlannedValues } from "./planned-workout-values.mjs";
import { withWorkoutCommentText, readWorkoutCommentText } from "./workout-comment-text.mjs";
import { updateWorkoutDescription } from "./workout-description.mjs";
import { saveProviderWorkoutComment } from "./provider-workout-comments.mjs";
import { savePlannedWorkoutMetrics } from "./planned-workout-metrics.mjs";
import { simpleWorkoutModel } from "./simple-workout.mjs";
import { createHash } from "node:crypto";

function memory() {
  const records = new Map();
  const record = (key, fresh) => ({
    read: async () => structuredClone(records.get(key) ?? fresh()),
    update: async (change) => {
      const state = structuredClone(records.get(key) ?? fresh());
      const result = change(state);
      records.set(key, state);
      return structuredClone(result);
    },
  });
  return { records, record, wrap: () => createProviderWorkoutMetadata({ record }).wrap };
}
const comment = {
  id: "comment-fixture",
  type: "pre",
  body: "Meet at the track.",
  created_at: "2026-10-20T12:00:00Z",
};
function description(event = fixtureEvent("Ride"), text = "Stay controlled.") {
  return withWorkoutCommentText(
    withPlannedValues(serializeManualWorkout(importWorkout(event).model, text), {
      duration_seconds: 2580,
      tss: 39,
      intensity_factor: 0.74,
    }),
    [comment]
  );
}
const noMachineData = (text) => {
  assert.doesNotMatch(
    text,
    /Workout editor v1|training-agent-(?:manual-description|planned-values|workout-comments)-v1|"version":|"duration_seconds":|"text":/
  );
};

test("provider descriptions contain prose and identical native intervals, without any internal JSON envelopes", () => {
  const event = fixtureEvent("Ride"),
    text = description(event);
  const clean = providerWorkoutDescription(text);
  noMachineData(clean);
  assert.match(clean, /Stay controlled\./);
  assert.deepEqual(parseTestWorkout(clean), parseTestWorkout(text));
  assert.equal(providerWorkoutDescription(clean), clean);
  assert.equal(
    providerWorkoutDescription("Plain instructions\nWorkout editor v1"),
    "Plain instructions\nWorkout editor v1"
  );
});

test("CRLF provider text strips every private envelope while preserving human prose and native lines", async () => {
  const text = description().replaceAll("\n", "\r\n");
  const expected = providerWorkoutDescription(description()).replaceAll("\n", "\r\n");
  assert.equal(providerWorkoutDescription(text), expected);
  noMachineData(providerWorkoutDescription(text));
  const store = memory();
  let provider;
  const request = store.wrap()(async (_path, options = {}) => {
    if (options.body) provider = { id: 100, ...JSON.parse(options.body) };
    return structuredClone(provider);
  });
  const saved = await request("/athlete/0/events/100", {
    method: "PUT",
    body: JSON.stringify({ description: text }),
  });
  assert.equal(provider.description, expected);
  assert.equal(saved.description, text);
  provider.description = "A replacement native workout\r\n- 10m 50%";
  const changed = await request("/athlete/0/events/100");
  assert.doesNotMatch(changed.description, /Workout editor v1/);
  assert.match(changed.description, /A replacement native workout/);
});

for (const sport of ["Ride", "Run", "Swim"])
  test(`${sport}: real editor save keeps JSON off the provider and reopens every original field after restart`, async () => {
    const provider = fakeProvider(fixtureEvent(sport));
    const store = memory();
    const request = store.wrap()(provider.request);
    const loaded = await loadWorkoutEditor(request, "event:100");
    const originalModel = structuredClone(loaded.model);
    const saved = await saveWorkoutEditor(request, "event:100", {
      model: loaded.model,
      revision: loaded.revision,
      descriptionMode: "manual",
      description: "Coach's notes\n```\n- 30s 900w\n```",
      values: { tss: 39, duration_seconds: 2580 },
      comment: "Keep it steady.",
      commentId: "93ae5940-972e-46ba-8d16-a770c6c40e11",
    });
    assert.equal(saved.verified, true);
    noMachineData(provider.event().description);
    assert.deepEqual(verifyParsedWorkout(originalModel, provider.event()), []);
    const restarted = store.wrap()(provider.request);
    const reopened = await loadWorkoutEditor(restarted, "event:100");
    assert.deepEqual(reopened.model, originalModel);
    assert.equal(reopened.manualDescription, "Coach's notes\n```\n- 30s 900w\n```");
    assert.equal(reopened.plannedValues.tss, 39);
    assert.equal(reopened.comments[0].body, "Keep it steady.");
    assert.equal(reopened.revision, saved.revision);
  });

test("creation and a lost provider reply recover from durable metadata by stable external identity", async () => {
  const provider = fakeProvider(fixtureEvent("Ride"));
  const store = memory();
  let lost = false;
  const request = store.wrap()(async (path, options) => {
    const response = await provider.request(path, options);
    if (options?.method === "POST" && !lost) {
      lost = true;
      throw Error("Response lost");
    }
    return response;
  });
  const loaded = await loadNewWorkoutEditor(request, "2026-10-21", { sport: "Ride" });
  loaded.model.steps = [newStep("Ride")];
  const input = {
    model: loaded.model,
    creationId: "e523201e-3ff5-4a7b-ad16-080f407d4491",
    descriptionMode: "manual",
    description: "",
    values: { tss: 39 },
  };
  const saved = await createWorkoutEditor(request, input, "metadata-fixture");
  assert.equal(saved.verified, true);
  noMachineData(
    (await provider.request(`/athlete/0/events/${saved.workoutId.split(":")[1]}`)).description
  );
  const restarted = store.wrap()(provider.request);
  const duplicate = await createWorkoutEditor(restarted, input, "metadata-fixture");
  assert.equal(duplicate.workoutId, saved.workoutId);
  assert.equal(provider.calls.filter((call) => call.method === "POST").length, 1);
  assert.equal(readPlannedValues(duplicate.event.description).tss, 39);
  assert.equal(readManualWorkoutDescription(duplicate.event), "");
});

test("text-only and comment saves retain native steps, explicit blanks, values and lossless prose", async () => {
  const provider = fakeProvider(fixtureEvent("Run"));
  const store = memory(),
    request = store.wrap()(provider.request);
  const original = provider.event().workout_doc.steps;
  await updateWorkoutDescription(request, "event:100", "My instructions", {
    descriptionMode: "manual",
  });
  noMachineData(provider.event().description);
  assert.deepEqual(provider.event().workout_doc.steps, original);
  await saveProviderWorkoutComment(request, {
    workoutId: "event:100",
    body: "Good workout",
    type: "post",
    creationId: "de8d589e-5725-469d-96b1-4fc51b9418bd",
  });
  noMachineData(provider.event().description);
  await updateWorkoutDescription(request, "event:100", "", { descriptionMode: "manual" });
  const reopened = await store.wrap()(provider.request)("/athlete/0/events/100");
  assert.equal(readManualWorkoutDescription(reopened), "");
  assert.equal(readWorkoutCommentText(reopened.description, "event:100")[0].body, "Good workout");
  assert.deepEqual(provider.event().workout_doc.steps, original);
});

test("a direct provider edit wins over the old sidecar and stale editor revisions fail closed", async () => {
  const provider = fakeProvider(fixtureEvent("Ride")),
    store = memory();
  const request = store.wrap()(provider.request);
  await updateWorkoutDescription(request, "event:100", "Original notes", {
    descriptionMode: "manual",
  });
  const loaded = await loadWorkoutEditor(request, "event:100");
  provider.setEvent({
    ...provider.event(),
    description: provider.event().description.replace("Original notes", "Changed remotely"),
  });
  const fresh = await loadWorkoutEditor(store.wrap()(provider.request), "event:100");
  assert.equal(fresh.manualDescription, "Changed remotely");
  await assert.rejects(
    saveWorkoutEditor(request, "event:100", {
      model: loaded.model,
      revision: loaded.revision,
      descriptionMode: "manual",
      description: "Stale notes",
    }),
    (error) => error.code === "CONFLICT"
  );
});

test("remote prose retains comments and exact grouping, while remote native changes never restore stale intervals", async () => {
  const provider = fakeProvider(fixtureEvent("Ride")),
    store = memory();
  const request = store.wrap()(provider.request);
  const full = description();
  await request("/athlete/0/events/100", {
    method: "PUT",
    body: JSON.stringify({ description: full }),
  });
  const before = await loadWorkoutEditor(request, "event:100");
  provider.setEvent({
    ...provider.event(),
    description: provider.event().description.replace("Stay controlled.", "Remote coach notes."),
  });
  const prose = await loadWorkoutEditor(store.wrap()(provider.request), "event:100");
  assert.equal(prose.manualDescription, "Remote coach notes.");
  assert.deepEqual(prose.model.steps, before.model.steps);
  assert.equal(prose.comments[0].body, comment.body);
  assert.equal(prose.plannedValues.tss, 39);
  const remoteText = provider.event().description.replace(/- 600s/, "- 660s");
  assert.notEqual(remoteText, provider.event().description);
  provider.setEvent({
    ...provider.event(),
    description: remoteText,
    workout_doc: parseTestWorkout(remoteText),
  });
  const changed = await loadWorkoutEditor(store.wrap()(provider.request), "event:100");
  assert.deepEqual(changed.issues, []);
  assert.equal(changed.model.steps[0].end.value, 660);
  assert.equal(changed.comments[0].body, comment.body);
  assert.equal(changed.manualDescription, "Remote coach notes.");
  provider.setEvent({ ...provider.event(), description: "", workout_doc: { steps: [] } });
  const cleared = await store.wrap()(provider.request)("/athlete/0/events/100");
  assert.doesNotMatch(cleared.description, /Workout editor v1/);
  assert.equal(readManualWorkoutDescription(cleared), "");
  assert.equal(readWorkoutCommentText(cleared.description, "event:100")[0].body, comment.body);
});

test("metadata-only provider rejection restores the previous bookkeeping instead of reporting a false save", async () => {
  const store = memory();
  let value = { ...fixtureEvent("Ride"), description: description() };
  let reject = false;
  const raw = async (_path, options = {}) => {
    if (options.method === "PUT") {
      if (reject) throw Object.assign(Error("Forbidden"), { status: 403 });
      value = { ...value, ...JSON.parse(options.body) };
    }
    return structuredClone(value);
  };
  const request = store.wrap()(raw);
  await request("/athlete/0/events/100", {
    method: "PUT",
    body: JSON.stringify({ description: value.description }),
  });
  const initial = await request("/athlete/0/events/100");
  reject = true;
  const changed = withPlannedValues(initial.description, { tss: 99 });
  assert.equal(
    providerWorkoutDescription(initial.description),
    providerWorkoutDescription(changed)
  );
  await assert.rejects(
    request("/athlete/0/events/100", {
      method: "PUT",
      body: JSON.stringify({ description: changed }),
    }),
    /Forbidden/
  );
  assert.equal((await store.wrap()(raw)("/athlete/0/events/100")).description, initial.description);
});

test("failed rejection cleanup preserves the original403 and only committed metadata after restart", async () => {
  for (const kind of ["private-variant", "native-prose-and-model"]) {
    const records = new Map();
    let failCleanup = false,
      reject = false;
    const record = (key, fresh) => ({
      read: async () => structuredClone(records.get(key) ?? fresh()),
      update: async (change) => {
        const before = structuredClone(records.get(key) ?? fresh()),
          state = structuredClone(before),
          result = change(state);
        if (
          failCleanup &&
          key === "index" &&
          Object.keys(state.pending || {}).length < Object.keys(before.pending || {}).length
        )
          throw Error("Synthetic cleanup storage outage");
        records.set(key, state);
        return structuredClone(result);
      },
    });
    const provider = fakeProvider(fixtureEvent(kind === "private-variant" ? "Other" : "Ride"));
    const raw = async (path, options = {}) => {
      if (reject && options.method === "PUT")
        throw Object.assign(Error("Original provider denied mutation"), {
          status: 403,
          code: "PROVIDER_PERMISSION",
        });
      return provider.request(path, options);
    };
    const wrap = () => createProviderWorkoutMetadata({ record }).wrap(raw),
      request = wrap();
    const model =
      kind === "private-variant"
        ? simpleWorkoutModel({
            name: "Original",
            sport: "Other",
            variant: "custom",
            date: "2026-10-22",
            description: "Original prose",
          })
        : importWorkout(fixtureEvent("Ride")).model;
    const created = await createWorkoutEditor(request, {
      model,
      creationId: "36083dbb-e62b-4fa4-807d-79c189306471",
    });
    const opened = await loadWorkoutEditor(request, created.workoutId),
      before = structuredClone(records.get("index").entries);
    const original = structuredClone(opened.model);
    if (kind === "private-variant") opened.model.variant = "brick";
    else opened.model.steps[0].end.value += 60;
    reject = true;
    failCleanup = true;
    await assert.rejects(
      saveWorkoutEditor(request, created.workoutId, {
        model: opened.model,
        revision: opened.revision,
        ...(kind === "native-prose-and-model"
          ? { descriptionMode: "manual", description: "New rejected prose" }
          : {}),
      }),
      (error) => error.status === 403 && error.code === "PERMISSION_DENIED"
    );
    assert.deepEqual(
      records.get("index").entries,
      before,
      "Prepared rejected intent cannot replace a committed pointer"
    );
    const restarted = await loadWorkoutEditor(wrap(), created.workoutId);
    assert.deepEqual(restarted.model, original);
    assert.equal(restarted.manualDescription, opened.manualDescription);
    assert.equal(provider.calls.filter((call) => call.method === "POST").length, 1);
  }
});

test("ambiguous changed native text recovers committed metadata through independent readback across restart", async () => {
  const store = memory();
  let current = { ...fixtureEvent("Ride"), description: providerWorkoutDescription(description()) },
    lose = false;
  const raw = async (_path, options = {}) => {
    if (options.method === "PUT") {
      current = { ...current, ...JSON.parse(options.body) };
      if (lose) throw Error("Reply lost after native commit");
    }
    return structuredClone(current);
  };
  const request = store.wrap()(raw);
  await request("/athlete/0/events/100", {
    method: "PUT",
    body: JSON.stringify({ description: description() }),
  });
  const prior = await request("/athlete/0/events/100"),
    changed = description(fixtureEvent("Ride"), "Changed native prose");
  lose = true;
  await assert.rejects(
    request("/athlete/0/events/100", {
      method: "PUT",
      body: JSON.stringify({ description: changed }),
    }),
    /Reply lost/
  );
  assert.notEqual(
    providerWorkoutDescription(prior.description),
    providerWorkoutDescription(changed)
  );
  assert.equal((await store.wrap()(raw)("/athlete/0/events/100")).description, changed);
  assert.equal(Object.keys(store.records.get("index").pending).length, 0);
});

test("legacy committed string pointers load without requiring an intent migration", async () => {
  const store = memory(),
    text = description(),
    hash = (value) => createHash("sha256").update(value).digest("hex"),
    clean = providerWorkoutDescription(text);
  store.records.set("index", { entries: { [hash("events:100")]: { [hash(clean)]: hash(text) } } });
  store.records.set(`text:${hash(text)}`, { text });
  const raw = async () => ({ ...fixtureEvent("Ride"), description: clean });
  assert.equal((await store.wrap()(raw)("/athlete/0/events/100")).description, text);
  assert.equal(store.records.has("index"), true);
  assert.equal(
    [...store.records.keys()].some((key) => key.startsWith("intent:")),
    false
  );
});

test("storage failure prevents provider writes, and damaged metadata blocks an unsafe edit", async () => {
  let writes = 0;
  const broken = createProviderWorkoutMetadata({
    record: () => ({
      update: async () => {
        throw Error("Storage unavailable");
      },
    }),
  }).wrap(async () => {
    writes++;
  });
  await assert.rejects(
    broken("/athlete/0/events/100", {
      method: "PUT",
      body: JSON.stringify({ description: description() }),
    }),
    /Storage unavailable/
  );
  assert.equal(writes, 0);
  const store = memory();
  const value = { ...fixtureEvent("Ride"), description: description() };
  const raw = async (_path, options) => {
    if (options?.method === "PUT") value.description = JSON.parse(options.body).description;
    return structuredClone(value);
  };
  await store.wrap()(raw)("/athlete/0/events/100", {
    method: "PUT",
    body: JSON.stringify({ description: value.description }),
  });
  for (const [key, state] of store.records) if (key.startsWith("text:")) state.text = "Corrupted";
  await assert.rejects(store.wrap()(raw)("/athlete/0/events/100"), /could not be verified/);
});

test("account stores, resource kinds and equal visible descriptions do not share private metadata", async () => {
  const one = memory(),
    two = memory();
  const raw = async (_path, options) => ({
    id: 100,
    description: options?.body
      ? JSON.parse(options.body).description
      : providerWorkoutDescription(description()),
  });
  await one.wrap()(raw)("/athlete/0/events/100", {
    method: "PUT",
    body: JSON.stringify({ description: description() }),
  });
  const otherAccount = await two.wrap()(raw)("/athlete/0/events/100");
  const otherKind = await one.wrap()(raw)("/athlete/0/workouts/100");
  noMachineData(otherAccount.description);
  noMachineData(otherKind.description);
  assert.equal(readWorkoutCommentText(otherAccount.description, "event:100").length, 0);
});

test("production HTTP client never sends editor envelopes without durable storage", async () => {
  let calls = 0;
  const request = createIntervalsClient({ INTERVALS_API_KEY: "fixture" }, async () => {
    calls++;
    return Response.json({});
  });
  await assert.rejects(
    request("/athlete/0/events/100", {
      method: "PUT",
      body: JSON.stringify({ description: description() }),
    }),
    /storage is unavailable/
  );
  assert.equal(calls, 0);
});

test("a full 12,000-character description saves and remains editable without counting private JSON against the provider limit", async () => {
  const provider = fakeProvider(fixtureEvent("Run")),
    store = memory();
  const request = store.wrap()(provider.request);
  const text = "Keep the effort comfortable. ".repeat(1000).slice(0, 12000);
  const loaded = await loadNewWorkoutEditor(request, "2026-10-21", { sport: "Run" });
  loaded.model.steps = [newStep("Run")];
  loaded.model.notes = text;
  const saved = await createWorkoutEditor(request, {
    model: loaded.model,
    creationId: "d052a046-10e8-4709-8d2e-453307b13e24",
    descriptionMode: "manual",
    description: text,
  });
  assert.equal(saved.verified, true);
  assert.ok(
    saved.event.description.length > 30000,
    "The private representation exceeds the old limit"
  );
  const rawCreated = await provider.request(`/athlete/0/events/${saved.workoutId.split(":")[1]}`);
  assert.ok(rawCreated.description.length < 30000);
  noMachineData(rawCreated.description);
  const fresh = await loadWorkoutEditor(store.wrap()(provider.request), saved.workoutId);
  assert.equal(fresh.manualDescription, text);
  assert.equal(fresh.model.notes, text);
  await savePlannedWorkoutMetrics(request, saved.workoutId, {
    revision: fresh.revision,
    values: { tss: 42 },
  });
  await saveProviderWorkoutComment(request, {
    workoutId: saved.workoutId,
    body: "Long description retained.",
    type: "post",
    creationId: "65c4b9f6-d1be-4a7b-b1ed-599367a37d54",
  });
  const updatedText = "Updated instructions. ".repeat(1000).slice(0, 12000);
  await updateWorkoutDescription(request, saved.workoutId, updatedText, {
    descriptionMode: "manual",
  });
  const reopened = await loadWorkoutEditor(store.wrap()(provider.request), saved.workoutId);
  assert.equal(reopened.manualDescription, updatedText);
  assert.equal(reopened.plannedValues.tss, 42);
  assert.equal(reopened.comments[0].body, "Long description retained.");
  const rawReopened = await provider.request(`/athlete/0/events/${saved.workoutId.split(":")[1]}`);
  assert.deepEqual(verifyParsedWorkout(loaded.model, rawReopened), []);
  noMachineData(rawReopened.description);
});

test("the actual 30,000-character provider ceiling still rejects oversized prose before any write", async () => {
  const store = memory();
  let writes = 0;
  const request = store.wrap()(async () => {
    writes++;
  });
  await assert.rejects(
    request("/athlete/0/events/100", {
      method: "PUT",
      body: JSON.stringify({ description: "x".repeat(30001) }),
    }),
    (error) => error.code === "WORKOUT_TEXT_LIMIT"
  );
  assert.equal(writes, 0);
  assert.equal(store.records.size, 0);
  assert.throws(
    () => serializeManualWorkout(importWorkout(fixtureEvent()).model, "x".repeat(30000)),
    /30,000 character export limit/
  );
});

test("production HTTP and encrypted storage round-trip independently verified native steps without sending JSON to ICU", async () => {
  const provider = fakeProvider(fixtureEvent("Ride"));
  const database = new Map(),
    outbound = [];
  const config = {
    INTERVALS_API_KEY: "fixture-key",
    SUPABASE_URL: "https://metadata-fixture.supabase.co",
    SUPABASE_SECRET_KEY: "sb_secret_metadata_fixture_abcdefghijklmnopqrstuvwxyz",
  };
  const transport = async (href, options = {}) => {
    const url = new URL(href);
    if (url.origin === config.SUPABASE_URL) {
      assert.equal(options.headers.apikey, config.SUPABASE_SECRET_KEY);
      assert.doesNotMatch(JSON.stringify(options.headers), /API_KEY:|fixture-key/);
      const query = url.searchParams;
      if (options.method === "POST") {
        const [row] = JSON.parse(options.body),
          key = `${row.scope}:${row.name}`;
        if (database.has(key)) return Response.json([]);
        database.set(key, row);
        return Response.json([row]);
      }
      const key = `${query.get("scope").slice(3)}:${query.get("name").slice(3)}`,
        row = database.get(key);
      if (options.method === "PATCH") {
        if (row?.updated_at !== query.get("updated_at")?.slice(3)) return Response.json([]);
        const next = JSON.parse(options.body);
        database.set(key, next);
        return Response.json([next]);
      }
      return Response.json(row ? [row] : []);
    }
    assert.equal(url.origin, "https://intervals.icu");
    assert.doesNotMatch(JSON.stringify(options.headers), /sb_secret_/);
    if (options.body) {
      const body = JSON.parse(options.body);
      outbound.push(body);
      if (typeof body.description === "string") noMachineData(body.description);
    }
    return Response.json(
      await provider.request(url.pathname.replace("/api/v1", "") + url.search, options)
    );
  };
  const request = createIntervalsClient(config, transport);
  const loaded = await loadWorkoutEditor(request, "event:100");
  loaded.model.steps[0].end.value = 420;
  const saved = await saveWorkoutEditor(request, "event:100", {
    model: loaded.model,
    revision: loaded.revision,
    descriptionMode: "manual",
    description: "Private fixture instructions",
    values: { tss: 39, intensity_factor: 0.74 },
    comment: "Fixture comment",
    commentId: "be068336-b99b-43c4-9552-740902d7f40e",
  });
  assert.equal(saved.verified, true);
  assert.equal(outbound.length, 1);
  assert.equal(outbound[0].load_target, 39);
  assert.equal(Object.hasOwn(outbound[0], "icu_intensity"), false);
  assert.deepEqual(verifyParsedWorkout(loaded.model, provider.event()), []);
  for (const row of database.values()) {
    assert.match(row.encrypted_value, /^v1\./);
    assert.doesNotMatch(
      row.encrypted_value,
      /Private fixture instructions|Fixture comment|Workout editor/
    );
  }
  assert.ok(database.size >= 2);
  const reopened = await loadWorkoutEditor(createIntervalsClient(config, transport), "event:100");
  assert.deepEqual(reopened.model, loaded.model);
  assert.equal(reopened.manualDescription, "Private fixture instructions");
  assert.equal(reopened.plannedValues.intensity_factor, 0.74);
  assert.equal(reopened.plannedValues.tss, 39);
  assert.equal(reopened.comments[0].body, "Fixture comment");
});

test("bulk creation and workout-library templates retain isolated metadata on subsequent list reads", async () => {
  const store = memory();
  const library = new Map();
  const raw = async (_path, options = {}) => {
    if (options.method === "POST") {
      const body = JSON.parse(options.body),
        rows = Array.isArray(body) ? body : [body];
      const saved = rows.map((row, i) => ({ ...row, id: i + 1 }));
      for (const row of saved) {
        noMachineData(row.description);
        library.set(row.id, row);
      }
      return Array.isArray(body) ? saved : saved[0];
    }
    return structuredClone([...library.values()]);
  };
  const request = store.wrap()(raw);
  const first = description(fixtureEvent(), "First instructions"),
    second = description(fixtureEvent(), "Second instructions");
  const saved = await request("/athlete/0/events/bulk?upsert=true", {
    method: "POST",
    body: JSON.stringify([
      { external_id: "bulk-one", description: first },
      { external_id: "bulk-two", description: second },
    ]),
  });
  assert.equal(saved[0].description, first);
  assert.equal(saved[1].description, second);
  const listed = await store.wrap()(raw)("/athlete/0/events?oldest=2026-10-01&newest=2026-10-31");
  assert.equal(listed[0].description, first);
  assert.equal(listed[1].description, second);
  const template = await request("/athlete/0/workouts", {
    method: "POST",
    body: JSON.stringify({ tags: ["training-agent-event-100"], description: first }),
  });
  assert.equal(template.description, first);
  assert.equal((await store.wrap()(raw)("/athlete/0/workouts"))[0].description, first);
});

test("one corrupt library metadata text preserves ordinary templates with explicit read-only warning while singular reads fail closed", async () => {
  const store = memory(),
    library = new Map(),
    privateDescription = description(fixtureEvent(), "Private template instruction");
  const raw = async (path, options = {}) => {
    if (options.method === "POST") {
      const row = { id: 1, ...JSON.parse(options.body) };
      library.set(1, row);
      return structuredClone(row);
    }
    if (path === "/athlete/0/workouts") return structuredClone([...library.values()]);
    return structuredClone(library.get(Number(path.split("/").at(-1))));
  };
  await store.wrap()(raw)("/athlete/0/workouts", {
    method: "POST",
    body: JSON.stringify({
      name: "Private template",
      type: "Ride",
      tags: ["training-agent-event-100"],
      description: privateDescription,
    }),
  });
  library.set(2, {
    id: 2,
    name: "Independent native template",
    type: "Run",
    description: "- 600s Z2 HR",
  });
  for (const [key, value] of store.records)
    if (key.startsWith("text:")) value.text = "Corrupt stored payload";
  const listed = await store.wrap()(raw)("/athlete/0/workouts");
  assert.equal(listed.length, 2);
  assert.equal(listed[0].structure_read_only, true);
  assert.match(listed[0].workout_metadata_error, /unavailable/);
  assert.equal(listed[1].description, "- 600s Z2 HR");
  assert.equal(Object.hasOwn(listed[1], "workout_metadata_error"), false);
  await assert.rejects(store.wrap()(raw)("/athlete/0/workouts/1"), /could not be verified/);
});
test("unavailable metadata index does not hide plain native library items or silently declare app snapshots usable", async () => {
  const rows = [
    {
      id: 1,
      name: "Legacy app template",
      type: "Ride",
      tags: ["training-agent-event-100"],
      description: "- 600s 150w",
    },
    { id: 2, name: "Ordinary native template", type: "Run", description: "- 600s Z2 HR" },
  ];
  const wrapped = createProviderWorkoutMetadata({
    record: () => ({
      read: async () => {
        throw Error("Synthetic metadata unavailable");
      },
      update: async () => {
        throw Error("Unexpected write");
      },
    }),
  }).wrap(async (path) =>
    path.endsWith("/workouts") ? structuredClone(rows) : structuredClone(rows[0])
  );
  const listed = await wrapped("/athlete/0/workouts");
  assert.equal(listed.length, 2);
  assert.equal(listed[0].structure_read_only, true);
  assert.equal(Object.hasOwn(listed[1], "workout_metadata_error"), false);
  assert.deepEqual(listed[1], rows[1]);
  await assert.rejects(wrapped("/athlete/0/workouts/1"), /metadata unavailable/);
});
