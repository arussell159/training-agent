import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { contentFingerprint as hash } from "./content-fingerprint.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import { strengthLibraryAccount } from "./strength-exercise-library.mjs";
import { workoutRevision } from "./workout-editor.mjs";
import { importWorkout, readEditorModel, validateWorkout } from "./workout-editor-model.mjs";
import {
  readManualWorkoutDescription,
  serializeManualWorkout,
} from "./workout-manual-description.mjs";
import { readPlannedValues, withPlannedValues } from "./planned-workout-values.mjs";
import { providerWorkoutDescription } from "./workout-provider-description.mjs";
import { readWorkoutLibrary } from "./workout-library.mjs";
import {
  validateWorkoutTemplateInput,
  workoutTemplateScope,
  workoutTemplateOperation,
} from "./workout-template-model.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message, status = 502, code = "TEMPLATE_UNCONFIRMED", extra = {}) => {
  throw Object.assign(Error(message), { status, code, ...extra });
};
const tagPrefix = "training-agent-template-";
const tagPattern = /^training-agent-template-([a-f0-9]{64})$/;
const nativeFields = [
  "moving_time",
  "distance",
  "icu_training_load",
  "icu_intensity",
  "joules",
  "joules_above_ftp",
  "target",
  "targets",
  "indoor",
  "color",
  "carbs_per_hour",
  "sub_type",
];
const equal = (left, right) => hash(left ?? null) === hash(right ?? null);
const nativeMatches = (row, body) =>
  object(row) &&
  Object.entries(body).every(([key, value]) =>
    equal(key === "description" ? providerWorkoutDescription(row[key]) : row[key], value)
  );
const intentInput = (input) =>
  Object.fromEntries(Object.entries(input).filter(([key]) => key !== "reconcileOnly"));
const fresh = () => ({ version: 1, operation: null });

