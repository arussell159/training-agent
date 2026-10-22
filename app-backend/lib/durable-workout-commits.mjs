import { createHash, randomUUID } from "node:crypto";
import { createEncryptedRecordStore } from "./app-auth-store.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
import { createIntervalsClient, mapIntervalsWorkout, validDate } from "./intervals.mjs";
import { athleteLocalDate } from "./athlete-date.mjs";
import {
  assertEditable,
  expectedPatch,
  loadWorkoutEditor,
  createWorkoutEditor,
  saveWorkoutEditor,
  workoutRevision,
  editorDescriptionOverride,
} from "./workout-editor.mjs";
import { validateWorkout, workoutTotals, importWorkout } from "./workout-editor-model.mjs";
import { withDirectWorkoutWrite } from "./direct-workout-write.mjs";
import { createWorkoutPersonalService, validateWorkoutPersonal } from "./workout-personal.mjs";
import { saveWorkoutRecurrence } from "./workout-recurrence.mjs";
import { readPlannedValues, validatePlannedValues } from "./planned-workout-values.mjs";
import {
  hasManualWorkoutDescription,
  readManualWorkoutDescription,
} from "./workout-manual-description.mjs";
import {
  assertActivityEditable,
  completedActivityPatch,
  completedActivityPath,
  completePlannedWorkout,
  loadCompletedWorkoutEditor,
  saveCompletedWorkout,
  validateCompletedValues,
  completedWorkoutModel,
  completedValues,
} from "./completed-workout-edits.mjs";
import { saveNativeActivityComment } from "./native-workout-comments.mjs";
import { saveProviderWorkoutComment } from "./provider-workout-comments.mjs";
import { readWorkoutCommentText, stripWorkoutCommentText } from "./workout-comment-text.mjs";

const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
const idPattern = /^(event:[1-9]\d*|activity:i?[1-9]\d*|app:[a-f\d-]{36})$/i;
const fresh = () => ({ version: 1, workouts: {}, operations: {} });
const fail = (message, status = 400, code = "INVALID_COMMIT") => {
  throw Object.assign(Error(message), { status, code });
};
// Only pure input validators/builders are wrapped. In particular, encrypted
// record reads/CAS writes must keep their storage failure classification.
function validatedInput(validate) {
  try {
    return validate();
  } catch (error) {
    if (!error.status) {
      error.status = 400;
      error.code = "INVALID_WORKOUT";
    }
    throw error;
  }
}
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
// Longer than the deployed five-minute invocation. Expired workers must read
// back before retrying. A database CAS, not a JavaScript mutex, owns each claim.
const leaseMs = 6 * 60_000;

