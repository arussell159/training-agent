import { athleteLocalDate } from "./athlete-date.mjs";
import { syncRevision } from "./sync-record-revision.mjs";

// Whole-context writers retain queue edits accepted after their source read.
// Settled queue fields can be refreshed normally once the source read is current.
export function preserveQueuedSnapshot(current, incoming, { verifiedIds = [] } = {}) {
  if (!current) return incoming;
  const verified = new Set(verifiedIds.map(String));
  const deleted = { ...current.app_deleted_workouts };
  for (const [id, timestamp] of Object.entries(incoming.app_deleted_workouts || {}))
    if (!deleted[id] || timestamp > deleted[id]) deleted[id] = timestamp;
  if (verified.size) {
    const sourceRows = new Map(
      [...(incoming.history || []), ...(incoming.planned || [])].map((row) => [String(row.id), row])
    );
    const currentRows = new Map(
      [...(current.history || []), ...(current.planned || [])].map((row) => [String(row.id), row])
    );
    for (const id of verified) {
      if (sourceRows.has(id)) currentRows.set(id, sourceRows.get(id));
      else currentRows.delete(id);
    }
    incoming = {
      ...current,
      app_deleted_workouts: deleted,
      history: [...currentRows.values()],
      planned: [...currentRows.values()],
    };
  }
  const currentIsNewer =
    current.queue_snapshot_revision &&
    (!incoming.queue_snapshot_revision ||
      syncRevision(current.queue_snapshot_revision) >
        syncRevision(incoming.queue_snapshot_revision));
  const sessions = new Map(
    [...(incoming.history || []), ...(incoming.planned || [])].map((workout) => [
      String(workout.id),
      workout,
    ])
  );
  for (const workout of [...(current.history || []), ...(current.planned || [])]) {
    const newer = sessions.get(String(workout.id));
    if (verified.has(String(workout.id))) {
      if (newer && workout.sync_sequence > 0)
        sessions.set(String(workout.id), {
          ...newer,
          sync_sequence: workout.sync_sequence,
          sync_mutations: workout.sync_mutations
            ? Object.fromEntries(
                Object.entries(workout.sync_mutations).map(([type, edit]) => [
                  type,
                  { ...edit, status: "synced" },
                ])
              )
            : undefined,
          sync_status: "synced",
          sync_operation: null,
        });
      continue;
    }
    if (
      ["pending", "failed"].includes(workout.sync_status) ||
      (workout.app_updated_at &&
        incoming.sync_started_at &&
        workout.app_updated_at > incoming.sync_started_at) ||
      (currentIsNewer &&
        workout.app_updated_at &&
        (!newer?.app_updated_at || workout.app_updated_at > newer.app_updated_at)) ||
      (currentIsNewer &&
        workout.sync_sequence > 0 &&
        workout.sync_sequence >= (newer?.sync_sequence || 0))
    )
      sessions.set(String(workout.id), workout);
    else if (newer && workout.sync_sequence > 0)
      // Provider refreshes may correct settled fields but must retain accepted
      // edit watermarks, so a delayed enqueue projection cannot replay them.
      sessions.set(String(workout.id), {
        ...newer,
        sync_sequence: workout.sync_sequence,
        sync_mutations: workout.sync_mutations,
        sync_status: workout.sync_status,
        sync_operation: workout.sync_operation,
      });
  }
  const today = athleteLocalDate(new Date(), incoming.athlete?.time_zone || "America/Chicago");
  const rows = [...sessions.values()].filter(
    (workout) =>
      !deleted[String(workout.id)] ||
      verified.has(String(workout.id)) ||
      (incoming.sync_started_at && deleted[String(workout.id)] <= incoming.sync_started_at)
  );
  return {
    ...incoming,
    app_deleted_workouts: deleted,
    history: rows.filter((workout) => workout.workout_date <= today),
    planned: rows.filter((workout) => workout.workout_date >= today),
  };
}
