import { createHash, randomUUID } from "node:crypto";
import { athleteLocalDate } from "./athlete-date.mjs";
import {
  normalizeTrainingPeaksPlan,
  overlayTrainingPeaksSnapshot,
} from "./trainingpeaks-planned-model.mjs";

export function trainingPeaksCredentials(config = {}) {
  const cookie = config.TRAININGPEAKS_AUTH_COOKIE ?? process.env.TRAININGPEAKS_AUTH_COOKIE;
  const athlete = String(
    config.TRAININGPEAKS_ATHLETE_ID ?? process.env.TRAININGPEAKS_ATHLETE_ID ?? ""
  );
  if (!cookie || !/^[1-9]\d{0,14}$/.test(athlete)) return null;
  if (/[\r\n]/.test(cookie)) throw Error("The TrainingPeaks connection needs to be renewed.");
  return { cookie, athleteId: Number(athlete) };
}
export const trainingPeaksSnapshotId = (config) => {
  const credentials = trainingPeaksCredentials(config);
  return credentials
    ? `trainingpeaks-planned:v1:${createHash("sha256")
        .update(`${config.SETTINGS_SCOPE || "default"}:${credentials.athleteId}`)
        .digest("hex")}`
    : null;
};
export async function overlayTrainingPeaksPlans(config, store, context, now = new Date()) {
  const id = trainingPeaksSnapshotId(config);
  if (!id || !store.ready) return context;
  const snapshot = await store.getSyncRecord(id);
  return overlayTrainingPeaksSnapshot(
    context,
    snapshot,
    athleteLocalDate(now, context.athlete?.time_zone || "America/Chicago")
  );
}

