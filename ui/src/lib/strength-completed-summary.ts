import {
  isStrengthPrescription,
  strengthTotals,
  type StrengthPrescription,
} from "../../../app-backend/lib/workout-strength-model.mjs"
import type { PlannedWorkout, WorkoutSummaryValues } from "./training-context"
import { workoutPresentationSport } from "./workout-presentation.ts"

export type StrengthSummaryProvenance = {
  sessionRevision: number | null
  deviceScope: string
  resetVersion: number
}
export type StrengthRecordedSnapshot = StrengthSummaryProvenance & {
  workoutId: string
  activityId: string
  activityRevision: string
  values: WorkoutSummaryValues
}
export type StrengthSummaryRow = {
  key: string
  label: string
  planned: string
  completed: string
}

export function isCompletedStrengthWorkout(workout: PlannedWorkout): boolean {
  return (
    workout.status === "completed" &&
    /^(WeightTraining|Strength|Weights)$/i.test(
      workoutPresentationSport(workout)
    )
  )
}

const number = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null
const display = (value: number | null, digits = 0, minimumDigits = 0) =>
  value === null
    ? "--"
    : value.toLocaleString("en-US", {
        maximumFractionDigits: digits,
        minimumFractionDigits: minimumDigits,
      })
export function strengthSummaryDuration(value: unknown): string {
  const seconds = number(value)
  if (seconds === null) return "--"
  const rounded = Math.round(seconds)
  return [
    Math.floor(rounded / 3600),
    Math.floor((rounded % 3600) / 60),
    rounded % 60,
  ]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
}

export function strengthRecordedIdentity(workout: PlannedWorkout) {
  const candidate =
      workout.activity_id ||
      (workout.id.startsWith("activity:") ? workout.id.slice(9) : ""),
    revision = (workout as PlannedWorkout & { activity_revision?: unknown })
      .activity_revision
  return {
    workoutId: workout.id,
    activityId: /^(?:i\d+|\d+)$/.test(candidate) ? candidate : null,
    activityRevision: typeof revision === "string" ? revision : "",
  }
}

function exactPrescription(
  workout: PlannedWorkout
): StrengthPrescription | null {
  const model = workout.editor_model
  return model?.sport === "WeightTraining" &&
    Array.isArray(model.steps) &&
    model.steps.length === 0 &&
    !model.unstructured &&
    !model.variant &&
    isStrengthPrescription(model.strength)
    ? model.strength
    : null
}

function volumeText(prescription: StrengthPrescription): string {
  const totals = strengthTotals(prescription)
  if (!totals.volume) return "--"
  const units = new Set(
    prescription.blocks.flatMap((block) =>
      block.exercises.flatMap((exercise) =>
        exercise.parameters
          .filter((parameter) => parameter.kind === "weight")
          .map((parameter) => parameter.unit)
      )
    )
  )
  return (
    (["lb", "kg"] as const)
      .filter((unit) => units.has(unit))
      .map((unit) => `${display(totals.volume![unit], 1)} ${unit}`)
      .join(" / ") || "--"
  )
}

export function projectStrengthCompletedSummary(
  workout: PlannedWorkout,
  snapshot?: StrengthRecordedSnapshot | null,
  provenance?: StrengthSummaryProvenance,
  allowContextCompleted = true
) {
  const identity = strengthRecordedIdentity(workout),
    prescription = exactPrescription(workout),
    totals = prescription ? strengthTotals(prescription) : null,
    boundSnapshot =
      workout.status === "completed" &&
      identity.activityId &&
      snapshot?.workoutId === identity.workoutId &&
      snapshot.activityId === identity.activityId &&
      snapshot.activityRevision === identity.activityRevision &&
      provenance?.sessionRevision !== null &&
      provenance?.sessionRevision !== undefined &&
      snapshot.sessionRevision === provenance.sessionRevision &&
      snapshot.deviceScope === provenance.deviceScope &&
      snapshot.resetVersion === provenance.resetVersion
        ? snapshot.values
        : null,
    modern = workout.workout_summary != null,
    planned = workout.workout_summary?.planned,
    completed =
      boundSnapshot ||
      (allowContextCompleted ? workout.workout_summary?.completed : null),
    actualField = (key: "duration_seconds" | "tss" | "intensity_factor") => {
      if (workout.status !== "completed") return null
      if (!allowContextCompleted && !boundSnapshot) return null
      if (boundSnapshot || modern) return number(completed?.[key])
      if (key === "duration_seconds") {
        const minutes = number(
          workout.actualDurationMinutes ??
            workout.completed_data?.duration_minutes
        )
        return minutes === null ? null : minutes * 60
      }
      return key === "tss" ? number(workout.completed_data?.tss) : null
    },
    plannedField = (key: "duration_seconds" | "tss" | "intensity_factor") => {
      if (modern) return number(planned?.[key])
      // A provider-only recording has no planned prescription, even when an
      // older adapter put a zero in its generic planned-duration field.
      if (!/^event:[1-9]\d*$/.test(workout.id)) return null
      if (key === "duration_seconds") {
        const minutes = number(
          workout.plannedDurationMinutes ?? workout.planned?.duration_minutes
        )
        return minutes === null ? null : minutes * 60
      }
      return key === "tss" ? number(workout.planned?.tss) : null
    },
    rows: StrengthSummaryRow[] = [
      {
        key: "exercises",
        label: "Exercises",
        planned: display(totals?.exercises ?? null),
        completed: "--",
      },
      {
        key: "sets",
        label: "Sets",
        planned: display(totals?.sets ?? null),
        completed: "--",
      },
      {
        key: "reps",
        label: "Reps",
        planned: display(totals?.reps ?? null),
        completed: "--",
      },
      {
        key: "volume",
        label: "Volume",
        planned: prescription ? volumeText(prescription) : "--",
        completed: "--",
      },
      {
        key: "duration_seconds",
        label: "Duration",
        planned: strengthSummaryDuration(plannedField("duration_seconds")),
        completed: strengthSummaryDuration(actualField("duration_seconds")),
      },
      {
        key: "tss",
        label: "TSS",
        planned: display(plannedField("tss"), 1),
        completed: display(actualField("tss"), 1),
      },
      {
        key: "intensity_factor",
        label: "IF",
        planned: display(plannedField("intensity_factor"), 2, 2),
        completed: display(actualField("intensity_factor"), 2, 2),
      },
    ]
  return {
    identity,
    prescription,
    prescriptionUnavailable: Boolean(
      workout.editor_model?.strength && !prescription
    ),
    rows,
    actualSetResultsAvailable: false as const,
  }
}
