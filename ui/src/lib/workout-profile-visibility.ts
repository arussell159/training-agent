import type { PlannedWorkout } from "./training-context"

type ProfileWorkout = Pick<PlannedWorkout, "unstructured" | "editor_model" | "structure">

/** A single untargeted duration/distance is a simple session, not a profile.
 * Keep its executable provider step intact; this only controls presentation.
 */
export function hasWorkoutProfile(workout: ProfileWorkout): boolean {
  if (workout.unstructured || workout.editor_model?.unstructured) return false
  const model = workout.editor_model
  if (model) {
    if (model.strength || !model.steps.length) return false
    if (model.steps.length > 1) return true
    const step = model.steps[0]
    return step.kind === "repeat"
      ? step.steps.length > 0
      : Boolean(step.target && step.target.kind !== "none") || step.cadence != null
  }
  if (!workout.structure) return false
  try {
    const parsed: unknown = JSON.parse(workout.structure)
    const container = record(parsed)
    const steps = Array.isArray(parsed) ? parsed : container?.steps ?? container?.structure
    if (!Array.isArray(steps)) return false
    const intervals = steps.filter(value => record(value))
    if (intervals.length > 1) return true
    const step = record(intervals[0])
    if (!step) return false
    if (Array.isArray(step.steps) && step.steps.length > 0) return true
    return [step.power, step.pace, step.hr, step.heart_rate, step.rpe, step.cadence].some(value => {
      if (typeof value === "number") return Number.isFinite(value)
      const target = record(value)
      return target && [target.value, target.start, target.end].some(number =>
        typeof number === "number" && Number.isFinite(number)
      )
    })
  } catch {
    return false
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}