export function createDurableWorkoutCommits(config, options = {}) {
  const clock = options.clock || Date.now;
  const random = options.random || Math.random;
  const record =
    options.record ||
    createEncryptedRecordStore(config, providerConnection(config), {
      namespace: "workout-commits",
      name: "WORKOUT_COMMITS",
      fresh,
      timestampCas: true,
      readCacheMs: 1000,
    });
  const request = options.request || createIntervalsClient(config);
  const write =
    options.write ||
    ((id, action) => withDirectWorkoutWrite(config, id, action, { recoverPending: true }));
  function receipt(row, operationId) {
    const event = row.event;
    const workout =
      event && !row.deleted
        ? {
            ...mapIntervalsWorkout(
              event,
              athleteLocalDate(new Date(clock()), config.TIME_ZONE || "America/Chicago"),
              row.completedActivity || event._paired_activity,
              row.id.startsWith("activity:")
            ),
            id: row.id,
            sync_status: row.syncStatus,
            app_revision: row.revision,
            provider_workout_id: row.providerId || null,
            app_updated_at: row.acceptedAt,
            ...(row.input?.model ? { editor_model: structuredClone(row.input.model) } : {}),
          }
        : null;
    return {
      accepted: true,
      durableBoundary: "backend",
      verified: row.syncStatus === "synced" && row.syncedRevision === row.revision,
      workoutId: row.id,
      providerWorkoutId: row.providerId || null,
      operationId,
      revision: `app:${row.revision}`,
      syncedRevision: row.syncedRevision || 0,
      syncedAt: row.syncedAt || null,
      syncStatus: row.syncStatus,
      syncError: row.error || null,
      deleted: row.deleted,
      model: row.input?.model,
      event,
      completedActivity: row.completedActivity || null,
      workout,
      acceptedAt: row.acceptedAt,
      personal: row.input?.personal,
      recurrence: row.input?.recurrence,
      externalConflict: row.externalConflict || null,
    };
  }
  async function accept(input) {
    if (!input || !uuid.test(input.operationId || "")) fail("A stable operation ID is required.");
    const action = input.action;
    if (
      !["create", "edit", "move", "delete", "edit-activity", "complete", "comment"].includes(action)
    )
      fail("Choose a supported committed action.");
    const id =
      input.workoutId ||
      (action === "create" ? `app:${input.input?.creationId || input.operationId}` : "");
    if (!idPattern.test(id) || (id.startsWith("app:") && !uuid.test(id.slice(4))))
      fail("Invalid workout identity.");
    if (action === "create" && !id.startsWith("app:"))
      fail("A new workout requires a stable app identity.");
    if (id.startsWith("activity:") && !["edit-activity", "comment"].includes(action))
      fail("Completed activities support metadata edits and comments.");
    if (action === "edit-activity" && !id.startsWith("activity:"))
      fail("Choose a completed activity to edit.");
    const payload = structuredClone(input.input || {});
    // The desktop empty start-time field means an all-day workout. ICU stores
    // that as local midnight; retain the empty UI choice in the app input.
    validatedInput(() => {
      if (typeof payload.time === "string") payload.emptyStartTime = payload.time === "";
      if (payload.time === "") payload.time = "00:00";
      if (
        payload.time != null &&
        (typeof payload.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(payload.time))
      )
        fail("Enter a valid start time.");
      if (
        payload.comment != null &&
        (typeof payload.comment !== "string" || payload.comment.length > 2000)
      )
        fail("Enter a comment under 2,000 characters.");
      if (payload.commentId != null && !uuid.test(payload.commentId))
        fail("Enter a valid comment identifier.");
      if (payload.comment?.trim() && !payload.commentId) payload.commentId = input.operationId;
      if (
        payload.description != null &&
        (typeof payload.description !== "string" || payload.description.length > 30000)
      )
        fail("Enter a description under 30,000 characters.");
      if (payload.descriptionMode != null && payload.descriptionMode !== "manual")
        fail("Choose a valid description mode.");
      if (payload.values !== undefined) validatePlannedValues(payload.values);
      if (payload.completedValues !== undefined) validateCompletedValues(payload.completedValues);
      if (action === "complete" && !(payload.completedValues?.duration_seconds > 0))
        fail("Enter a completed duration before completing the workout.");
      if (action === "comment" && !payload.comment?.trim()) fail("Enter a comment before saving.");
      if (payload.personal != null) payload.personal = validateWorkoutPersonal(payload.personal);
      if (["create", "edit"].includes(action) || (payload.model && !id.startsWith("activity:"))) {
        const errors = validateWorkout(payload.model);
        if (errors.length) fail(errors.join(". "));
      }
      if (action === "move") validDate(input.date || payload.date);
    });
    const hash = digest({ ...input, workoutId: id });
    const commentBase =
      action === "comment" && !input.baseEvent && !payload.model
        ? await request(
            id.startsWith("activity:")
              ? completedActivityPath(id)
              : `/athlete/0/events/${id.slice(6)}`
          )
        : null;
    return record.update((state) => {
      state.workouts ||= {};
      state.operations ||= {};
      const previousOperation = state.operations[input.operationId];
      if (previousOperation) {
        if (previousOperation.hash !== hash)
          fail("Operation ID cannot be reused for a different change.", 409);
        return {
          ...receipt(state.workouts[id], input.operationId),
          operationRevision: previousOperation.revision,
        };
      }
      const old = state.workouts[id];
      if (
        !old &&
        action !== "create" &&
        !input.baseEvent &&
        action !== "edit" &&
        !["edit-activity", "comment", "complete"].includes(action) &&
        !(action === "delete" && payload.model)
      )
        fail("Reopen the workout before saving.", 409, "BASE_EVENT_REQUIRED");
      if (old && action === "create")
        fail("This workout already exists. Save an edit instead.", 409);
      const expected =
        input.revision ||
        payload.revision ||
        (action === "comment"
          ? old
            ? `app:${old.revision}`
            : commentBase
              ? workoutRevision(commentBase)
              : null
          : null);
      const base =
        old?.event ||
        input.baseEvent ||
        commentBase ||
        (["edit", "delete", "edit-activity", "comment", "complete"].includes(action) &&
        payload.model
          ? {
              id: id.startsWith("activity:") ? id.slice(9) : id.slice(6),
              ...(id.startsWith("activity:") ? {} : { category: "WORKOUT" }),
              type: payload.model.sport,
              name: payload.model.name,
              description: "",
              start_date_local: `${payload.model.date}T${payload.time || "00:00"}:00`,
            }
          : null);
      if (old && expected !== `app:${old.revision}`)
        fail(
          "This workout changed in another tab. Reopen it to review both versions; your draft is retained.",
          409,
          "CONFLICT"
        );
      if (!old && action !== "create") {
        if (id.startsWith("activity:")) assertActivityEditable(base);
        else assertEditable(base);
        if (
          typeof expected !== "string" ||
          !/^[a-f\d]{64}$/i.test(expected) ||
          (input.baseEvent && expected !== workoutRevision(base))
        )
          fail("Reopen the workout before saving.", 409, "CONFLICT");
      }
      if (old?.deleted)
        fail("This workout was deleted. Create a separate workout to restore it.", 409, "DELETED");
      let modelInput = ["create", "edit", "edit-activity", "comment", "complete"].includes(action)
        ? {
            ...(old?.input || {}),
            // Comment text and completed-value patches belong to one Save.
            // Carrying them into a later metadata edit would repost a native
            // message or overwrite actual values the user did not edit.
            comment: undefined,
            commentId: undefined,
            completedValues: undefined,
            ...payload,
            ...(old?.input?.values && payload.values
              ? { values: { ...old.input.values, ...payload.values } }
              : {}),
          }
        : structuredClone(
            old?.input ||
              (payload.model ? payload : base ? { model: importWorkout(base).model } : {})
          );
      let event = base;
      if (["create", "edit"].includes(action)) {
        const seed = base || {
          id: id.slice(4),
          category: "WORKOUT",
          start_date_local: `${payload.model.date}T00:00:00`,
          description: "",
        };
        const patchSeed = /^[1-9]\d*$/.test(String(seed.id)) ? seed : { ...seed, id: 1 };
        event = {
          ...seed,
          ...validatedInput(() =>
            expectedPatch(
              patchSeed,
              payload.model,
              payload.completedValues ? { ...payload, comment: undefined } : payload
            )
          ),
        };
        const totals = workoutTotals(payload.model);
        event.moving_time = totals.seconds;
        event.distance = totals.distance;
        // The structured document from the previous provider revision is stale;
        // mapIntervalsWorkout reads the complete embedded app model instead.
        delete event.workout_doc;
        if (action === "create") event.external_id = `training-agent:editor:${id.slice(4)}`;
      } else if (action === "edit-activity") {
        event = {
          ...base,
          ...validatedInput(() => completedActivityPatch(base, payload)),
        };
      } else if (action === "move") {
        const date = input.date || payload.date;
        const priorDate = event.start_date_local.slice(0, 10);
        event = { ...event, start_date_local: date + event.start_date_local.slice(10) };
        if (event.end_date_local)
          event.end_date_local = new Date(
            Date.parse(`${event.end_date_local}Z`) +
              Date.parse(`${date}T00:00:00Z`) -
              Date.parse(`${priorDate}T00:00:00Z`)
          )
            .toISOString()
            .slice(0, 19);
        if (modelInput.model) modelInput.model.date = date;
      }
      const revision = (old?.revision || 0) + 1;
      const acceptedAt = new Date(clock()).toISOString();
      const job = {
        operationId: input.operationId,
        action,
        revision,
        input: modelInput,
        event,
        state: "pending",
        attempts: 0,
        nextAttemptAt: 0,
        createdAt: clock(),
      };
      const row = {
        ...old,
        id,
        revision,
        acceptedAt,
        event,
        input: modelInput,
        providerId: old?.providerId || (/^(event|activity):/.test(id) ? id : null),
        providerRevision: old?.providerRevision || (action !== "create" ? expected : null),
        syncedRevision: old?.syncedRevision || 0,
        syncStatus: "pending",
        error: null,
        personalHost:
          old?.personalHost ||
          options.personalHost ||
          new URL(
            config.APP_ORIGIN ||
              process.env.APP_ORIGIN ||
              `http://localhost:${process.env.PORT || 4173}`
          ).host,
        deleted: action === "delete",
        jobs: [...(old?.jobs || []), job],
      };
      // Pending revisions of the same kind can be superseded, but never remove
      // the create that establishes the external identity or an in-flight job.
      for (const older of row.jobs.slice(0, -1))
        if (
          ["pending", "failed"].includes(older.state) &&
          older.action !== "create" &&
          action !== "create" &&
          !["comment", "complete"].includes(older.action) &&
          !["comment", "complete"].includes(action) &&
          !older.commentIntent &&
          !older.uncertain &&
          !older.input.comment?.trim() &&
          !older.input.completedValues
        )
          older.state = "superseded";
      const failedCreate = row.jobs.find(
        (item) => item.action === "create" && item.state === "failed"
      );
      if (failedCreate) {
        row.syncStatus = "failed";
        row.error =
          old?.error ||
          failedCreate.lastError ||
          "The original workout could not synchronize. Retry after resolving the connection problem; your newer edits are retained.";
      }
      state.workouts[id] = row;
      state.operations[input.operationId] = { id, hash, revision };
      if (Buffer.byteLength(JSON.stringify(state)) > 2 * 1024 * 1024)
        fail(
          "Saved workout storage needs maintenance before accepting more edits.",
          507,
          "STORAGE_FULL"
        );
      return { ...receipt(row, input.operationId), operationRevision: revision };
    });
  }
  async function status() {
    const state = await record.read();
    return {
      workouts: Object.values(state.workouts).map((row) =>
        receipt(row, row.jobs.at(-1)?.operationId)
      ),
      worker: {
        ownership: "backend",
        resumption:
          "bounded server timer, authenticated visit/retry request, or incoming webhook; no scheduled polling",
      },
    };
  }
  async function project(context, loadedState) {
    if (!context) return context;
    const state = loadedState || (await record.read());
    const all = new Map(
      [...(context.history || []), ...(context.planned || [])].map((workout) => [
        workout.id,
        workout,
      ])
    );
    for (const row of Object.values(state.workouts)) {
      const activityId = row.id.startsWith("activity:") ? row.id.slice(9) : null;
      const paired = activityId
        ? [...all.values()].find(
            (workout) => workout.id !== row.id && String(workout.activity_id || "") === activityId
          )
        : null;
      if (paired && !row.deleted) {
        const snapshotStartedAt = Date.parse(context.sync_started_at || context.synced_at || "");
        if (
          row.syncedRevision !== row.revision ||
          row.externalConflict ||
          !Number.isFinite(snapshotStartedAt) ||
          snapshotStartedAt < (row.syncedAt || 0)
        ) {
          const actual = receipt(row).workout;
          all.set(paired.id, {
            ...paired,
            status: "completed",
            completed: true,
            title: actual.title,
            workout_date: actual.workout_date,
            recorded_start_local: row.event.start_date_local,
            editable_description: actual.editable_description,
            actualDurationMinutes: actual.actualDurationMinutes,
            completed_data: actual.completed_data,
            workout_summary: {
              planned: paired.workout_summary?.planned || null,
              completed: actual.workout_summary.completed,
            },
            sync_status: row.syncStatus,
            app_revision: row.revision,
            completed_commit_id: row.id,
          });
        }
        all.delete(row.id);
        continue;
      }
      // A committed deletion is a tombstone, including while the provider
      // snapshot still contains the old event. Deleted receipts have no workout.
      if (row.deleted) {
        all.delete(row.id);
        if (row.providerId) all.delete(row.providerId);
        continue;
      }
      // The ledger retains the full accepted app model even after sync. External
      // conflicts are surfaced by explicit refresh/reconciliation, never merged
      // over a pending app revision.
      if (row.syncedRevision === row.revision && !row.externalConflict) {
        // A synchronized row is not an authoritative override of later provider
        // changes or deletions. Preserve stable app IDs only when a provider row
        // still exists; reconciliation separately records conflicts with both versions.
        const remote = all.get(row.providerId || row.id);
        const snapshotStartedAt = Date.parse(context.sync_started_at || context.synced_at || "");
        if (!Number.isFinite(snapshotStartedAt) || snapshotStartedAt < (row.syncedAt || 0)) {
          if (row.providerId && row.providerId !== row.id) all.delete(row.providerId);
          all.set(row.id, receipt(row).workout);
          continue;
        }
        if (remote && row.providerId !== row.id) {
          all.delete(row.providerId);
          all.set(row.id, {
            ...remote,
            id: row.id,
            provider_workout_id: row.providerId,
            sync_status: row.syncStatus,
            app_revision: row.revision,
          });
        }
        continue;
      }
      if (row.providerId && row.providerId !== row.id) all.delete(row.providerId);
      if (row.deleted) all.delete(row.id);
      else all.set(row.id, receipt(row).workout);
    }
    const today = athleteLocalDate(new Date(clock()), config.TIME_ZONE || "America/Chicago");
    const bounds = context.display_range;
    const workouts = [...all.values()].filter(
      (workout) =>
        !bounds || (workout.workout_date >= bounds.start && workout.workout_date <= bounds.end)
    );
    return {
      ...context,
      history: workouts.filter((workout) => workout.workout_date <= today),
      planned: workouts.filter((workout) => workout.workout_date >= today),
    };
  }
  async function editor(id) {
    const row = (await record.read()).workouts[id];
    if (!row || row.deleted) fail("Workout not found.", 404);
    let zones = row.input.zoneSettings;
    if (!Array.isArray(zones) && options.loadZoneSettings) zones = await options.loadZoneSettings();
    const load = id.startsWith("activity:") ? loadCompletedWorkoutEditor : loadWorkoutEditor;
    const value = await load(async (path) => {
      if (path !== "/athlete/0") return row.event;
      if (!Array.isArray(zones))
        throw Error("Training zones are not cached. Refresh the connected account to load them.");
      return { sportSettings: zones };
    }, row.providerId || "event:1");
    return {
      ...value,
      model: row.input.model || value.model,
      scheduledTime: row.input.emptyStartTime ? "" : value.scheduledTime,
      revision: `app:${row.revision}`,
      id,
      syncStatus: row.syncStatus,
      providerWorkoutId: row.providerId,
      event: row.event,
      completedActivity: row.completedActivity,
      comments: row.comments || value.comments,
      personal: row.input.personal,
      recurrence: row.input.recurrence,
      externalConflict: row.externalConflict || null,
    };
  }
  async function retry(id) {
    return record.update((state) => {
      const row = state.workouts[id];
      if (!row) fail("Workout not found.", 404);
      if (row.externalConflict)
        fail(
          "This workout has a conflicting external version. Review both versions before choosing which one to save.",
          409,
          "CONFLICT"
        );
      for (const job of row.jobs)
        if (job.state === "failed") {
          job.state = "pending";
          job.nextAttemptAt = 0;
        }
      row.syncStatus = "pending";
      row.error = null;
      return receipt(row);
    });
  }
  const externalRevision = (event) =>
    event?.deleted === true ? digest({ deleted: true }) : workoutRevision(event);
  const resolutionReceipt = (row, operationId, operationRevision = row.revision) => ({
    ...receipt(row, operationId),
    operationRevision,
    input: { ...structuredClone(row.input), revision: `app:${row.revision}` },
  });
  async function readExternal(row) {
    if (!row.providerId)
      fail(
        "This workout has no confirmed Intervals.icu identity to compare.",
        409,
        "CONFLICT_IDENTITY_REQUIRED"
      );
    try {
      return await request(
        row.providerId.startsWith("activity:")
          ? completedActivityPath(row.providerId)
          : `/athlete/0/events/${row.providerId.slice(6)}`
      );
    } catch (error) {
      if (error.status === 404) return { deleted: true };
      throw error;
    }
  }
  function ensureIdle(row) {
    if (row.jobs.some((job) => job.state === "running"))
      fail(
        "Synchronization is still checking this workout. Wait for that check before resolving changes.",
        409,
        "WORKOUT_WRITE_BUSY"
      );
  }
  function comparison(row, external) {
    const activity = row.providerId?.startsWith("activity:");
    const imported = external.deleted
      ? null
      : activity
        ? { model: completedWorkoutModel(external), issues: [], warnings: [] }
        : importWorkout(external);
    if (imported && !activity)
      for (const key of Object.keys(external.workout_doc?.options || {}))
        if (
          key !== "pool_length" &&
          !imported.issues.includes(`Unsupported provider workout option: ${key}`)
        )
          imported.issues.push(`Unsupported provider workout option: ${key}`);
    let editable = true;
    if (!external.deleted) {
      try {
        if (activity) assertActivityEditable(external);
        else assertEditable(external);
      } catch {
        editable = false;
      }
    }
    const provider = external.deleted
      ? { deleted: true, event: external, issues: [], warnings: [] }
      : {
          deleted: false,
          model: imported.model,
          event: external,
          issues: imported.issues,
          warnings: imported.warnings,
          plannedValues: readPlannedValues(external.description),
          ...(activity ? { completedValues: completedValues(external) } : {}),
          description:
            (activity
              ? stripWorkoutCommentText(external.description)
              : editorDescriptionOverride(external, imported.model)) ??
            readManualWorkoutDescription(external),
        };
    return {
      workoutId: row.id,
      revision: `app:${row.revision}`,
      candidateRevision: externalRevision(external),
      local: {
        deleted: row.deleted,
        model: row.input.model,
        event: row.event,
        plannedValues: row.input.values || readPlannedValues(row.event?.description),
        ...(activity ? { completedValues: row.input.completedValues } : {}),
        description: row.input.description,
        personal: row.input.personal,
        recurrence: row.input.recurrence,
      },
      provider,
      canKeepLocal: external.deleted ? row.deleted === true : editable,
      canAcceptProvider: external.deleted || imported.issues.length === 0,
    };
  }
  async function reviewConflict(id) {
    const before = (await record.read()).workouts[id];
    if (!before) fail("Workout not found.", 404);
    ensureIdle(before);
    const external = await readExternal(before);
    if (!before.externalConflict && externalRevision(external) === before.providerRevision)
      fail("There is no conflicting external version to resolve.", 409, "NO_CONFLICT");
    return record.update((state) => {
      const row = state.workouts[id];
      if (row.revision !== before.revision)
        fail(
          "This workout changed while its versions were loading. Reopen the comparison; your newer edits are retained.",
          409,
          "CONFLICT"
        );
      ensureIdle(row);
      row.externalConflict = structuredClone(external);
      row.conflictCandidateRevision = externalRevision(external);
      row.conflictCandidateAppRevision = row.revision;
      row.syncStatus = "failed";
      row.error =
        "This workout changed outside the app. Review both retained versions before choosing which one to save.";
      if (Buffer.byteLength(JSON.stringify(state)) > 2 * 1024 * 1024)
        fail(
          "Saved workout storage is full. The existing version remains retained; free capacity before storing another conflict candidate.",
          507,
          "STORAGE_FULL"
        );
      return comparison(row, external);
    });
  }
  async function resolveConflict(id, input) {
    if (
      !uuid.test(input?.operationId || "") ||
      !["local", "provider"].includes(input.choice) ||
      !/^app:[1-9]\d*$/.test(input.expectedRevision || "") ||
      !/^[a-f\d]{64}$/i.test(input.candidateRevision || "")
    )
      fail("Choose a reviewed workout version and a stable resolution identity.");
    const hash = digest({ action: "resolve-conflict", id, ...input });
    const beforeState = await record.read(),
      beforeOperation = beforeState.operations[input.operationId];
    if (beforeOperation) {
      if (beforeOperation.hash !== hash || beforeOperation.id !== id)
        fail("Operation ID cannot be reused for a different resolution.", 409, "CONFLICT");
      return resolutionReceipt(
        beforeState.workouts[id],
        input.operationId,
        beforeOperation.revision
      );
    }
    const before = beforeState.workouts[id];
    if (!before) fail("Workout not found.", 404);
    if (
      `app:${before.revision}` !== input.expectedRevision ||
      before.conflictCandidateRevision !== input.candidateRevision ||
      before.conflictCandidateAppRevision !== before.revision
    )
      fail(
        "The comparison is out of date. Reopen both versions before choosing; your newer edits are retained.",
        409,
        "CONFLICT"
      );
    ensureIdle(before);
    // The user chose a particular candidate. Re-read that exact external version
    // now; a newer edit is a new conflict, never permission to overwrite it.
    const external = await readExternal(before);
    if (externalRevision(external) !== input.candidateRevision)
      fail(
        "The Intervals.icu version changed again. Refresh the comparison before choosing a version.",
        409,
        "CONFLICT"
      );
    const compared = comparison(before, external);
    if (input.choice === "local" && !compared.canKeepLocal)
      fail(
        external.deleted
          ? "The external workout was deleted. Create a separate copy of your retained workout to keep it; this resolution will not resurrect the old event."
          : "This external calendar is read-only. Keep the retained app copy separately instead of overwriting it.",
        409,
        "CONFLICT_READ_ONLY"
      );
    if (input.choice === "provider" && !compared.canAcceptProvider)
      fail(
        "The external prescription contains unsupported fields. Both complete versions are retained; resolve it in the source calendar before adopting it here.",
        422,
        "UNSUPPORTED_PROVIDER_WORKOUT"
      );
    return record.update((state) => {
      const existing = state.operations[input.operationId];
      if (existing) {
        if (existing.hash !== hash || existing.id !== id)
          fail("Operation ID cannot be reused for a different resolution.", 409, "CONFLICT");
        return resolutionReceipt(state.workouts[id], input.operationId, existing.revision);
      }
      const row = state.workouts[id];
      if (
        `app:${row.revision}` !== input.expectedRevision ||
        row.conflictCandidateRevision !== input.candidateRevision ||
        row.conflictCandidateAppRevision !== row.revision ||
        externalRevision(row.externalConflict) !== input.candidateRevision
      )
        fail(
          "This workout changed while you chose a version. Reopen the comparison; newer edits are retained.",
          409,
          "CONFLICT"
        );
      ensureIdle(row);
      row.resolutionHistory ||= [];
      // Preserve both complete copies, including pending private fields and jobs.
      // Capacity exhaustion rejects the resolution instead of discarding history.
      row.resolutionHistory.push({
        operationId: input.operationId,
        choice: input.choice,
        revision: row.revision,
        acceptedAt: clock(),
        local: {
          input: structuredClone(row.input),
          event: structuredClone(row.event),
          deleted: row.deleted,
          jobs: structuredClone(row.jobs),
        },
        provider: structuredClone(external),
        candidateRevision: input.candidateRevision,
      });
      for (const job of row.jobs)
        if (!["synced", "superseded"].includes(job.state)) job.state = "superseded";
      row.revision++;
      row.acceptedAt = new Date(clock()).toISOString();
      row.providerRevision = input.candidateRevision;
      row.externalConflict = null;
      row.conflictCandidateRevision = null;
      row.conflictCandidateAppRevision = null;
      row.error = null;
      if (input.choice === "provider" || external.deleted) {
        row.deleted = external.deleted === true;
        if (!external.deleted) {
          const manual = hasManualWorkoutDescription(external.description);
          const activity = id.startsWith("activity:");
          row.input = {
            ...row.input,
            model: compared.provider.model,
            values: compared.provider.plannedValues,
            ...(activity ? { completedValues: compared.provider.completedValues } : {}),
            time: String(external.start_date_local).slice(11, 16),
            emptyStartTime: String(external.start_date_local).slice(11) === "00:00:00",
            description: activity
              ? compared.provider.description
              : manual
                ? readManualWorkoutDescription(external)
                : editorDescriptionOverride(external, compared.provider.model),
            descriptionMode: manual ? "manual" : undefined,
            comment: undefined,
            commentId: undefined,
          };
          row.event = structuredClone(external);
        }
        row.jobs = [];
        if (!external.deleted && (row.input.personal || row.input.recurrence)) {
          row.syncStatus = "pending";
          row.jobs.push({
            operationId: input.operationId,
            action: "adopt",
            revision: row.revision,
            input: structuredClone(row.input),
            event: structuredClone(row.event),
            state: "pending",
            attempts: 0,
            nextAttemptAt: 0,
            createdAt: clock(),
          });
        } else {
          row.syncedRevision = row.revision;
          row.syncedAt = clock();
          row.syncStatus = "synced";
        }
      } else {
        if (!row.deleted) {
          if (id.startsWith("activity:"))
            row.event = { ...external, ...completedActivityPatch(external, row.input) };
          else {
            const errors = validateWorkout(row.input.model);
            if (errors.length) fail(errors.join(". "));
            row.event = { ...external, ...expectedPatch(external, row.input.model, row.input) };
            delete row.event.workout_doc;
          }
        }
        row.syncStatus = "pending";
        row.jobs.push({
          operationId: input.operationId,
          action: row.deleted ? "delete" : id.startsWith("activity:") ? "edit-activity" : "edit",
          revision: row.revision,
          input: structuredClone(row.input),
          event: structuredClone(row.event),
          state: "pending",
          attempts: 0,
          nextAttemptAt: 0,
          createdAt: clock(),
        });
      }
      state.operations[input.operationId] = {
        id,
        hash,
        revision: row.revision,
        kind: "resolution",
      };
      if (Buffer.byteLength(JSON.stringify(state)) > 2 * 1024 * 1024)
        fail(
          "Saved workout storage is full. Both versions remain retained; free capacity before resolving this change.",
          507,
          "STORAGE_FULL"
        );
      return resolutionReceipt(row, input.operationId);
    });
  }
  async function drain() {
    const state = await record.read();
    const ids = Object.keys(state.workouts);
    let completed = 0;
    const run = async (id) => {
      for (let pass = 0; pass < 20; pass++) {
        const token = randomUUID();
        const claimed = await record.update((state) => {
          const row = state.workouts[id];
          const job = row.jobs.find((job) => !["synced", "superseded"].includes(job.state));
          if (!job || job.state === "failed" || job.nextAttemptAt > clock()) return null;
          if (job.state === "running" && job.leaseUntil > clock()) return null;
          const uncertain = job.state === "running" || job.uncertain;
          job.state = "running";
          job.token = token;
          job.leaseUntil = clock() + leaseMs;
          return { row: structuredClone(row), job: structuredClone(job), uncertain };
        });
        if (!claimed) return;
        const { row, job } = claimed;
        try {
          let result;
          const persistCommentIntent = async (intent) => {
            await record.update((state) => {
              const active = state.workouts[id].jobs.find(
                (item) => item.operationId === job.operationId
              );
              if (active?.token !== token)
                fail("This comment is being checked by another worker.", 409, "WORKOUT_WRITE_BUSY");
              active.commentIntent = intent;
            });
          };
          const nativeComment = async (workoutId) => {
            const creationId = job.input.commentId || job.operationId;
            const previous = row.commentReceipts?.[creationId];
            if (
              previous &&
              (previous.activityId !== workoutId ||
                previous.hash !== digest(job.input.comment.trim()))
            )
              fail("This comment identity was already used for different text.", 409, "CONFLICT");
            const intent =
              job.commentIntent ||
              (previous
                ? {
                    content: job.input.comment.trim(),
                    creationId,
                    beforeIds: [],
                    providerId: previous.providerId,
                  }
                : null);
            return saveNativeActivityComment(
              request,
              { workoutId, body: job.input.comment, creationId },
              { intent, persistIntent: persistCommentIntent, now: new Date(job.createdAt) }
            );
          };
          if (job.action === "edit-activity") {
            result = await write(row.providerId, (claimedRequest) =>
              saveCompletedWorkout(claimedRequest, row.providerId, {
                ...job.input,
                revision: row.providerRevision,
              })
            );
          } else if (job.action === "complete") {
            const event = await readExternal(row);
            if (!event.paired_activity_id && workoutRevision(event) !== row.providerRevision)
              fail(
                "This workout changed outside the app. Reopen it before completing it.",
                409,
                "CONFLICT"
              );
            result = await completePlannedWorkout(request, row.providerId, event, job.input);
          } else if (job.action === "comment") {
            if (row.providerId.startsWith("activity:")) {
              const comment = await nativeComment(row.providerId);
              const event = await readExternal(row);
              result = {
                workoutId: row.providerId,
                event,
                revision: workoutRevision(event),
                comment,
              };
            } else {
              result = await write(row.providerId, async (claimedRequest) => {
                const event = await claimedRequest(`/athlete/0/events/${row.providerId.slice(6)}`);
                const comments = readWorkoutCommentText(event.description, row.providerId, true);
                if (
                  workoutRevision(event) !== row.providerRevision &&
                  !comments.some(
                    (item) => item.id === `comment-${job.input.commentId || job.operationId}`
                  )
                )
                  fail(
                    "This workout changed outside the app. Reopen it before commenting.",
                    409,
                    "CONFLICT"
                  );
                await saveProviderWorkoutComment(claimedRequest, {
                  workoutId: row.providerId,
                  body: job.input.comment,
                  type: "pre",
                  creationId: job.input.commentId || job.operationId,
                });
                const verified = await claimedRequest(
                  `/athlete/0/events/${row.providerId.slice(6)}`
                );
                return {
                  workoutId: row.providerId,
                  event: verified,
                  revision: workoutRevision(verified),
                };
              });
            }
          } else if (job.action === "create") {
            // Official bulk upsert matches external_id within the application's
            // ownership. It makes an unknown create retry safe without changing
            // existing/imported event identities or integration permissions.
            const upsert = async (path, opts = {}) => {
              if (path === "/athlete/0/events" && opts.method === "POST") {
                const rows = await request("/athlete/0/events/bulk?upsert=true", {
                  ...opts,
                  body: JSON.stringify([JSON.parse(opts.body)]),
                });
                return rows?.[0];
              }
              return request(path, opts);
            };
            result = await createWorkoutEditor(
              upsert,
              {
                ...job.input,
                ...(job.input.completedValues ? { comment: undefined } : {}),
                creationId: id.slice(4),
                reconcileOnly: false,
              },
              providerConnection(config)
            );
          } else if (job.action === "adopt") {
            const event = await readExternal(row);
            if (event.deleted || workoutRevision(event) !== row.providerRevision)
              fail(
                "The external workout changed again while adopting its reviewed version. Both versions remain retained.",
                409,
                "CONFLICT"
              );
            result = { workoutId: row.providerId, revision: row.providerRevision, event };
          } else if (job.action === "delete") {
            if (row.providerId)
              await write(row.providerId, async (claimedRequest) => {
                const path = `/athlete/0/events/${row.providerId.slice(6)}`;
                let remote;
                try {
                  remote = await claimedRequest(path);
                } catch (error) {
                  if (error.status === 404) return;
                  throw error;
                }
                assertEditable(remote);
                if (workoutRevision(remote) !== row.providerRevision)
                  fail(
                    "This workout changed outside the app. Review the external version before deleting.",
                    409,
                    "CONFLICT"
                  );
                await claimedRequest(path, { method: "DELETE" });
                try {
                  await claimedRequest(path);
                } catch (error) {
                  if (error.status === 404) return;
                  throw error;
                }
                fail("Deletion has not been confirmed.", 502, "DELETE_UNCONFIRMED");
              });
            result = { workoutId: row.providerId, revision: row.providerRevision };
          } else {
            if (!row.providerId) fail("The created workout identity has not been confirmed.", 503);
            let editorInput = job.input;
            if (!editorInput.model) {
              const loaded = await loadWorkoutEditor(request, row.providerId);
              editorInput = {
                ...loaded,
                model: { ...loaded.model, date: job.event.start_date_local.slice(0, 10) },
              };
            }
            result = await write(row.providerId, (claimedRequest) =>
              saveWorkoutEditor(
                claimedRequest,
                row.providerId,
                {
                  ...editorInput,
                  ...(editorInput.completedValues ? { comment: undefined } : {}),
                  revision: row.providerRevision,
                },
                providerConnection(config)
              )
            );
          }
          if (["create", "edit"].includes(job.action) && job.input.completedValues) {
            result = {
              ...result,
              ...(await completePlannedWorkout(request, result.workoutId, result.event, job.input)),
            };
          }
          if (
            job.action !== "comment" &&
            job.input.comment?.trim() &&
            (row.providerId?.startsWith("activity:") || result.activityId)
          ) {
            result.comment = await nativeComment(result.activityId || row.providerId);
          }
          if (job.action !== "delete" && job.input.personal) {
            const personal =
              options.personalService ||
              createWorkoutPersonalService({
                record: (key, fresh) =>
                  createEncryptedRecordStore(
                    config,
                    `${row.personalHost}/${providerConnection(config)}/${key}`,
                    {
                      namespace: "workout-personal",
                      name: "WORKOUT_PERSONAL",
                      fresh,
                      timestampCas: true,
                    }
                  ),
              });
            const current = await personal.read(id);
            await personal.save(id, {
              value: job.input.personal,
              revision: current.revision,
              ...(job.input.personalId?.startsWith("draft:")
                ? { migrateFrom: job.input.personalId }
                : {}),
            });
          }
          if (job.action !== "delete" && job.input.recurrence) {
            const recurrence = await (
              options.recurrence ||
              ((id, draft) => saveWorkoutRecurrence(config, request, id, draft))
            )(result.workoutId || row.providerId, job.input.recurrence);
            if (!recurrence.verified)
              fail(
                recurrence.series?.error || "The saved repeat schedule is still synchronizing.",
                503,
                "RECURRENCE_PENDING"
              );
          }
          const hasMore = await record.update((state) => {
            const current = state.workouts[id];
            const active = current.jobs.find((item) => item.operationId === job.operationId);
            if (active?.token !== token) return;
            active.state = "synced";
            active.completedAt = clock();
            active.token = null;
            current.providerId = result.workoutId || current.providerId;
            current.providerRevision = result.revision;
            if (result.activity) current.completedActivity = result.activity;
            if (result.comment?.comments) current.comments = result.comment.comments;
            if (result.comment?.provider_id) {
              current.commentReceipts ||= {};
              current.commentReceipts[job.input.commentId || job.operationId] = {
                providerId: result.comment.provider_id,
                activityId: result.comment.workout_id,
                hash: digest(job.input.comment.trim()),
              };
            }
            current.syncedRevision = job.revision;
            current.syncedAt = clock();
            current.lastReconciledAt = clock();
            current.syncStatus = current.revision === job.revision ? "synced" : "pending";
            current.error = null;
            if (current.revision === job.revision && result.event) current.event = result.event;
            // Complete payloads are retained only for the latest accepted model;
            // operation hashes remain for idempotent retry detection.
            current.jobs = current.jobs.filter(
              (item) => !["synced", "superseded"].includes(item.state)
            );
            return current.jobs.some((item) => item.state === "pending");
          });
          completed++;
          if (!hasMore) return;
        } catch (error) {
          let externalConflict;
          if (error.status === 409 && row.providerId) {
            try {
              externalConflict = await readExternal(row);
            } catch (readError) {
              if (readError.status === 404) externalConflict = { deleted: true };
            }
          }
          await record.update((state) => {
            const current = state.workouts[id];
            const active = current.jobs.find((item) => item.operationId === job.operationId);
            if (active?.token !== token) return;
            active.attempts++;
            active.lastError = error.message;
            const permanent = [400, 401, 403, 404, 409, 422].includes(error.status);
            active.state = permanent ? "failed" : "pending";
            if (error.code === "COMMENT_UNCONFIRMED" && active.attempts >= 3)
              active.state = "failed";
            active.uncertain = !permanent;
            active.token = null;
            active.nextAttemptAt =
              clock() +
              Math.max(
                Number(error.retryAfterMs) || 0,
                Math.min(300_000, 1000 * 2 ** Math.min(active.attempts, 8)) *
                  (0.75 + random() * 0.5)
              );
            current.syncStatus = active.state === "failed" ? "failed" : "pending";
            current.error =
              permanent || error.code === "COMMENT_UNCONFIRMED" ? error.message : null;
            if (externalConflict) current.externalConflict = externalConflict;
          });
          return;
        }
      }
    };
    // A slow workout only occupies one lane. CAS claims also coordinate other
    // processes/tabs, so two drains cannot own the same workout concurrently.
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(4, ids.length) }, async () => {
        while (cursor < ids.length) {
          const id = ids[cursor++];
          if (
            state.workouts[id].jobs.some(
              (job) =>
                !["synced", "superseded", "failed"].includes(job.state) &&
                !(job.nextAttemptAt > clock())
            )
          )
            await run(id);
        }
      })
    );
    // Periodic read-only reconciliation notices external edits/deletions even
    // while no app writes are queued. Keep both versions for explicit review.
    let reconciled = 0;
    for (const row of Object.values((await record.read()).workouts).sort(
      (a, b) => (a.lastReconciledAt || 0) - (b.lastReconciledAt || 0)
    )) {
      if (
        !row.providerId ||
        row.deleted ||
        row.syncedRevision !== row.revision ||
        row.externalConflict ||
        clock() - (row.lastReconciledAt || 0) < 60_000
      )
        continue;
      if (reconciled++ >= 8) break;
      try {
        let external;
        try {
          external = await readExternal(row);
        } catch (error) {
          if (error.status !== 404) throw error;
          external = { deleted: true };
        }
        await record.update((state) => {
          const current = state.workouts[row.id];
          if (current.revision !== row.revision || current.syncedRevision !== row.syncedRevision)
            return;
          current.lastReconciledAt = clock();
          if (external.deleted || workoutRevision(external) !== row.providerRevision) {
            current.externalConflict = external;
            current.syncStatus = "failed";
            current.error =
              "This workout changed outside the app. Both versions are retained; review the external version before saving again.";
          }
        });
      } catch {
        /* Unavailable reads never erase an accepted model or infer deletion. */
      }
    }
    return { completed };
  }
  return {
    accept,
    status,
    editor,
    retry,
    reviewConflict,
    resolveConflict,
    drain,
    project,
    preload: () => record.read(),
  };
}
