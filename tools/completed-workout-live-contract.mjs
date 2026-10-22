// One explicitly enabled, disposable native contract check. App settings are
// read once; all journal/editor metadata is in memory. It never drains a user
// queue, writes Supabase, or edits an existing athlete workout.
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createSettingsService } from "../app-backend/lib/settings-store.mjs";
import { createProviderWorkoutMetadata } from "../app-backend/lib/provider-workout-metadata.mjs";
import { createDurableWorkoutCommits } from "../app-backend/lib/durable-workout-commits.mjs";
import {
  loadCompletedWorkoutEditor,
  saveCompletedWorkout,
} from "../app-backend/lib/completed-workout-edits.mjs";
import { workoutRevision } from "../app-backend/lib/workout-editor.mjs";

if (!process.argv.includes("--live")) {
  console.log(
    JSON.stringify({
      liveWrites: false,
      plan: "One disposable plan, one paired manual completion, one activity edit, one native comment; own records removed. One settings read and zero database writes.",
    })
  );
} else {
  const bootstrapFile = JSON.parse(
    await fs.readFile(new URL("../app-backend/config.json", import.meta.url), "utf8")
  );
  const bootstrapKeys = [
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_PUBLISHABLE_KEY",
    "SETTINGS_ENCRYPTION_KEY",
    "SETTINGS_SCOPE",
    "INTERVALS_API_KEY",
  ];
  const bootstrap = {
    ...Object.fromEntries(
      bootstrapKeys.filter((key) => process.env[key]).map((key) => [key, process.env[key]])
    ),
    ...bootstrapFile,
  };
  const counts = {
    supabaseReads: 0,
    supabaseWrites: 0,
    providerReads: 0,
    providerWrites: 0,
    journalReads: 0,
    journalUpdates: 0,
    metadataReads: 0,
    metadataUpdates: 0,
  };
  const settingsFetch = async (url, options = {}) => {
    if (!["GET", "HEAD"].includes((options.method || "GET").toUpperCase()))
      throw Error("This audit cannot write Supabase.");
    counts.supabaseReads++;
    return fetch(url, options);
  };
  const config = await createSettingsService({
    readBootstrap: async () => bootstrap,
    writeBootstrap: async () => {},
    hosted: false,
    fetchImpl: settingsFetch,
  }).read(["INTERVALS_API_KEY"]);
  if (!config.INTERVALS_API_KEY || config.settingsError)
    throw Error("The configured Intervals connection is unavailable.");
  const runId = randomUUID(),
    appId = `app:${runId}`,
    records = new Map();
  const title = `Disposable sync contract ${runId}`;
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const ownedActivityObservations = new Map(),
    ownedActivityIntents = new Map();
  const raw = async (path, options = {}) => {
    const writing = !["GET", "HEAD"].includes((options.method || "GET").toUpperCase());
    if (options.method === "PUT" && ownedActivityObservations.has(path))
      ownedActivityIntents.set(path, JSON.parse(options.body || "{}"));
    counts[writing ? "providerWrites" : "providerReads"]++;
    const response = await fetch(`https://intervals.icu/api/v1${path}`, {
      ...options,
      signal: AbortSignal.timeout(20000),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: `Basic ${Buffer.from(`API_KEY:${config.INTERVALS_API_KEY}`).toString("base64")}`,
      },
    });
    if (!response.ok) {
      let detail = "";
      if (response.status === 422) {
        const text = await response.text();
        detail = text
          .replaceAll(config.INTERVALS_API_KEY, "[redacted]")
          .replace(/Basic\s+[A-Za-z0-9+/=]+/g, "[redacted]")
          .slice(0, 700);
      }
      throw Object.assign(
        Error(
          `Native ${options.method || "GET"} returned ${response.status}.${detail ? " " + detail : ""}`
        ),
        {
          status: response.status,
        }
      );
    }
    const text = await response.text();
    const value = text ? JSON.parse(text) : null;
    if (
      /^\/activity\/i?[1-9]\d*$/.test(path) &&
      value?.name?.includes(runId) &&
      /^training-agent:completion:/.test(value.external_id || "")
    )
      ownedActivityObservations.set(path, value);
    return value;
  };
  const record = (key, fresh, kind = "metadata") => ({
    read: async () => {
      counts[`${kind}Reads`]++;
      return structuredClone(records.get(key) ?? fresh());
    },
    update: async (change) => {
      counts[`${kind}Updates`]++;
      const state = structuredClone(records.get(key) ?? fresh()),
        result = change(state);
      records.set(key, state);
      return result;
    },
  });
  const request = createProviderWorkoutMetadata({ record }).wrap(raw);
  const service = createDurableWorkoutCommits(config, {
    request,
    record: record("journal", () => ({ version: 1, workouts: {}, operations: {} }), "journal"),
    write: (_id, change) => change(request),
  });
  const report = {
    runId,
    verified: false,
    syntheticDatabase: true,
    counts,
    steps: [],
    cleanup: [],
    error: null,
    durationEditRequested: false,
    durationReadOnlyVerified: false,
  };
  let eventId = null,
    activityId = null;
  const assertDeleted = async (path) => {
    try {
      await raw(path);
    } catch (error) {
      if (error.status === 404) return;
      throw error;
    }
    throw Error("Disposable record deletion has not been independently confirmed.");
  };
  const synced = async (id) => {
    await service.drain();
    const row = (await service.status()).workouts.find((row) => row.workoutId === id);
    if (!row?.verified) {
      const job = records
        .get("journal")
        ?.workouts[id]?.jobs?.find((job) => !["synced", "superseded"].includes(job.state));
      throw Error(
        row?.syncError || job?.lastError || "Native contract did not reach verified sync."
      );
    }
    return row;
  };
  try {
    const model = {
      version: 1,
      name: title,
      sport: "Run",
      date,
      notes: "Disposable contract verification",
      unstructured: true,
      poolLength: "",
      steps: [],
      thresholds: {},
    };
    await service.accept({
      workoutId: appId,
      operationId: randomUUID(),
      action: "create",
      input: {
        model,
        description: "Disposable description round-trip",
        values: { duration_seconds: 60, distance_meters: 200, tss: 1 },
      },
    });
    let row = await synced(appId);
    eventId = row.providerWorkoutId;
    report.steps.push("planned-create-verified");
    await service.accept({
      workoutId: appId,
      operationId: randomUUID(),
      action: "complete",
      input: {
        revision: row.revision,
        model,
        description: "Disposable description round-trip",
        completedValues: { duration_seconds: 60, distance_meters: 200, tss: 1 },
      },
    });
    row = await synced(appId);
    activityId = `activity:${row.completedActivity.id}`;
    report.steps.push("paired-manual-completion-verified");
    const before = await raw(`/activity/${activityId.slice(9)}`);
    const editor = await loadCompletedWorkoutEditor(request, activityId);
    const writesBeforeReadOnlyCheck = counts.providerWrites;
    try {
      await saveCompletedWorkout(request, activityId, {
        revision: editor.revision,
        completedValues: { duration_seconds: 75 },
      });
      throw Error("Existing activity duration unexpectedly accepted an unsupported edit.");
    } catch (error) {
      if (error.code !== "ACTIVITY_DURATION_READ_ONLY") throw error;
      if (counts.providerWrites !== writesBeforeReadOnlyCheck)
        throw Error("Read-only duration attempted a native write.");
      report.durationReadOnlyVerified = true;
    }
    await service.accept({
      workoutId: activityId,
      operationId: randomUUID(),
      action: "edit-activity",
      baseEvent: before,
      input: {
        revision: workoutRevision(before),
        model: { ...editor.model, name: title + " edited" },
        description: "Edited description round-trip",
        completedValues: {
          distance_meters: 225,
          calories: 10,
          tss: 1,
        },
      },
    });
    row = await synced(activityId);
    const independent = await raw(`/activity/${activityId.slice(9)}`);
    if (
      independent.description !== "Edited description round-trip" ||
      independent.moving_time !== 60 ||
      Math.abs((independent.icu_distance ?? independent.distance) - 225) > 0.001
    )
      throw Error("Independent native activity fields did not match.");
    report.steps.push("activity-edit-independent-readback-verified");
    const operationId = randomUUID(),
      comment = `Disposable feedback ${runId}`;
    await service.accept({
      workoutId: activityId,
      operationId,
      action: "comment",
      input: { revision: row.revision, comment, commentId: operationId },
    });
    await synced(activityId);
    const messages = await raw(`/activity/${activityId.slice(9)}/messages?limit=100`);
    if (messages.filter((message) => message.content === comment).length !== 1)
      throw Error("Native activity comment did not appear exactly once.");
    report.steps.push("native-comment-independent-readback-verified");
    report.verified = true;
  } catch (error) {
    report.error = String(error.message).slice(0, 600);
    report.verificationDiff = [...ownedActivityIntents].flatMap(([path, expected]) => {
      const observed = ownedActivityObservations.get(path) || {};
      return Object.entries(expected)
        .filter(([key, value]) => {
          const actual =
            key === "icu_distance" ? (observed.icu_distance ?? observed.distance) : observed[key];
          return JSON.stringify(actual ?? null) !== JSON.stringify(value ?? null);
        })
        .map(([key, value]) => ({
          field: key,
          ...(typeof value === "number"
            ? {
                expected: value,
                observed:
                  key === "icu_distance"
                    ? (observed.icu_distance ?? observed.distance ?? null)
                    : (observed[key] ?? null),
              }
            : { mismatch: true }),
        }));
    });
  } finally {
    try {
      if (!eventId) {
        const events = await raw(`/athlete/0/events?oldest=${date}&newest=${date}`);
        const own = events.filter(
          (event) => event.external_id === `training-agent:editor:${runId}`
        );
        if (own.length > 1)
          throw Error("Ambiguous disposable plan identity; automatic cleanup stopped.");
        if (own[0]) eventId = `event:${own[0].id}`;
      }
      if (eventId) {
        const event = await raw(`/athlete/0/events/${eventId.slice(6)}`);
        if (event.external_id !== `training-agent:editor:${runId}` || !event.name.includes(runId))
          throw Error("Cleanup refused a plan that is not owned by this run.");
        if (!activityId && event.paired_activity_id)
          activityId = `activity:${event.paired_activity_id}`;
        if (!activityId) {
          const activities = await raw(`/athlete/0/activities?oldest=${date}&newest=${date}`);
          const own = activities.filter(
            (activity) => activity.external_id === `training-agent:completion:${eventId.slice(6)}`
          );
          if (own.length > 1)
            throw Error(
              "Ambiguous disposable manual activity identity; automatic cleanup stopped."
            );
          if (own[0]) activityId = `activity:${own[0].id}`;
        }
        if (activityId) {
          const activity = await raw(`/activity/${activityId.slice(9)}`);
          if (
            activity.external_id !== `training-agent:completion:${eventId.slice(6)}` ||
            !activity.name.includes(runId)
          )
            throw Error("Cleanup refused an activity that is not owned by this run.");
          await raw(`/activity/${activityId.slice(9)}`, { method: "DELETE" });
          await assertDeleted(`/activity/${activityId.slice(9)}`);
          report.cleanup.push("own-manual-activity-deleted");
        }
        await raw(`/athlete/0/events/${eventId.slice(6)}`, { method: "DELETE" });
        await assertDeleted(`/athlete/0/events/${eventId.slice(6)}`);
        report.cleanup.push("own-planned-event-deleted");
      }
    } catch (error) {
      report.cleanup.push(`Cleanup requires review: ${String(error.message).slice(0, 200)}`);
      report.verified = false;
    }
    await fs.mkdir(new URL("../artifacts/", import.meta.url), { recursive: true });
    await fs.writeFile(
      new URL("../artifacts/desktop-completed-live-contract.json", import.meta.url),
      JSON.stringify(report, null, 2)
    );
    console.log(JSON.stringify(report));
    if (!report.verified) process.exitCode = 1;
  }
}
