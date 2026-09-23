import { CoachError } from "./github-coach-source.mjs";
export const REPORT_TEMPLATES = {
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
  const keys = input.kind === "weekly" ? ["kind", "startDate"] : ["kind", "planId", "startDate"];
  if (
    Object.keys(input).some((k) => !keys.includes(k) && k !== "force") ||
    (input.force !== undefined && typeof input.force !== "boolean") ||
    keys.some((k) => typeof input[k] !== "string")
  )
    throw new CoachError("Invalid report target.", 400);
  if (!validReportDate(input.startDate)) throw new CoachError("Invalid report date.", 400);
  if (input.kind === "weekly" && new Date(input.startDate).getUTCDay() !== 1)
    throw new CoachError("Weekly reports start on Monday.", 400);
  if (input.kind === "block" && !/^[A-Za-z0-9_-]{1,100}$/.test(input.planId))
    throw new CoachError("Invalid annual plan.", 400);
  return {
    ...Object.fromEntries(keys.map((k) => [k, input[k]])),
    ...(input.force ? { force: true } : {}),
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
}
