// Pending plan edits own their draft fields, never the paired recording. A
// refresh can discover completion while an older move/description is unsettled.
export function preserveRecordedWorkout(local, provider) {
  if (!provider?.completed || !provider.activity_id) return local;
  const move = local.sync_mutations?.move;
  const moving = move
    ? move.status !== "synced"
    : ["pending", "failed"].includes(local.sync_status);
  return {
    ...local,
    completed: true,
    status: "completed",
    activity_id: provider.activity_id,
    activity_file_type: provider.activity_file_type,
    activity_revision: provider.activity_revision,
    actualDurationMinutes: provider.actualDurationMinutes,
    distance_meters: provider.distance_meters,
    completed_data: provider.completed_data,
    raw_activity: provider.raw_activity,
    recorded_start_local: provider.recorded_start_local || provider.raw_activity?.start_date_local,
    device_name: provider.device_name || provider.raw_activity?.device_name,
    measurement_quality: provider.measurement_quality,
    workout_summary: {
      ...local.workout_summary,
      completed: provider.workout_summary?.completed,
    },
    // The plan may move; the recording remains on the day it actually happened.
    workout_date: provider.workout_date,
    day: provider.day,
    date: provider.date,
    planned_workout_date: moving
      ? local.completed
        ? local.planned_workout_date ||
          local.raw?.start_date_local?.slice(0, 10) ||
          local.workout_date
        : local.workout_date
      : provider.planned_workout_date,
  };
}

// A plan tombstone must never be a recording tombstone. Completion can arrive
// after a delete's source read, including during the final snapshot CAS retry.
export function recordingAfterPlanDeletion(workout) {
  if (!workout?.activity_id || !(workout.completed || workout.status === "completed")) return null;
  const recording = workout.raw_activity
    ? { ...workout.raw_activity, paired_event_id: null }
    : null;
  const clean = Object.fromEntries(
    Object.entries(workout).filter(([key]) => !key.startsWith("sync_"))
  );
  return {
    ...clean,
    id: `activity:${workout.activity_id}`,
    editable: false,
    category: "ACTIVITY",
    completed: true,
    status: "completed",
    title: recording?.name || workout.title,
    planned_workout_date: null,
    scheduled_start_at: null,
    plannedDurationMinutes: 0,
    planned: { duration_minutes: 0, tss: 0 },
    structure: null,
    editor_model: null,
    planned_time_label: null,
    planned_values_edited: false,
    goal: recording?.description || "",
    details: recording?.description || "",
    editable_description: recording?.description || "",
    workout_summary: { planned: null, completed: workout.workout_summary?.completed || null },
    raw: recording,
    raw_activity: recording,
  };
}
