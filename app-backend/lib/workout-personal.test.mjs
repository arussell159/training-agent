import test from "node:test";
import assert from "node:assert/strict";
import {
  createWorkoutPersonalService,
  validateWorkoutPersonal,
  validateWorkoutAttachment,
  ATTACHMENT_MAX_BYTES,
} from "./workout-personal.mjs";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";

const value = {
  privateNotes: "Finish controlled.",
  tags: ["track"],
  equipment: "Daily trainer",
  autoCalculate: false,
};
const draftId = "draft:12345678-1234-1234-1234-123456789012";
function harness() {
  const records = new Map(),
    authorized = [],
    control = {};
  const record = (key, fresh) => ({
    async read() {
      return structuredClone(records.get(key) || fresh());
    },
    async update(change) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const before = records.get(key),
          state = structuredClone(before || fresh()),
          result = change(state);
        await control.beforeCommit?.(key, state);
        if (records.get(key) !== before) continue;
        records.set(key, state);
        return result;
      }
      throw Error("Fixture CAS exhausted");
    },
  });
  return {
    service: createWorkoutPersonalService({
      record,
      authorizeWorkout: async (id) => authorized.push(id),
    }),
    records,
    authorized,
    control,
  };
}
const attachment = (name = "instructions.pdf", text = "PDF test fixture") => ({
  name,
  data: Buffer.from(text).toString("base64"),
});

test("personal fields survive new service instances and equipment suggestions are account-wide", async () => {
  const { service, records, authorized } = harness();
  assert.equal((await service.read("event:1")).revision, 0);
  const saved = await service.save("event:1", { value, revision: 0 });
  assert.equal(saved.revision, 1);
  assert.deepEqual((await service.read("event:1")).value, value);
  assert.deepEqual((await service.read("event:2")).equipmentOptions, ["Daily trainer"]);
  assert.equal(records.get("workout/event:1").fields.privateNotes, value.privateNotes);
  assert.ok(authorized.every((id) => id.startsWith("event:")));
});
test("stale revisions never overwrite another device's changes; identical retry is safe", async () => {
  const { service } = harness();
  await service.save("event:1", { value, revision: 0 });
  await assert.rejects(
    service.save("event:1", { value: { ...value, privateNotes: "stale edit" }, revision: 0 }),
    { code: "PERSONAL_CONFLICT" }
  );
  assert.deepEqual((await service.save("event:1", { value, revision: 0 })).value, value);
});
test("device migration imports only into an empty remote record", async () => {
  const { service } = harness();
  await service.save("event:1", { value, revision: 0 });
  const result = await service.save("event:1", {
    value: { ...value, privateNotes: "old browser copy" },
    revision: 0,
    importOnly: true,
  });
  assert.equal(result.value.privateNotes, value.privateNotes);
});
test("attachments upload idempotently, download exact bytes, and delete durably", async () => {
  const { service, records } = harness();
  const uploaded = await service.upload("event:1", attachment());
  const file = uploaded.attachments[0];
  assert.equal((await service.upload("event:1", attachment())).attachments.length, 1);
  assert.equal(
    Buffer.from((await service.attachment("event:1", file.id)).data, "base64").toString(),
    "PDF test fixture"
  );
  await assert.rejects(service.attachment("event:2", file.id), { status: 404 });
  assert.equal((await service.removeAttachment("event:1", file.id)).attachments.length, 0);
  assert.deepEqual(records.get(`attachment/${file.id}`), { deleted: true });
  await assert.rejects(service.attachment("event:1", file.id), { status: 404 });
});
test("draft migration carries files and notes to the verified workout without duplicates", async () => {
  const { service } = harness();
  await service.upload(draftId, attachment());
  await service.save(draftId, { value, revision: 1 });
  const saved = await service.save("event:1", { value, revision: 0, migrateFrom: draftId });
  assert.equal(saved.attachments.length, 1);
  assert.equal(
    (await service.save("event:1", { value, revision: 0, migrateFrom: draftId })).attachments
      .length,
    1
  );
  assert.equal(
    (await service.attachment("event:1", saved.attachments[0].id)).name,
    "instructions.pdf"
  );
  await assert.rejects(service.save("event:2", { value, revision: 0, migrateFrom: draftId }), {
    code: "PERSONAL_CONFLICT",
  });
  await assert.rejects(service.removeAttachment(draftId, saved.attachments[0].id), {
    code: "PERSONAL_DRAFT_MOVED",
  });
  assert.equal(
    (await service.attachment("event:1", saved.attachments[0].id)).name,
    "instructions.pdf"
  );
});
function pauseOnce(control, matches) {
  let entered, release;
  const paused = new Promise((resolve) => {
    entered = resolve;
  });
  const resume = new Promise((resolve) => {
    release = resolve;
  });
  control.beforeCommit = async (key, state) => {
    if (!matches(key, state)) return;
    control.beforeCommit = undefined;
    entered();
    await resume;
  };
  return { paused, release };
}
test("migration reserves the draft before a concurrent upload can acknowledge an omitted file", async () => {
  const { service, control } = harness();
  const first = await service.upload(draftId, attachment());
  const gate = pauseOnce(control, (key) => key.startsWith("attachment/"));
  const upload = service.upload(draftId, attachment("second.txt", "second"));
  await gate.paused;
  const migrated = await service.save("event:1", { value, revision: 0, migrateFrom: draftId });
  gate.release();
  await assert.rejects(upload, { code: "PERSONAL_DRAFT_MOVED" });
  assert.equal(migrated.attachments.length, 1);
  assert.equal(
    (await service.attachment("event:1", first.attachments[0].id)).name,
    "instructions.pdf"
  );
});
test("a deletion racing a draft migration cannot erase a migrated attachment", async () => {
  const { service, control } = harness();
  const uploaded = await service.upload(draftId, attachment()),
    fileId = uploaded.attachments[0].id;
  const gate = pauseOnce(
    control,
    (key, state) => key === `workout/${draftId}` && state.pendingDeletes?.length
  );
  const remove = service.removeAttachment(draftId, fileId);
  await gate.paused;
  await service.save("event:1", { value, revision: 0, migrateFrom: draftId });
  gate.release();
  await assert.rejects(remove, { code: "PERSONAL_DRAFT_MOVED" });
  assert.equal((await service.attachment("event:1", fileId)).name, "instructions.pdf");
});
test("re-upload during deletion uses a new blob generation and survives the old cleanup", async () => {
  const { service, control } = harness();
  const original = await service.upload("event:1", attachment()),
    oldId = original.attachments[0].id;
  const gate = pauseOnce(control, (key, state) => key === `attachment/${oldId}` && state.deleted);
  const remove = service.removeAttachment("event:1", oldId);
  await gate.paused;
  const replacement = await service.upload("event:1", attachment()),
    newId = replacement.attachments[0].id;
  assert.notEqual(newId, oldId);
  gate.release();
  await remove;
  assert.equal((await service.attachment("event:1", newId)).name, "instructions.pdf");
});
test("validations reject unsafe filenames, executable formats, oversized bodies and unknown metadata", () => {
  assert.throws(() => validateWorkoutAttachment(attachment("../secrets.pdf")));
  assert.throws(() => validateWorkoutAttachment(attachment("run.html")));
  assert.throws(
    () =>
      validateWorkoutAttachment({
        name: "large.pdf",
        data: Buffer.alloc(ATTACHMENT_MAX_BYTES + 1).toString("base64"),
      }),
    { status: 413 }
  );
  assert.throws(() => validateWorkoutPersonal({ ...value, owner: "another-account" }));
  assert.throws(() => validateWorkoutPersonal({ ...value, privateNotes: "x".repeat(2001) }));
});
test("authorization failure prevents metadata and attachment operations", async () => {
  let storageAccessed = false;
  const service = createWorkoutPersonalService({
    record: () => {
      storageAccessed = true;
      throw Error("should not run");
    },
    authorizeWorkout: async () => {
      throw Object.assign(Error("Denied"), { status: 403 });
    },
  });
  await assert.rejects(service.read("event:1"), { status: 403 });
  await assert.rejects(service.upload("event:1", attachment()), { status: 403 });
  assert.equal(storageAccessed, false);
});
test("attachment count limit is enforced before accepting another blob", async () => {
  const { service, records } = harness();
  for (let i = 0; i < 10; i++) await service.upload("event:1", attachment(`${i}.txt`, `file ${i}`));
  await assert.rejects(service.upload("event:1", attachment("extra.txt")), {
    code: "ATTACHMENT_LIMIT",
  });
  assert.equal([...records.keys()].filter((key) => key.startsWith("attachment/")).length, 10);
});

