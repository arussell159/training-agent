import { chartSegments } from "../../../app-backend/lib/workout-editor-model.mjs"
import { workoutProfileSegments } from "./workout-structure.ts"
import type { PlannedWorkout } from "./training-context"

// A calendar card needs a silhouette. Detailed interval interactions stay in the
// workout editor, without hundreds of interactive controls in every day cell.
export function calendarProfilePath(workout: PlannedWorkout) {
  try {
    const segments = workout.editor_model
      ? chartSegments(workout.editor_model).segments.map((segment) => ({
          width: segment.width,
          start: segment.start,
          end: segment.end,
        }))
      : workoutProfileSegments(workout.structure).map((segment) => ({
          width: segment.width,
          start: segment.intensity / 100,
          end: segment.intensity / 100,
        }))
    const total = segments.reduce((sum, segment) => sum + segment.width, 0)
    if (
      !segments.length ||
      !Number.isFinite(total) ||
      total <= 0 ||
      segments.some(
        (segment) =>
          ![segment.width, segment.start, segment.end].every(Number.isFinite)
      )
    )
      return null
    const max = Math.max(
      0.01,
      ...segments.flatMap((segment) => [segment.start, segment.end])
    )
    const y = (value: number) =>
      Math.max(0, 20 - (3 + (Math.max(0, value) / max) * 17)).toFixed(2)
    let offset = 0
    let path = "M0,20"
    for (const segment of segments) {
      const left = (offset / total) * 1000
      offset += segment.width
      const right = (offset / total) * 1000
      path += `L${left.toFixed(3)},20L${left.toFixed(3)},${y(segment.start)}L${right.toFixed(3)},${y(segment.end)}L${right.toFixed(3)},20`
    }
    return `${path}L1000,20Z`
  } catch {
    return null
  }
}