export function workoutTemplateAccount(config, actor) {
  // The current provider binding is intentionally retained: key rotation cannot
  // silently replay a previous account's intent. Stable credential migration is
  // a separate application-wide concern.
  return hash({
    actor: strengthLibraryAccount(config, actor),
    provider: providerConnection(config),
  });
}
export function createWorkoutTemplateService({
  request,
  record,
  accountScope,
  readOnly = false,
  now = () => new Date(),
}) {
  if (!workoutTemplateScope(accountScope) || typeof readOnly !== "boolean")
    fail("Sign in to the workout library.", 401, "TEMPLATE_AUTH");
  const operationKey = (operationId) => hash({ accountScope, operationId });
  const operationStore = (key) => record(`${accountScope}/${key}`, fresh);
  const publicIntent = (op) => ({
    sourceWorkoutId: op.sourceId,
    sourceRevision: op.input.sourceRevision,
    folderId: op.input.folderId,
    folderRevision: op.input.folderRevision,
    title: op.body.name,
  });
  function validateState(state, key) {
    const op = state?.operation;
    if (!object(state) || state.version !== 1 || JSON.stringify(state).length > 1_000_000)
      fail("The retained library save could not be verified.");
    if (op === null) return null;
    if (
      !object(op) ||
      !object(op.input) ||
      validateWorkoutTemplateInput(op.input).length ||
      op.input.accountScope !== accountScope ||
      operationKey(op.input.operationId) !== key ||
      !/^event:[1-9]\d*$/.test(op.sourceId || "") ||
      !["prepared", "attempted", "rejected", "verified"].includes(op.state) ||
      typeof op.description !== "string" ||
      op.description.length > 800_000 ||
      !object(op.body) ||
      op.body.name !== op.input.title.trim() ||
      String(op.body.folder_id) !== op.input.folderId.slice(7) ||
      !Array.isArray(op.body.tags) ||
      op.body.tags.length !== 1 ||
      op.body.tags[0] !== tagPrefix + key ||
      op.body.description !== providerWorkoutDescription(op.description) ||
      !workoutTemplateScope(op.snapshotHash) ||
      op.snapshotHash !== hash({ body: op.body, description: op.description }) ||
      (op.workoutId !== undefined && !/^[1-9]\d*$/.test(op.workoutId))
    )
      fail("The retained library save could not be verified.");
    const model = readEditorModel(op.description);
    if (
      !model ||
      validateWorkout(model).length ||
      model.name !== op.body.name ||
      model.sport !== op.body.type
    )
      fail("The retained library prescription could not be verified.");
    return op;
  }
  async function folderSnapshot() {
    const [athlete, folders] = await Promise.all([
      request("/athlete/0"),
      request("/athlete/0/folders"),
    ]);
    if (
      !object(athlete) ||
      !/^[A-Za-z0-9_-]{1,80}$/.test(String(athlete.id || "")) ||
      String(athlete.id) === "0" ||
      !Array.isArray(folders) ||
      folders.length > 10_000
    )
      fail("The workout library folders could not be verified.", 502, "TEMPLATE_FOLDERS_INVALID");
    const seen = new Set(),
      result = [];
    for (const row of folders) {
      if (!object(row) || row.type !== "FOLDER" || !/^[1-9]\d*$/.test(String(row.id || "")))
        continue;
      const id = `folder:${row.id}`;
      if (seen.has(id))
        fail(
          "The workout library folders contain duplicate identities.",
          502,
          "TEMPLATE_FOLDERS_INVALID"
        );
      seen.add(id);
      const owned = String(row.athlete_id ?? "") === String(athlete.id);
      if (!owned || row.visibility !== "PRIVATE") continue;
      if (typeof row.name !== "string" || !row.name.trim() || row.name.length > 1000)
        fail(
          "The workout library folder name could not be verified.",
          502,
          "TEMPLATE_FOLDERS_INVALID"
        );
      const revision = hash({
        accountScope,
        id,
        name: row.name,
        owner: athlete.id,
        visibility: row.visibility,
        canEdit: row.canEdit ?? null,
        readOnly: row.read_only_workouts ?? null,
        updated: row.updated ?? null,
      });
      result.push({
        id,
        name: row.name,
        revision,
        editable: !readOnly && row.canEdit === true && row.read_only_workouts !== true,
      });
    }
    return { accountScope, readOnly, folders: result };
  }
  async function assertFolder(input) {
    const folders = await folderSnapshot(),
      selected = folders.folders.find((folder) => folder.id === input.folderId);
    if (!selected || selected.revision !== input.folderRevision)
      fail(
        "The selected library folder changed. Reload the folders.",
        409,
        "TEMPLATE_FOLDER_CHANGED"
      );
    if (!selected.editable) fail("The selected folder is read-only.", 403, "TEMPLATE_READ_ONLY");
  }
  async function sourceSnapshot(sourceId, input) {
    const source = await request(`/athlete/0/events/${sourceId.slice(6)}`);
    if (!object(source) || String(source.id) !== sourceId.slice(6))
      fail("Reload the source workout.", 502, "TEMPLATE_SOURCE_INVALID");
    if (
      source.category !== "WORKOUT" ||
      source.read_only ||
      source.readonly ||
      source.editable === false ||
      source.athlete_cannot_edit ||
      source.structure_read_only
    )
      fail("This workout cannot be saved as a template.", 403, "TEMPLATE_READ_ONLY");
    if (workoutRevision(source) !== input.sourceRevision)
      fail(
        "The saved workout changed. Reload it before adding a template.",
        409,
        "TEMPLATE_SOURCE_CHANGED"
      );
    const imported = importWorkout(source);
    if (imported.issues.length || validateWorkout(imported.model).length)
      fail(
        "The complete workout prescription is unavailable. Reload the original before saving a template.",
        409,
        "TEMPLATE_SOURCE_CHANGED"
      );
    const model = structuredClone(imported.model);
    model.name = input.title.trim();
    if (validateWorkout(model).length)
      fail("Enter a valid template title.", 400, "TEMPLATE_INVALID");
    // Comments and athlete recording/attachment/personal data are not template
    // instructions. Preserve only prescription, human introduction and planned
    // values, with a fresh native identity and no calendar date or source tags.
    const description = withPlannedValues(
      serializeManualWorkout(model, readManualWorkoutDescription(source, imported.model)),
      readPlannedValues(source.description)
    );
    const body = {
      folder_id: Number(input.folderId.slice(7)),
      name: model.name,
      type: model.sport,
      description: providerWorkoutDescription(description),
      tags: [tagPrefix + operationKey(input.operationId)],
    };
    for (const field of nativeFields)
      if (Object.hasOwn(source, field)) {
        const value = source[field];
        const valid =
          value === null ||
          (field === "indoor"
            ? typeof value === "boolean"
            : field === "color"
              ? typeof value === "string" && value.length <= 100
              : field === "target"
                ? ["AUTO", "POWER", "HR", "PACE"].includes(value)
                : field === "targets"
                  ? Array.isArray(value) &&
                    value.length <= 4 &&
                    new Set(value).size === value.length &&
                    value.every((target) => ["AUTO", "POWER", "HR", "PACE"].includes(target))
                  : field === "sub_type"
                    ? ["NONE", "COMMUTE", "WARMUP", "COOLDOWN", "RACE"].includes(value)
                    : typeof value === "number" &&
                      Number.isFinite(value) &&
                      value >= 0 &&
                      value <= 1e10 &&
                      (["distance", "icu_intensity"].includes(field) || Number.isInteger(value)));
        if (!valid)
          fail(
            "A source workout planning value is invalid. Reload the saved workout.",
            502,
            "TEMPLATE_SOURCE_INVALID"
          );
        body[field] = structuredClone(value);
      }
    if (body.description.length > 30_000)
      fail("The template instructions exceed the provider text limit.", 400, "TEMPLATE_INVALID");
    return { body, description };
  }
  async function hydrateTemplate(row) {
    if (!object(row) || !Array.isArray(row.tags)) return row;
    // The shared metadata adapter may already carry a newer revision. Never
    // replace that with this operation's immutable original snapshot.
    if (readEditorModel(row.description)) return row;
    const markers = row.tags
      .map((tag) => typeof tag === "string" && tag.match(tagPattern)?.[1])
      .filter(Boolean);
    if (!markers.length) return row;
    if (markers.length !== 1)
      fail("The template has conflicting saved identities.", 409, "TEMPLATE_METADATA_UNAVAILABLE");
    const key = markers[0];
    let op;
    try {
      op = validateState(await operationStore(key).read(), key);
    } catch {
      fail(
        "The private template prescription is unavailable. Reload before scheduling.",
        409,
        "TEMPLATE_METADATA_UNAVAILABLE"
      );
    }
    if (
      !op ||
      op.state !== "verified" ||
      String(row.id) !== op.workoutId ||
      !nativeMatches(row, op.body)
    )
      fail(
        "The private template prescription is unavailable. Reload before scheduling.",
        409,
        "TEMPLATE_METADATA_UNAVAILABLE"
      );
    return { ...row, description: op.description };
  }
  async function listTemplates() {
    const rows = await request("/athlete/0/workouts");
    if (!Array.isArray(rows) || rows.length > 10_000)
      fail("The workout library could not be verified.");
    const workouts = [],
      metadataWarnings = [];
    for (let start = 0; start < rows.length; start += 8) {
      const batch = await Promise.all(
        rows.slice(start, start + 8).map(async (row) => {
          let hydrated = row,
            message = null;
          try {
            if (row?.workout_metadata_error) throw Error("Private metadata unavailable");
            hydrated = await hydrateTemplate(row);
          } catch {
            message = "The private template prescription is unavailable. Reload before scheduling.";
          }
          const [workout] = await readWorkoutLibrary(async () => [hydrated]);
          return message
            ? {
                workout: {
                  ...workout,
                  structure_read_only: true,
                  template_metadata_error: message,
                },
                warning: { workoutId: workout.id, message },
              }
            : { workout };
        })
      );
      for (const item of batch) {
        workouts.push(item.workout);
        if (item.warning) metadataWarnings.push(item.warning);
      }
    }
    return { workouts, metadataWarnings };
  }
  function wrapLibraryReads(originalRequest) {
    return async (path, options = {}) => {
      if (readOnly && !["GET", "HEAD"].includes((options.method || "GET").toUpperCase()))
        fail("The workout library is read-only.", 403, "TEMPLATE_READ_ONLY");
      const value = await originalRequest(path, options);
      if (
        (options.method || "GET").toUpperCase() !== "GET" ||
        !/^\/athlete\/[^/]+\/workouts(?:\/[1-9]\d*)?(?:\?|$)/.test(path)
      )
        return value;
      const rows = Array.isArray(value) ? value : [value];
      if (rows.some((row) => row?.workout_metadata_error))
        fail(
          "The private template prescription is unavailable. Reload before scheduling.",
          409,
          "TEMPLATE_METADATA_UNAVAILABLE"
        );
      if (rows.length > 10_000) fail("The workout library exceeds the safe read limit.");
      const hydrated = [];
      for (let start = 0; start < rows.length; start += 8)
        hydrated.push(...(await Promise.all(rows.slice(start, start + 8).map(hydrateTemplate))));
      return Array.isArray(value) ? hydrated : hydrated[0];
    };
  }
  async function save(sourceId, input) {
    const errors = validateWorkoutTemplateInput(input);
    if (errors.length || !/^event:[1-9]\d*$/.test(sourceId || ""))
      fail(errors[0] || "Choose a saved workout.", 400, "TEMPLATE_INVALID");
    if (input.accountScope !== accountScope)
      fail(
        "The library account changed. Return to the original account to recheck this save.",
        409,
        "TEMPLATE_ACCOUNT_CHANGED"
      );
    if (readOnly) fail("The workout library is read-only.", 403, "TEMPLATE_READ_ONLY");
    const key = operationKey(input.operationId),
      store = operationStore(key),
      expected = intentInput(input);
    let op = validateState(await store.read(), key);
    if (!op && input.reconcileOnly)
      fail("This save has not been confirmed. Rechecking does not create a template.");
    if (!op) {
      await assertFolder(input);
      const snapshot = await sourceSnapshot(sourceId, input);
      await store.update((state) => {
        const current = validateState(state, key);
        if (current) return;
        const operation = {
          input: expected,
          sourceId,
          ...snapshot,
          snapshotHash: hash(snapshot),
          state: "prepared",
          createdAt: now().toISOString(),
        };
        validateState({ version: 1, operation }, key);
        state.operation = operation;
      });
      op = validateState(await store.read(), key);
    }
    if (!op || op.sourceId !== sourceId || !equal(op.input, expected))
      fail(
        "This save identity belongs to another template request. Recheck its original details.",
        409,
        "TEMPLATE_INTENT_CHANGED"
      );
    const changed = (workoutId) =>
      fail(
        "The template was saved and later changed or deleted. Reload the saved template before making a new request.",
        409,
        "TEMPLATE_REPLAY_CHANGED",
        { accountScope, operationId: input.operationId, workoutId: `library:${workoutId}` }
      );
    const verify = async (id) => {
      if (!/^[1-9]\d*$/.test(String(id))) fail("The provider did not confirm a template identity.");
      let native;
      try {
        native = await request(`/athlete/0/workouts/${id}`);
      } catch (error) {
        if (error.status === 404 && op.workoutId) changed(id);
        throw error;
      }
      if (String(native?.id) !== String(id) || !nativeMatches(native, op.body)) {
        if (op.workoutId) changed(id);
        fail("The template differs from the retained save. Recheck this same request.");
      }
      await store.update((state) => {
        const current = validateState(state, key);
        if (
          !current ||
          !equal(current.input, expected) ||
          current.snapshotHash !== op.snapshotHash ||
          current.state === "rejected"
        )
          fail("The retained template save changed.");
        current.state = "verified";
        current.workoutId = String(id);
      });
      const exact = { ...native, description: op.description };
      const [workout] = await readWorkoutLibrary(async () => [exact]);
      return {
        accountScope,
        operationId: input.operationId,
        verified: true,
        workoutId: `library:${id}`,
        workout,
        intent: publicIntent(op),
      };
    };
    const find = async () => {
      const rows = await request("/athlete/0/workouts");
      if (!Array.isArray(rows) || rows.length > 10_000)
        fail("The template lookup could not be verified.");
      const matches = rows.filter(
        (row) => Array.isArray(row?.tags) && row.tags.includes(op.body.tags[0])
      );
      if (matches.length > 1) fail("Multiple templates match this save. No template was changed.");
      return matches[0];
    };
    if (op.state === "rejected")
      fail(
        "The provider rejected this template save. Correct the issue and start a new explicit save.",
        422,
        "TEMPLATE_REJECTED"
      );
    if (op.workoutId) return verify(op.workoutId);
    const existing = await find();
    if (existing) return verify(existing.id);
    if (input.reconcileOnly)
      fail(
        "The template is not confirmed. Recheck this same request; no duplicate will be created."
      );
    // A previous write-ahead save may have survived an interrupted response.
    // Every still-prepared first native write rechecks current folder privacy
    // and ownership immediately before its cross-instance claim.
    if (op.state === "prepared") await assertFolder(input);
    const claimed = await store.update((state) => {
      const current = validateState(state, key);
      if (!current || current.state !== "prepared") return false;
      current.state = "attempted";
      return true;
    });
    if (!claimed) fail("This save was already attempted. Recheck the original request.");
    let created;
    try {
      created = await request("/athlete/0/workouts", {
        method: "POST",
        body: JSON.stringify(op.body),
      });
    } catch (error) {
      if ([400, 401, 403, 422].includes(error.status)) {
        try {
          await store.update((state) => {
            const current = validateState(state, key);
            if (current?.state === "attempted") current.state = "rejected";
          });
        } catch {
          /* The original definite provider rejection remains authoritative. */
        }
        fail("Intervals.icu rejected the template save.", error.status, "TEMPLATE_REJECTED");
      }
      try {
        const found = await find();
        if (found) return await verify(found.id);
      } catch {
        /* Keep the immutable ambiguous operation. */
      }
      fail("The template save could not be confirmed. Recheck the same request.");
    }
    if (!created?.id) fail("The template save could not be confirmed. Recheck the same request.");
    return verify(created.id);
  }
  async function inspect(operationId, expectedAccountScope) {
    if (!workoutTemplateOperation(operationId) || !workoutTemplateScope(expectedAccountScope))
      fail("Choose a retained library save.", 400, "TEMPLATE_INVALID");
    if (expectedAccountScope !== accountScope)
      fail(
        "The library account changed. Return to the original account.",
        409,
        "TEMPLATE_ACCOUNT_CHANGED"
      );
    const key = operationKey(operationId),
      op = validateState(await operationStore(key).read(), key);
    if (!op)
      fail("The retained library operation is unavailable.", 404, "TEMPLATE_OPERATION_NOT_FOUND");
    const base = {
      accountScope,
      operationId,
      workoutId: op.workoutId ? `library:${op.workoutId}` : null,
      workout: null,
      intent: publicIntent(op),
    };
    if (op.state !== "verified")
      return { ...base, status: op.state === "rejected" ? "rejected" : "unconfirmed" };
    let native;
    try {
      native = await request(`/athlete/0/workouts/${op.workoutId}`);
    } catch (error) {
      if (error.status === 404) return { ...base, status: "deleted" };
      throw error;
    }
    if (
      !object(native) ||
      String(native.id) !== op.workoutId ||
      typeof native.name !== "string" ||
      typeof native.type !== "string" ||
      typeof native.description !== "string"
    )
      fail("The current saved template could not be verified.");
    const unchanged = nativeMatches(native, op.body),
      exact = unchanged ? { ...native, description: op.description } : native;
    const [workout] = await readWorkoutLibrary(async () => [exact]);
    return { ...base, status: unchanged ? "saved" : "changed", workout };
  }
  return {
    listFolders: folderSnapshot,
    listTemplates,
    save,
    inspect,
    hydrateTemplate,
    wrapLibraryReads,
  };
}

export function workoutTemplateService(config, actor, request, fetchImpl = fetch) {
  const accountScope = workoutTemplateAccount(config, actor);
  return createWorkoutTemplateService({
    request,
    accountScope,
    readOnly: actor.readOnly,
    record: (key, initial) =>
      createEncryptedRecordStore(
        config,
        key,
        {
          namespace: "workout-templates",
          name: "WORKOUT_TEMPLATE",
          fresh: initial,
          timestampCas: true,
        },
        fetchImpl
      ),
  });
}
