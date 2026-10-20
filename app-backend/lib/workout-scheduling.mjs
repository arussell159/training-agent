import { createHash } from "node:crypto";
import { copyCalendarWorkout } from "./calendar-workout-copy.mjs";
import { mapIntervalsWorkout, validDate } from "./intervals.mjs";
import { athleteLocalDate } from "./athlete-date.mjs";
const schedulingError = (error) =>
  Object.assign(
    new Error(
      error.message
        .replace(/\bpaste\b/gi, "scheduling request")
        .replace(/\bcopy\b/gi, "scheduled workout")
        .replace(/\bcopied\b/gi, "scheduled")
    ),
    { status: error.status, code: error.code }
  );

export function coachWorkoutCreationId(proposalId, index) {
  const hex = createHash("sha256").update(`coach-calendar:${proposalId}:${index}`).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export async function scheduleLibraryWorkout(config, request, id, input, options = {}) {
  if (!/^library:[1-9]\d*$/.test(id || ""))
    throw Object.assign(Error("Choose a valid saved workout."), { status: 400 });
  validDate(input.date);
  const result = await copyCalendarWorkout(config, request, null, input, {
    ...options,
    sourceId: id,
    loadSource: async () => {
      const saved = await request(`/athlete/0/workouts/${id.slice(8)}`);
      if (
        !saved ||
        String(saved.id) !== id.slice(8) ||
        typeof saved.name !== "string" ||
        typeof saved.type !== "string" ||
        typeof saved.description !== "string"
      )
        throw Error("The library workout could not be loaded.");
      const template = { ...saved };
      delete template.end_date_local;
      return { ...template, category: "WORKOUT", start_date_local: `${input.date}T00:00:00` };
    },
  }).catch((error) => {
    throw schedulingError(error);
  });
  return {
    ...result,
    workout: mapIntervalsWorkout(
      result.event,
      athleteLocalDate(new Date(), config.TIME_ZONE || "America/Chicago")
    ),
  };
}
/** Only the server's stored, approved proposal reaches this function. */
export async function scheduleCoachWorkouts(
  config,
  request,
  proposal,
  { reconcileOnly = false, recordFor } = {}
) {
  const scheduledWorkouts = [],
    failures = [],
    events = [];
  for (const [index, workout] of proposal.workouts.entries()) {
    const creationId = coachWorkoutCreationId(proposal.id, index);
    try {
      const result = await copyCalendarWorkout(
        config,
        request,
        null,
        { date: workout.date, creationId, reconcileOnly, retryRejected: !reconcileOnly },
        {
          ...(recordFor ? { record: recordFor(creationId) } : {}),
          sourceId: `coach:${proposal.id}:${index}`,
          loadSource: async () => ({
            category: "WORKOUT",
            name: workout.name,
            type: workout.type,
            description: workout.description,
            start_date_local: `${workout.date}T00:00:00`,
            ...(workout.duration_minutes != null
              ? { time_target: workout.duration_minutes * 60 }
              : {}),
            ...(workout.tss != null ? { load_target: workout.tss } : {}),
            ...(workout.target ? { target: workout.target } : {}),
            ...(workout.indoor != null ? { indoor: workout.indoor } : {}),
          }),
        }
      );
      scheduledWorkouts.push({
        index,
        workout: mapIntervalsWorkout(
          result.event,
          athleteLocalDate(new Date(), config.TIME_ZONE || "America/Chicago")
        ),
      });
      events.push(result);
    } catch (error) {
      failures.push({ index, error: schedulingError(error).message });
      // Don't start additional writes after an uncertain or rejected one.
      if (!reconcileOnly) break;
    }
  }
  return {
    verified: scheduledWorkouts.length === proposal.workouts.length,
    scheduledWorkouts,
    failures,
    events,
  };
}