test("actual encrypted storage isolates accounts and never stores plaintext note or file data", async () => {
  const rows = new Map();
  const fetchImpl = async (url, options) => {
    const params = new URL(url).searchParams;
    if (options.method === "POST") {
      const [row] = JSON.parse(options.body),
        key = `${row.scope}:${row.name}`;
      if (rows.has(key)) return { ok: true, json: async () => [] };
      rows.set(key, row);
      return { ok: true, json: async () => [row] };
    }
    const key = `${params.get("scope").slice(3)}:${params.get("name").slice(3)}`,
      current = rows.get(key);
    if (options.method === "PATCH") {
      if (current?.updated_at !== params.get("updated_at").slice(3))
        return { ok: true, json: async () => [] };
      const row = JSON.parse(options.body);
      rows.set(key, row);
      return { ok: true, json: async () => [row] };
    }
    return { ok: true, json: async () => (current ? [current] : []) };
  };
  const bootstrap = {
    SUPABASE_URL: "https://personal-fixture.supabase.co",
    SUPABASE_SECRET_KEY: "fixture-private-key",
    SETTINGS_ENCRYPTION_KEY: "fixture-encryption-material",
  };
  const service = (account) =>
    createWorkoutPersonalService({
      record: (key, fresh) =>
        createEncryptedRecordStore(
          bootstrap,
          `${account}/${key}`,
          { namespace: "workout-personal", name: "WORKOUT_PERSONAL", timestampCas: true, fresh },
          fetchImpl
        ),
    });
  await service("a").save("event:1", { value, revision: 0 });
  await service("a").upload("event:1", attachment());
  assert.deepEqual((await service("a").read("event:1")).value, value);
  assert.equal((await service("b").read("event:1")).value.privateNotes, "");
  const persisted = JSON.stringify([...rows.values()]);
  assert.ok(!persisted.includes(value.privateNotes));
  assert.ok(!persisted.includes("PDF test fixture"));
  assert.ok(!persisted.includes(attachment().data));
});
