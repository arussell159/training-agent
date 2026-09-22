// Automatic import policy, not a training metric calculation.
import { createHash } from "node:crypto";

export const WORKOUT_SETTLE_MS = 24 * 60 * 60 * 1000;
const transient = new Set([
  "synced_at",
  "sync_started_at",
  "source",
  "context_scope",
  "display_range",
  "version",
  "cache_scope",
  "full_history_available",
  "first_imported_at",
]);
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .filter((key) => !transient.has(key) && value[key] !== undefined)
        .map((key) => [key, stable(value[key])])
    );
  return value;
}
export function contentHash(value) {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
export function uniqueWorkouts(context) {
  return [
    ...new Map(
      [...(context?.history || []), ...(context?.planned || [])]
        .filter((w) => w?.id && w.workout_date)
        .map((w) => [String(w.id), w])
    ).values(),
  ];
}
export function completedId(workout) {
  return (workout?.completed === true || workout?.status === "completed") &&
    workout.activity_id != null
    ? String(workout.activity_id)
    : null;
}
export function completedIds(context) {
  return [...new Set(uniqueWorkouts(context).map(completedId).filter(Boolean))].sort();
}
// Prefer the provider's actual UTC start. Do not use a paired calendar start.
function timestamp(value, timeZone) {
  if (typeof value !== "string") return NaN;
  if (/T.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return Date.parse(value);
  const match = value.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.\d+)?$/);
  if (!match) return NaN;
  const parts = match.slice(1).map(Number);
  const naive = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]);
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const wall = (ms) => {
      const p = Object.fromEntries(
        formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value])
      );
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    };
    // Evaluate both sides of a DST transition. The later repeated time is the
    // conservative expiry; nonexistent local times remain unknown.
    const matches = [naive - 86400000, naive, naive + 86400000]
      .map((probe) => naive - (wall(probe) - probe))
      .filter((ms) => wall(ms) === naive);
    return matches.length ? Math.max(...matches) : NaN;
  } catch {
    return NaN;
  }
}
export function frozenWorkout(workout, context, now = Date.now()) {
  if (!completedId(workout)) return false;
  const actual = workout.raw_activity || {};
  const zone = context?.athlete?.time_zone || "America/Chicago";
  const start = timestamp(actual.start_date, zone) || timestamp(actual.start_date_local, zone);
  const seconds = actual.elapsed_time ?? actual.moving_time;
  if (Number.isFinite(start) && Number.isFinite(seconds) && seconds >= 0)
    return now >= start + seconds * 1000 + WORKOUT_SETTLE_MS;
  // With no usable recording clock, use the last verified import timestamp.
  // This is a storage-age fallback, never a fabricated activity end time.
  const imported = Date.parse(workout.first_imported_at || context?.synced_at || "");
  return Number.isFinite(imported) && now >= imported + WORKOUT_SETTLE_MS;
}

export function incrementalSnapshot(previous, incoming, now = Date.now()) {
  if (!previous) return { context: incoming, workouts: uniqueWorkouts(incoming), changed: true };
  const old = uniqueWorkouts(previous),
    byId = new Map(old.map((w) => [String(w.id), w]));
  const byActivity = new Map(old.filter(completedId).map((w) => [completedId(w), w]));
  const frozen = new Map(
    old.filter((w) => frozenWorkout(w, previous, now)).map((w) => [String(w.id), w])
  );
  const byFrozenActivity = new Map([...frozen.values()].map((w) => [completedId(w), w]));
  const rows = new Map();
  for (const candidate of uniqueWorkouts(incoming)) {
    const sameId = frozen.get(String(candidate.id));
    const collision =
      sameId && completedId(candidate) && completedId(candidate) !== completedId(sameId);
    const retained = (!collision && sameId) || byFrozenActivity.get(completedId(candidate));
    let row =
      retained ||
      (collision
        ? { ...candidate, id: `activity:${completedId(candidate)}`, editable: false }
        : candidate);
    if (!retained && completedId(row)) {
      const prior = byId.get(String(row.id)) || byActivity.get(completedId(row));
      const first = prior?.first_imported_at || (prior ? previous.synced_at : incoming.synced_at);
      if (first) row = { ...row, first_imported_at: first };
    }
    rows.set(String(row.id), row);
  }
  // A missing/changed provider pairing, a rolling-window drop or a provider
  // deletion must not erase an archived completed session.
  for (const [id, row] of frozen) rows.set(id, row);
  const ids = new Set(rows.keys());
  const changedRows = [...rows.values()].filter((row) => {
    const before = byId.get(String(row.id)) || byActivity.get(completedId(row));
    return (
      !before || (!frozenWorkout(before, previous, now) && contentHash(before) !== contentHash(row))
    );
  });
  const currentDay = new Intl.DateTimeFormat("en-CA", {
    timeZone: incoming.athlete?.time_zone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  const ordered = [...rows.values()].sort((a, b) => a.workout_date.localeCompare(b.workout_date));
  const context = {
    ...incoming,
    history: ordered.filter((w) => w.workout_date <= currentDay),
    planned: ordered.filter((w) => w.workout_date >= currentDay),
  };
  if (incoming.workouts) context.workouts = context.history;
  // A successful check is not itself new training content. Unchanged imports
  // preserve the previous source timestamp rather than making stale data fresh.
  const snapshotContent = (value) => ({
    ...value,
    history: undefined,
    planned: undefined,
    workouts: undefined,
    wellness_history: value.wellness_history || [],
    performance: value.performance || [],
  });
  const changed =
    changedRows.length > 0 ||
    old.some((w) => !ids.has(String(w.id))) ||
    contentHash(snapshotContent(previous)) !== contentHash(snapshotContent(context));
  return { context: changed ? context : previous, workouts: changedRows, changed };
}
export function changedComments(previous, incoming) {
  const key = (row) => String(row.id || `${row.workout_id}:${row.created_at}:${row.body}`);
  const before = new Map((previous?.comments || []).map((row) => [key(row), contentHash(row)]));
  return (incoming.comments || []).filter((row) => before.get(key(row)) !== contentHash(row));
}