export function createTrainingPeaksPlanned({
  store,
  config,
  fetchImpl = fetch,
  now = () => new Date(),
}) {
  const credentials = trainingPeaksCredentials(config),
    recordId = trainingPeaksSnapshotId(config);
  let token = null,
    inFlight = null;
  const shift = (date, offset) =>
    new Date(Date.parse(`${date}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  async function json(path, headers) {
    // Deliberately no caller-selected URL or method: this connector cannot write
    // a TrainingPeaks workout, calendar entry or account setting.
    const response = await fetchImpl(`https://tpapi.trainingpeaks.com${path}`, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: { Accept: "application/json", ...headers },
    });
    if (!response.ok) {
      const error = Error(
        [401, 403].includes(response.status)
          ? "Reconnect TrainingPeaks to resume planned-workout imports."
          : response.status === 429
            ? "TrainingPeaks is limiting requests. The saved plan will refresh later."
            : "TrainingPeaks is temporarily unavailable. Your saved plan is retained."
      );
      error.reconnect = [401, 403].includes(response.status);
      error.retryMs =
        response.status === 429
          ? Math.min(
              3600000,
              Math.max(300000, Number(response.headers?.get("Retry-After")) * 1000 || 300000)
            )
          : 300000;
      throw error;
    }
    const length = Number(response.headers?.get("content-length"));
    if (length > 8000000) throw Error("The TrainingPeaks plan response is too large.");
    const text = await response.text();
    if (text.length > 8000000) throw Error("The TrainingPeaks plan response is too large.");
    try {
      return JSON.parse(text);
    } catch {
      throw Error("TrainingPeaks returned an unreadable response. Your saved plan is retained.");
    }
  }
  async function bearer() {
    if (token && token.until > now().getTime() + 60000) return token.value;
    const result = await json("/users/v3/token", {
      Cookie: `Production_tpAuth=${credentials.cookie}`,
    });
    if (!result.success || typeof result.token?.access_token !== "string")
      throw Object.assign(Error("Reconnect TrainingPeaks to resume planned-workout imports."), {
        reconnect: true,
      });
    const value = result.token.access_token;
    const profile = await json("/users/v3/user", { Authorization: `Bearer ${value}` });
    if (profile.user?.userId !== credentials.athleteId)
      throw Object.assign(
        Error("The TrainingPeaks account does not match this app's configured athlete."),
        { reconnect: true }
      );
    token = {
      value,
      until: now().getTime() + Math.min(86400, Number(result.token.expires_in) || 300) * 1000,
    };
    return value;
  }
  async function read() {
    return recordId && store.ready ? await store.getSyncRecord(recordId) : null;
  }
  async function refresh({ force = false, timeZone = "America/Chicago" } = {}) {
    if (!credentials || !store.ready) return null;
    if (inFlight) return inFlight;
    const task = (async () => {
      const started = now(),
        time = started.getTime(),
        lease = randomUUID();
      const claim = await store.updateSyncRecord(recordId, (row) => {
        const state = row?.cursor || {};
        if (
          (state.leaseUntil || 0) > time ||
          (state.retryAt || 0) > time ||
          (!force && time - Date.parse(state.lastAttemptAt || "1970-01-01") < 300000)
        )
          return null;
        return {
          status: "trainingpeaks-plan",
          cursor: {
            ...state,
            lease,
            leaseUntil: time + 90000,
            lastAttemptAt: started.toISOString(),
          },
        };
      });
      if (claim?.cursor?.lease !== lease) return claim?.cursor || null;
      try {
        const today = athleteLocalDate(started, timeZone),
          rangeStart = shift(today, -90),
          rangeEnd = shift(today, 89);
        const authorization = `Bearer ${await bearer()}`;
        const rows = [];
        for (let start = rangeStart; start <= rangeEnd; ) {
          const end = shift(start, 89) < rangeEnd ? shift(start, 89) : rangeEnd;
          const batch = await json(
            `/fitness/v6/athletes/${credentials.athleteId}/workouts/${start}/${end}`,
            { Authorization: authorization }
          );
          if (!Array.isArray(batch) || batch.length > 4000 || rows.length + batch.length > 6000)
            throw Error("TrainingPeaks returned an invalid planned-workout list.");
          rows.push(...batch);
          start = shift(end, 1);
        }
        const ids = new Set(),
          workouts = [];
        for (const row of rows) {
          const workout = normalizeTrainingPeaksPlan(row, {
            athleteId: credentials.athleteId,
            today,
          });
          if (!workout) continue;
          if (
            workout.workout_date < rangeStart ||
            workout.workout_date > rangeEnd ||
            ids.has(workout.id)
          )
            throw Error("TrainingPeaks returned an inconsistent planned-workout list.");
          ids.add(workout.id);
          // Earlier history remains as it was before this source was enabled.
          if (workout.workout_date >= (claim.cursor.activatedDay || today)) workouts.push(workout);
        }
        const saved = await store.updateSyncRecord(recordId, (row) => {
          if (row?.cursor?.lease !== lease) return null;
          return {
            status: "trainingpeaks-plan",
            cursor: {
              workouts,
              athleteId: credentials.athleteId,
              activatedDay: row.cursor.activatedDay || today,
              activatedAt: row.cursor.activatedAt || started.toISOString(),
              lastSyncedAt: now().toISOString(),
              lastAttemptAt: started.toISOString(),
              rangeStart,
              rangeEnd,
              error: null,
              reconnectRequired: false,
            },
          };
        });
        return saved.cursor;
      } catch (error) {
        token = null;
        const saved = await store.updateSyncRecord(recordId, (row) =>
          row?.cursor?.lease === lease
            ? {
                status: "trainingpeaks-plan",
                cursor: {
                  ...row.cursor,
                  lease: null,
                  leaseUntil: 0,
                  error: error.reconnect
                    ? error.message
                    : "TrainingPeaks could not be refreshed. Your last imported plan is retained.",
                  reconnectRequired: Boolean(error.reconnect),
                  retryAt: now().getTime() + (error.retryMs || 300000),
                },
              }
            : null
        );
        return saved?.cursor || null;
      }
    })();
    inFlight = task;
    try {
      return await task;
    } finally {
      if (inFlight === task) inFlight = null;
    }
  }
  return { enabled: Boolean(credentials), read, refresh };
}
