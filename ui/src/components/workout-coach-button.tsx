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
    <div className="space-y-3">
      {completed ? (
        <Section11Report target={{ kind: "post", workoutId: workout.id }} />
      ) : (
        <Section11Report
          target={{ kind: "pre", workoutId: workout.id }}
          savedOnly={workout.workout_date !== today}
        />
      )}
    </div>
  )
}
