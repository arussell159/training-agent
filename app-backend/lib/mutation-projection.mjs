import { providerConnection } from "./completed-workout-store.mjs";
import { pendingMutationContext, mutationSyncFields } from "./mutation-queue.mjs";
import { saveFastView } from "./fast-context.mjs";

export function createMutationProjection(config, store) {
  const update = async (change) => {
    const latest = await store.getLatestSyncState(null, { fresh: true });
    if (!latest) throw Error("Load the saved calendar before editing.");
    const saved = await store.updateSyncRecord(latest.athlete_id, (row, revision) => {
      const context = row?.cursor?.context;
      if (!context || context.provider_connection !== providerConnection(config))
        throw Error("The saved calendar connection changed. Refresh before editing.");
      const next = change(context);
      if (JSON.stringify(next) === JSON.stringify(context)) return null;
      return {
        ...row,
        cursor: { ...row.cursor, context: { ...next, queue_snapshot_revision: revision } },
      };
    });
    return saveFastView(config, store, saved.cursor.context, { atomic: true });
  };
  return {
    pending(job) {
      return update((context) => pendingMutationContext(context, job.mutation, job.sequence));
    },
    status(mutation, status, result = {}, sequence) {
      return update((context) => {
        if (sequence != null) context = pendingMutationContext(context, mutation, sequence);
        const map = (workout) => {
          const edit = workout.sync_mutations?.[mutation.type];
          if (edit) {
            if (edit.operationId !== mutation.operationId || edit.status === status) return workout;
            return {
              ...workout,
              ...(mutation.type === "move" && result.event ? { raw: result.event } : {}),
              ...mutationSyncFields(workout, {
                ...workout.sync_mutations,
                [mutation.type]: { ...edit, status },
              }),
              app_updated_at: new Date().toISOString(),
            };
          }
          if (
            workout.sync_operation !== mutation.operationId ||
            (status !== "synced" && workout.sync_status === status)
          )
            return workout;
          return {
            ...workout,
            ...(mutation.type === "move" && result.event ? { raw: result.event } : {}),
            sync_status: status,
            sync_operation: status === "synced" ? null : mutation.operationId,
            app_updated_at: new Date().toISOString(),
          };
        };
        return { ...context, history: context.history.map(map), planned: context.planned.map(map) };
      });
    },
  };
}
