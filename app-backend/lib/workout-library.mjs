import { mapIntervalsWorkout } from "./intervals.mjs";

export async function readWorkoutLibrary(request) {
  const workouts = await request("/athlete/0/workouts");
  if (!Array.isArray(workouts))
    throw new Error("Intervals.icu returned an invalid workout library.");
  return workouts.map((item) => ({
    ...mapIntervalsWorkout(
      { ...item, category: "WORKOUT", start_date_local: "2000-01-01T00:00:00" },
      "1999-12-31"
    ),
    id: `library:${item.id}`,
    date: "Saved workout",
    workout_date: undefined,
    scheduled_start_at: undefined,
    recorded_start_local: undefined,
    day: "",
    status: "upcoming",
    editable: false,
  }));
}
