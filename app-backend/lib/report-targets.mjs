import { CoachError } from "./github-coach-source.mjs";
export const REPORT_TEMPLATES = {
  pre: "PRE_WORKOUT_REPORT_TEMPLATE.md",
  post: "POST_WORKOUT_REPORT_TEMPLATE.md",
  weekly: "WEEKLY_REPORT_TEMPLATE.md",
  block: "BLOCK_REPORT_TEMPLATE.md",
};
export { validReportDate, shiftReportDate, planReportBlocks } from "./report-blocks.mjs";
import { validReportDate, shiftReportDate, planReportBlocks } from "./report-blocks.mjs";
export function activityId(workout) {
  const id =
    workout?.activity_id || (workout?.id?.startsWith("activity:") ? workout.id.slice(9) : null);
  return id && /^[A-Za-z0-9_-]{1,100}$/.test(String(id)) ? String(id) : null;
}
export function contextWorkouts(context) {
  return [
    ...new Map(
      [...(context?.history || []), ...(context?.planned || []), ...(context?.workouts || [])]
        .filter((w) => w?.id)
        .map((w) => [w.id, w])
    ).values(),
  ];
}
export function completedActivityIds(context) {
  return [
    ...new Set(
      contextWorkouts(context)
        .filter((w) => w.status === "completed" || w.completed === true)
        .map(activityId)
        .filter(Boolean)
    ),
  ];
}
export function validateReportRequest(input) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    !Object.hasOwn(REPORT_TEMPLATES, input.kind)
  )
    throw new CoachError("Choose a supported report type.", 400);
  const keys =
    input.kind === "weekly"
      ? ["kind", "startDate"]
      : input.kind === "block"
        ? ["kind", "planId", "startDate"]
        : ["kind", "workoutId"];
  if (
    Object.keys(input).some(
      (k) => !keys.includes(k) && !(input.kind === "pre" && k === "checkIn")
    ) ||
    keys.some((k) => typeof input[k] !== "string")
  )
    throw new CoachError("Invalid report target.", 400);
  if (
    input.checkIn !== undefined &&
    (typeof input.checkIn !== "string" ||
      input.checkIn.trim().length < 10 ||
      input.checkIn.length > 2000)
  )
    throw new CoachError(
      "Describe your current Feel, soreness and any new pain or symptoms (10–2000 characters).",
      400
    );
  if (input.kind === "pre" || input.kind === "post") {
    if (!/^(event:\d+|activity:[A-Za-z0-9_-]{1,100})$/.test(input.workoutId))
      throw new CoachError("Choose an Intervals.icu workout.", 400);
  } else if (!validReportDate(input.startDate)) throw new CoachError("Invalid report date.", 400);
  if (input.kind === "weekly" && new Date(input.startDate).getUTCDay() !== 1)
    throw new CoachError("Weekly reports start on Monday.", 400);
  if (input.kind === "block" && !/^[A-Za-z0-9_-]{1,100}$/.test(input.planId))
    throw new CoachError("Invalid annual plan.", 400);
  return {
    ...Object.fromEntries(keys.map((k) => [k, input[k]])),
    ...(input.checkIn ? { checkIn: input.checkIn.trim() } : {}),
  };
}
export function resolveReportTarget(input, context, plans = []) {
  const request = validateReportRequest(input);
  if (request.kind === "weekly")
    return {
      ...request,
      key: `weekly:${request.startDate}`,
      endDate: shiftReportDate(request.startDate, 6),
      title: "Weekly report",
    };
  if (request.kind === "block") {
    const plan = plans.find((p) => p.id === request.planId);
    const block = planReportBlocks(plan).find((b) => b.startDate === request.startDate);
    if (!block) throw new CoachError("This ATP block is no longer in the saved plan.", 404);
    return {
      ...request,
      ...block,
      key: `block:${request.planId}:${request.startDate}`,
      title: `${block.phase} block report`,
      planName: plan.name,
    };
  }
  const workout = contextWorkouts(context).find(
    (w) =>
      w.id === request.workoutId ||
      (request.workoutId.startsWith("activity:") && activityId(w) === request.workoutId.slice(9))
  );
  if (!workout || !validReportDate(workout.workout_date))
    throw new CoachError(
      "Refresh the calendar to load this workout before requesting its report.",
      404
    );
  const completed = workout.status === "completed" || workout.completed === true;
  const actualId = activityId(workout);
  const recordedDate = String(workout.recorded_start_local || "").slice(0, 10);
  const reportDate =
    request.kind === "post" && validReportDate(recordedDate) ? recordedDate : workout.workout_date;
  return {
    ...request,
    key: request.kind === "post" && actualId ? `post:${actualId}` : `${request.kind}:${workout.id}`,
    startDate: reportDate,
    endDate: reportDate,
    title: request.kind === "pre" ? "Pre-workout report" : "Post-workout report",
    completed,
    activityId: actualId,
    workout: {
      id: workout.id,
      activity_id: actualId,
      title: workout.title,
      sport: workout.sport,
      date: reportDate,
      description: workout.details || workout.goal || null,
      planned: workout.planned,
      summary: workout.workout_summary,
      recorded_start_local: workout.recorded_start_local,
    },
  };
}
