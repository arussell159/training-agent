// Explicitly requested disposable live integration audit. Never reads credentials
// from CLI arguments and never logs them. Default execution is read-only config
// discovery; --live enables creation and deletion of only this run's records.
import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createSettingsService, STORED_SETTINGS } from "../app-backend/lib/settings-store.mjs";
import { createEncryptedRecordStore } from "../app-backend/lib/app-auth-store.mjs";
import { providerConnection } from "../app-backend/lib/completed-workout-store.mjs";
import { createDurableWorkoutCommits } from "../app-backend/lib/durable-workout-commits.mjs";
import { createIntervalsClient } from "../app-backend/lib/intervals.mjs";
import { loadNewWorkoutEditor } from "../app-backend/lib/workout-editor.mjs";
import { newStep, verifyParsedWorkout } from "../app-backend/lib/workout-editor-model.mjs";
import { createContextStore } from "../app-backend/lib/supabase-context.mjs";
import { fastViewId } from "../app-backend/lib/fast-context.mjs";

const keys = [
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_PUBLISHABLE_KEY",
  "SETTINGS_ENCRYPTION_KEY",
  "SETTINGS_SCOPE",
  "INTERVALS_API_KEY",
];
const file = JSON.parse(
  await fs.readFile(new URL("../app-backend/config.json", import.meta.url), "utf8")
);
const bootstrap = {
  ...Object.fromEntries(
    keys.filter((key) => process.env[key]).map((key) => [key, process.env[key]])
  ),
  ...file,
};
const config = await createSettingsService({
  readBootstrap: async () => bootstrap,
  writeBootstrap: async () => {},
  hosted: false,
}).read(
  STORED_SETTINGS.filter(
    (key) =>
      ![
        "APP_DATA",
        "HISTORICAL_ARCHIVE",
        "TRAININGPEAKS_IMPORT_REPORT",
        "RACE_PLAN_IMPORT_REPORT",
        "COMPLETION_CONFIRMATION",
      ].includes(key)
  )
);
if (!config.INTERVALS_API_KEY || config.settingsError) {
  console.log(
    JSON.stringify({
      verified: false,
      blocker: config.settingsError || "The configured app's Intervals.icu key is unavailable.",
      credentialsPrinted: false,
    })
  );
  process.exitCode = 1;
} else if (!process.argv.includes("--live")) {
  const athlete = await createIntervalsClient(config)("/athlete/0");
  const view = await createContextStore(config).getSyncRecord(fastViewId(config));
  console.log(
    JSON.stringify({
      ready: true,
      liveWrites: false,
      appAccountMatchesExistingSnapshot: String(athlete.id) === String(view?.athlete?.id),
      snapshotAvailable: Boolean(view?.athlete?.id),
    })
  );
} else {
  const runId = randomUUID();
  const request = createIntervalsClient(config);
  // Separate durable ledger prevents this audit from draining any unrelated
  // accepted user operations. The database/CAS implementation is identical.
  const record = createEncryptedRecordStore(config, `${providerConnection(config)}:${runId}`, {
    namespace: "workout-commit-audit",
    name: "WORKOUT_COMMIT_AUDIT",
    fresh: () => ({ version: 1, workouts: {}, operations: {} }),
    timestampCas: true,
  });
  const service = () => createDurableWorkoutCommits(config, { record, request });
  const created = [];
  const report = {
    runId,
    source: "existing app encrypted settings",
    records: [],
    cleanup: [],
    verified: false,
  };
  const native = async (id, method = "GET") => {
    const response = await fetch(`https://intervals.icu/api/v1/athlete/0/events/${id.slice(6)}`, {
      method,
      signal: AbortSignal.timeout(30_000),
      headers: {
        Authorization: `Basic ${Buffer.from(`API_KEY:${config.INTERVALS_API_KEY}`).toString("base64")}`,
        Accept: "application/json",
      },
    });
    if (!response.ok)
      throw Object.assign(Error(`Independent external ${method} failed (${response.status})`), {
        status: response.status,
      });
    return method === "GET" ? response.json() : null;
  };
  try {
    for (const sport of ["Swim", "Ride", "Run"]) {
      const operationId = randomUUID();
      const date = "2026-10-21";
      const loaded = await loadNewWorkoutEditor(request, date, {
        sport,
        name: `Disposable Codex parity ${sport} ${runId.slice(0, 8)}`,
      });
      const model = {
        ...loaded.model,
        notes: "Disposable integration verification; remove only this record.",
        steps: [newStep(sport)],
      };
      if (sport === "Swim") {
        model.poolLength = "25m";
        model.steps[0].end = { kind: "distance", value: 100, unit: "m" };
        model.steps[0].target = { kind: "pace", unit: "secs/100m", mode: "single", value: 120 };
      }
      const start = performance.now();
      const accepted = await service().accept({
        operationId,
        workoutId: `app:${operationId}`,
        action: "create",
        input: { model, zoneSettings: loaded.zoneSettings },
      });
      created.push(accepted.workoutId);
      const acceptedMs = performance.now() - start;
      const syncStart = performance.now();
      await service().drain();
      const firstSyncMs = performance.now() - syncStart;
      let row = (await service().status()).workouts.find(
        (row) => row.workoutId === accepted.workoutId
      );
      if (row.syncStatus !== "synced")
        throw Error(`${sport} create not synchronized: ${row.syncError || "pending"}`);
      const external = await native(row.providerWorkoutId);
      const errors = verifyParsedWorkout(model, external);
      if (
        errors.length ||
        external.name !== model.name ||
        external.type !== sport ||
        external.start_date_local.slice(0, 10) !== date
      )
        throw Error(`${sport} independent native prescription mismatch: ${errors.join("; ")}`);
      const reopened = await service().editor(accepted.workoutId);
      if (JSON.stringify(reopened.model) !== JSON.stringify(model))
        throw Error(`${sport} durable app model changed after reopen`);
      const nextModel = {
        ...model,
        name: `${model.name} edited`,
        notes: `${model.notes}\nFurther edit retained.`,
      };
      await service().accept({
        operationId: randomUUID(),
        workoutId: row.workoutId,
        revision: row.revision,
        action: "edit",
        input: { model: nextModel },
      });
      await service().drain();
      const final = (await service().status()).workouts.find(
        (item) => item.workoutId === row.workoutId
      );
      if (final.syncStatus !== "synced" || final.providerWorkoutId !== row.providerWorkoutId)
        throw Error(`${sport} edit identity or acknowledgment mismatch`);
      const editedExternal = await native(final.providerWorkoutId);
      if (
        editedExternal.name !== nextModel.name ||
        verifyParsedWorkout(nextModel, editedExternal).length
      )
        throw Error(`${sport} independent edit mismatch`);
      const secondReopen = await service().editor(row.workoutId);
      if (JSON.stringify(secondReopen.model) !== JSON.stringify(nextModel))
        throw Error(`${sport} second durable reopen lost editor information`);
      report.records.push({
        sport,
        appId: row.workoutId,
        providerId: row.providerWorkoutId,
        acceptedMs: Math.round(acceptedMs),
        firstSyncMs: Math.round(firstSyncMs),
        createAndEditRoundTripMs: Math.round(performance.now() - syncStart),
        latestRevision: final.revision,
        externalReadback: true,
        reopenedModelExact: true,
      });
    }
    report.verified = true;
  } catch (error) {
    report.error = error.message;
    process.exitCode = 1;
  } finally {
    for (const id of created) {
      try {
        const row = (await service().status()).workouts.find((item) => item.workoutId === id);
        // If creation succeeded externally but the local receipt was lost,
        // reconcile its unique external identity without touching other events.
        let providerId = row.providerWorkoutId;
        if (!providerId) {
          const rows = await request("/athlete/0/events?oldest=2026-10-21&newest=2026-10-21");
          const own = rows.filter(
            (event) => event.external_id === `training-agent:editor:${id.slice(4)}`
          );
          if (own.length > 1)
            throw Error("More than one own disposable event requires explicit audit cleanup");
          providerId = own[0] ? `event:${own[0].id}` : null;
        }
        if (providerId) {
          const before = await native(providerId);
          if (
            before.external_id !== `training-agent:editor:${id.slice(4)}` ||
            !before.name.includes(runId.slice(0, 8))
          )
            throw Error("Refusing cleanup: disposable ownership no longer matches");
          await native(providerId, "DELETE");
          try {
            await native(providerId);
            throw Error("Disposable event still exists");
          } catch (error) {
            if (error.status !== 404) throw error;
          }
        }
        report.cleanup.push({ appId: id, providerId, removed: true });
      } catch (error) {
        report.cleanup.push({ appId: id, removed: false, error: error.message });
        process.exitCode = 1;
      }
    }
    await fs.writeFile(
      new URL(
        "../docs/trainingpeaks-parity/LIVE-COMMIT-ROUNDTRIP-2026-10-21.json",
        import.meta.url
      ),
      JSON.stringify(report, null, 2) + "\n"
    );
    console.log(JSON.stringify(report));
  }
}
