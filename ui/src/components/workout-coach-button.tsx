import { Section11Report } from "@/components/section11-report"
import {
  cachedTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"

export function WorkoutCoachButton({ workout }: { workout: PlannedWorkout }) {
  const completed = workout.status === "completed"
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: cachedTrainingContext().athlete.time_zone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  return (
    <section className="space-y-3 border-t pt-4" aria-label="Workout reports">
      {completed && (
        <Section11Report
          target={{ kind: "pre", workoutId: workout.id }}
          savedOnly
        />
      )}
      <Section11Report
        target={{
          kind: completed ? "post" : "pre",
          workoutId: workout.id,
        }}
        savedOnly={!completed && workout.workout_date !== today}
      />
    </section>
  )
}
