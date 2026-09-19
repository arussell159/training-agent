import { DetailSheetRow } from "@/components/detail-sheet-row"
import { useIsMobile } from "@/hooks/use-mobile"
import { Section11Report } from "@/components/section11-report"
import {
  cachedTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"

export function WorkoutCoachButton({
  workout,
}: {
  workout: PlannedWorkout
}) {
  const mobile = useIsMobile()
  if (workout.id.startsWith("library:")) return null
  const completed = workout.status === "completed"
  const postWorkoutId = workout.activity_id
    ? `activity:${workout.activity_id}`
    : workout.id
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: cachedTrainingContext().athlete.time_zone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())

  if (mobile)
    return (
      <section className="contents" aria-label="Workout reports">
        {completed && (
          <DetailSheetRow
            title="Pre-workout report"
            date={workout.workout_date || workout.date}
            dark
            fullHeight
          >
            <Section11Report
              target={{ kind: "pre", workoutId: postWorkoutId }}
              savedOnly
              reader
            />
          </DetailSheetRow>
        )}
        <DetailSheetRow
          title={completed ? "Post-workout report" : "Pre-workout report"}
          date={workout.workout_date || workout.date}
          dark
          fullHeight
        >
          <Section11Report
            target={{
              kind: completed ? "post" : "pre",
              workoutId: completed ? postWorkoutId : workout.id,
            }}
            savedOnly={!completed && workout.workout_date !== today}
            reader
          />
        </DetailSheetRow>
      </section>
    )
  return (
    <section className="space-y-3 border-t pt-4" aria-label="Workout reports">
      {completed && (
        <Section11Report
          target={{ kind: "pre", workoutId: postWorkoutId }}
          savedOnly
        />
      )}
      <Section11Report
        target={{
          kind: completed ? "post" : "pre",
          workoutId: completed ? postWorkoutId : workout.id,
        }}
        savedOnly={!completed && workout.workout_date !== today}
      />
    </section>
  )
}
