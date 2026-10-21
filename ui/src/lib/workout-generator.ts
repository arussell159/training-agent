import { apiFetch } from "./api-client.ts"
import { withRequestDeadline } from "./request-deadline.ts"
import {
  validateWorkoutGeneratorInput,
  isWorkoutGeneratorResult,
  type WorkoutGeneratorInput,
  type WorkoutGeneratorResult,
} from "../../../app-backend/lib/workout-generator-model.mjs"

export type { WorkoutGeneratorInput, WorkoutGeneratorResult }
export function generatorProblem(input: WorkoutGeneratorInput): string {
  try {
    validateWorkoutGeneratorInput(input)
    return ""
  } catch (reason) {
    return reason instanceof Error
      ? reason.message
      : "Check the workout options."
  }
}

/** Generation returns a draft only; this client has no calendar write path. */
export function createWorkoutGeneratorClient(
  request: (path: string, options?: RequestInit) => Promise<Response> = apiFetch,
  timeoutMs = 90_000
) {
  return {
    generate: (input: WorkoutGeneratorInput, signal?: AbortSignal) => {
      const normalized = validateWorkoutGeneratorInput(input)
      return withRequestDeadline(
        async (requestSignal) => {
          const response = await request("/api/workouts/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(normalized),
            signal: requestSignal,
          })
          let result: unknown
          try {
            result = await response.json()
          } catch {
            requestSignal.throwIfAborted()
            throw Error(
              "The generated response could not be read. Your prompt is retained."
            )
          }
          requestSignal.throwIfAborted()
          if (!response.ok) {
            const message =
              result &&
              typeof result === "object" &&
              "error" in result &&
              typeof result.error === "string"
                ? result.error.slice(0, 1000)
                : "The workout could not be generated. Your prompt is retained."
            throw Error(message)
          }
          if (!isWorkoutGeneratorResult(result, normalized))
            throw Error(
              "The generated workout was incomplete or did not match your options. Your prompt is retained."
            )
          return result
        },
        timeoutMs,
        signal,
        "Workout generation took too long. Your prompt is retained; try again."
      )
    },
  }
}

export const workoutGeneratorClient = createWorkoutGeneratorClient()
