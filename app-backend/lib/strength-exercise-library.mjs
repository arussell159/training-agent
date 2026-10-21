import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { contentFingerprint as hash } from "./content-fingerprint.mjs";
import {
  strengthLibraryId,
  validateStrengthExerciseDefinition,
  strengthMuscleGroups,
} from "./strength-exercise-library-model.mjs";
import { validateStrengthPrescription } from "./workout-strength-model.mjs";

const fail = (message, status = 400, code = "STRENGTH_LIBRARY_INVALID", extra = {}) => {
  throw Object.assign(Error(message), { status, code, ...extra });
};
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value, names) =>
  object(value) && Object.keys(value).every((key) => names.includes(key));
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const operation = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{16,80}$/.test(value);
const instant = (value) => {
  try {
    return typeof value === "string" && new Date(value).toISOString() === value;
  } catch {
    return false;
  }
};
const fresh = () => ({ version: 1, generation: 0, entries: {}, deleted: {}, receipts: [] });
export function strengthLibraryAccount(bootstrap, actor) {
  if (
    !object(actor) ||
    typeof actor.id !== "string" ||
    actor.id.length < 1 ||
    actor.id.length > 256 ||
    typeof actor.origin !== "string" ||
    typeof actor.readOnly !== "boolean"
  )
    fail("Sign in to the exercise library.", 401, "STRENGTH_LIBRARY_AUTH");
  let origin;
  try {
    origin = new URL(actor.origin);
  } catch {
    fail("The exercise account could not be verified.", 401, "STRENGTH_LIBRARY_AUTH");
  }
  if (
    origin.origin !== actor.origin ||
    (origin.protocol !== "https:" &&
      !(["localhost", "127.0.0.1"].includes(origin.hostname) && origin.protocol === "http:"))
  )
    fail("The exercise account could not be verified.", 401, "STRENGTH_LIBRARY_AUTH");
  return hash({
    origin: actor.origin,
    actor: actor.id,
    scope: bootstrap.SETTINGS_SCOPE || "default",
  });
}
export function createStrengthExerciseLibrary({
  record,
  accountScope,
  readOnly = false,
  now = () => new Date(),
}) {
  if (!digest(accountScope) || typeof readOnly !== "boolean")
    fail("The exercise account could not be verified.", 401, "STRENGTH_LIBRARY_AUTH");
  const store = record(fresh),
    catalogRevision = (state) => hash({ version: state.version, generation: state.generation });
  const revision = (id, entry) => hash({ accountScope, id, ...entry });
  const publicRow = (id, entry) => ({
    ...structuredClone(entry.definition),
    id,
    revision: revision(id, entry),
    accountScope,
    owner: "me",
    editable: !readOnly,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  });
  function validate(state) {
    try {
      if (
        !keys(state, ["version", "generation", "entries", "deleted", "receipts"]) ||
        state.version !== 1 ||
        !Number.isSafeInteger(state.generation) ||
        state.generation < 0 ||
        !object(state.entries) ||
        Object.keys(state.entries).length > 500 ||
        !object(state.deleted) ||
        Object.keys(state.deleted).length > 10000 ||
        !Array.isArray(state.receipts) ||
        state.receipts.length > 128 ||
        JSON.stringify(state).length > 2000000
      )
        throw Error();
      for (const [id, entry] of Object.entries(state.entries)) {
        strengthLibraryId(id);
        if (
          !keys(entry, ["definition", "serial", "createdAt", "updatedAt", "creationHash"]) ||
          !Number.isSafeInteger(entry.serial) ||
          entry.serial < 1 ||
          !instant(entry.createdAt) ||
          !instant(entry.updatedAt) ||
          !digest(entry.creationHash) ||
          state.deleted[id]
        )
          throw Error();
        if (hash(validateStrengthExerciseDefinition(entry.definition)) !== hash(entry.definition))
          throw Error();
      }
      for (const [id, value] of Object.entries(state.deleted)) {
        strengthLibraryId(id);
        if (
          !keys(value, ["operationId", "requestHash", "revision", "title", "deletedAt"]) ||
          !operation(value.operationId) ||
          !digest(value.requestHash) ||
          !digest(value.revision) ||
          typeof value.title !== "string" ||
          value.title.length > 128 ||
          !instant(value.deletedAt)
        )
          throw Error();
      }
      const ids = new Set();
      for (const receipt of state.receipts) {
        strengthLibraryId(receipt?.id);
        if (
          !keys(receipt, ["operationId", "requestHash", "action", "id", "revision"]) ||
          !operation(receipt.operationId) ||
          ids.has(receipt.operationId) ||
          !digest(receipt.requestHash) ||
          !["create", "update", "delete"].includes(receipt.action) ||
          !digest(receipt.revision)
        )
          throw Error();
        ids.add(receipt.operationId);
      }
    } catch {
      fail(
        "The saved exercise catalog could not be verified. Keep its recovery identity.",
        502,
        "STRENGTH_LIBRARY_STORAGE_INVALID"
      );
    }
    return state;
  }
  const read = async () => {
    try {
      return validate(await store.read());
    } catch (error) {
      if (error.code === "STRENGTH_LIBRARY_STORAGE_INVALID") throw error;
      fail(
        "The exercise library could not be loaded. Keep any retained save operation.",
        502,
        "STRENGTH_LIBRARY_UNAVAILABLE"
      );
    }
  };
  function currentReceipt(state, receipt, requestHash) {
    if (receipt.requestHash !== requestHash)
      fail(
        "This operation identity belongs to a different exercise change.",
        409,
        "STRENGTH_LIBRARY_OPERATION_REUSED"
      );
    const current =
      receipt.action === "delete" ? state.deleted[receipt.id] : state.entries[receipt.id];
    if (
      !current ||
      (receipt.action === "delete" ? current.revision : revision(receipt.id, current)) !==
        receipt.revision
    )
      fail(
        "This exercise changed after the saved operation. Reload the current library.",
        409,
        "STRENGTH_LIBRARY_REPLAY_CHANGED",
        { exerciseId: receipt.id, accountScope, operationId: receipt.operationId }
      );
    return receipt;
  }
  async function mutate(action, id, input) {
    const allowed =
      action === "create"
        ? ["operationId", "accountScope", "catalogRevision", "definition", "reconcileOnly"]
        : action === "update"
          ? ["operationId", "accountScope", "revision", "definition", "reconcileOnly"]
          : ["operationId", "accountScope", "revision", "reconcileOnly"];
    if (
      !keys(input, allowed) ||
      !operation(input.operationId) ||
      (input.reconcileOnly !== undefined && typeof input.reconcileOnly !== "boolean")
    )
      fail("Retain a valid exercise change identity.");
    if (input.accountScope !== accountScope)
      fail(
        "This saved exercise change belongs to another signed-in account.",
        409,
        "STRENGTH_LIBRARY_ACCOUNT_CHANGED"
      );
    if (readOnly) fail("This exercise library is read-only.", 403, "STRENGTH_LIBRARY_READ_ONLY");
    if (!digest(action === "create" ? input.catalogRevision : input.revision))
      fail("Reload the exercise revision before saving.");
    id =
      action === "create"
        ? strengthLibraryId(`exercise:${hash({ accountScope, operationId: input.operationId })}`)
        : strengthLibraryId(id);
    const definition =
      action === "delete" ? undefined : validateStrengthExerciseDefinition(input.definition);
    const normalized = {
        action,
        id,
        accountScope,
        operationId: input.operationId,
        ...(action === "create"
          ? { catalogRevision: input.catalogRevision }
          : { revision: input.revision }),
        ...(definition ? { definition } : {}),
      },
      requestHash = hash(normalized),
      at = now().toISOString();
    let acknowledged;
    try {
      acknowledged = await store.update((state) => {
        validate(state);
        const previous = state.receipts.find((item) => item.operationId === input.operationId);
        if (previous) return currentReceipt(state, previous, requestHash);
        const current = state.entries[id],
          deleted = state.deleted[id];
        if (action === "create" && current) {
          if (current.creationHash !== requestHash || current.serial !== 1)
            fail(
              "The originally created exercise has changed. Reload it instead of recreating it.",
              409,
              "STRENGTH_LIBRARY_REPLAY_CHANGED",
              { exerciseId: id, accountScope, operationId: input.operationId }
            );
          return {
            operationId: input.operationId,
            requestHash,
            action,
            id,
            revision: revision(id, current),
          };
        }
        if (
          action === "delete" &&
          deleted &&
          deleted.operationId === input.operationId &&
          deleted.requestHash === requestHash
        )
          return {
            operationId: input.operationId,
            requestHash,
            action,
            id,
            revision: deleted.revision,
          };
        if (action === "create" && deleted)
          fail(
            "The originally created exercise was deleted. It will not be recreated by retry.",
            409,
            "STRENGTH_LIBRARY_REPLAY_CHANGED",
            { exerciseId: id, accountScope, operationId: input.operationId }
          );
        if (input.reconcileOnly)
          fail(
            "This change has no confirmed saved receipt. Reload or recheck its original identity.",
            502,
            "STRENGTH_LIBRARY_UNCONFIRMED"
          );
        if (action === "create") {
          if (catalogRevision(state) !== input.catalogRevision)
            fail(
              "The exercise catalog changed. Reload it before creating another exercise.",
              409,
              "STRENGTH_LIBRARY_CONFLICT"
            );
          if (Object.keys(state.entries).length >= 500)
            fail(
              "The custom exercise library has reached its supported 500-item limit.",
              409,
              "STRENGTH_LIBRARY_LIMIT"
            );
          state.entries[id] = {
            definition,
            serial: 1,
            createdAt: at,
            updatedAt: at,
            creationHash: requestHash,
          };
        } else {
          if (!current)
            fail(
              "This custom exercise is no longer in the library.",
              404,
              "STRENGTH_LIBRARY_NOT_FOUND"
            );
          if (revision(id, current) !== input.revision)
            fail(
              "This custom exercise changed. Reload before saving.",
              409,
              "STRENGTH_LIBRARY_CONFLICT"
            );
          if (action === "update")
            state.entries[id] = {
              ...current,
              definition,
              serial: current.serial + 1,
              updatedAt: at,
            };
          else {
            if (Object.keys(state.deleted).length >= 10000)
              fail(
                "The custom exercise deletion-recovery limit has been reached.",
                409,
                "STRENGTH_LIBRARY_LIMIT"
              );
            state.deleted[id] = {
              operationId: input.operationId,
              requestHash,
              revision: hash({ id, requestHash, at }),
              title: current.definition.title,
              deletedAt: at,
            };
            delete state.entries[id];
          }
        }
        state.generation++;
        const receipt = {
          operationId: input.operationId,
          requestHash,
          action,
          id,
          revision:
            action === "delete" ? state.deleted[id].revision : revision(id, state.entries[id]),
        };
        state.receipts = [...state.receipts, receipt].slice(-128);
        validate(state);
        return receipt;
      });
    } catch (error) {
      if (error.status) throw error;
      fail(
        "The exercise change needs confirmation. Recheck the retained operation.",
        502,
        "STRENGTH_LIBRARY_UNCONFIRMED"
      );
    }
    const state = await read();
    currentReceipt(state, acknowledged, requestHash);
    return {
      id,
      operationId: input.operationId,
      accountScope,
      catalogRevision: catalogRevision(state),
      verified: true,
      ...(action === "delete" ? { deleted: true } : { exercise: publicRow(id, state.entries[id]) }),
    };
  }
  async function load(id) {
    strengthLibraryId(id);
    const state = await read();
    if (!state.entries[id])
      fail("This custom exercise is no longer in the library.", 404, "STRENGTH_LIBRARY_NOT_FOUND");
    return publicRow(id, state.entries[id]);
  }
  async function list({ query = "", muscleGroup = "all", owner = "all" } = {}) {
    if (
      typeof query !== "string" ||
      query.length > 128 ||
      !["me", "all"].includes(owner) ||
      (muscleGroup !== "all" && !strengthMuscleGroups.includes(muscleGroup))
    )
      fail("Choose a supported library search, owner and muscle filter.");
    const state = await read(),
      search = query.trim().toLocaleLowerCase(),
      all = Object.entries(state.entries);
    return {
      exercises: all
        .filter(
          ([, entry]) =>
            (!search || entry.definition.title.toLocaleLowerCase().includes(search)) &&
            (muscleGroup === "all" || entry.definition.muscleGroup === muscleGroup)
        )
        .map(([id, entry]) => publicRow(id, entry))
        .sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)),
      revision: catalogRevision(state),
      accountScope,
      total: all.length,
      readOnly,
    };
  }
  async function history(id, context) {
    strengthLibraryId(id);
    const state = await read(),
      owned = state.entries[id]?.definition || state.deleted[id];
    if (!owned)
      fail("This custom exercise is not owned by this account.", 404, "STRENGTH_LIBRARY_NOT_FOUND");
    const records = [],
      legacyMatches = [],
      rows = [
        ...new Map(
          [...(context?.planned || []), ...(context?.history || [])]
            .filter((row) => typeof row?.id === "string" && !row.app_pending_operation)
            .map((row) => [row.id, row])
        ).values(),
      ];
    for (const row of rows) {
      const prescription = row.editor_model?.strength;
      if (!prescription || validateStrengthPrescription(prescription).length) continue;
      const exact = [],
        legacy = [];
      for (const block of prescription.blocks)
        for (const exercise of block.exercises) {
          if (exercise.libraryExerciseId === id) exact.push(structuredClone(exercise));
          else if (
            !exercise.libraryExerciseId &&
            exercise.title.trim().toLocaleLowerCase() === owned.title.trim().toLocaleLowerCase()
          )
            legacy.push(structuredClone(exercise));
        }
      const base = {
        workoutId: row.id,
        date: row.workout_date,
        title: row.title,
        workoutCompleted: Boolean(
          row.activity_id || row.status === "completed" || row.completed === true
        ),
        actualResultsAvailable: false,
      };
      if (exact.length) records.push({ ...base, exercises: exact });
      if (legacy.length) legacyMatches.push({ ...base, legacyTitleMatch: true, exercises: legacy });
    }
    return {
      id,
      accountScope,
      records,
      legacyMatches,
      coverage: "retained-calendar-context",
      actualResultsAvailable: false,
    };
  }
  return {
    list,
    load,
    history,
    create: (input) => mutate("create", null, input),
    update: (id, input) => mutate("update", id, input),
    delete: (id, input) => mutate("delete", id, input),
  };
}
export function strengthExerciseLibrary(bootstrap, actor, fetchImpl = fetch) {
  const accountScope = strengthLibraryAccount(bootstrap, actor);
  return createStrengthExerciseLibrary({
    accountScope,
    readOnly: actor.readOnly,
    record: (initial) =>
      createEncryptedRecordStore(
        bootstrap,
        accountScope,
        {
          namespace: "strength-exercise-library",
          name: "STRENGTH_EXERCISES",
          fresh: initial,
          timestampCas: true,
        },
        fetchImpl
      ),
  });
}
