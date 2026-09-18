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

// Serialize calls in this process; source tags reconcile retries across restarts.
let pending = Promise.resolve();
export function saveLibraryWorkout(request, event) {
  const run = pending
    .catch(() => {})
    .then(async () => {
      const tag = `training-agent-event-${event.id}`;
      const find = async () => {
        const matches = (await request("/athlete/0/workouts")).filter((w) => w.tags?.includes(tag));
        if (matches.length > 1)
          throw new Error("Multiple library copies found; no workout was changed.");
        return matches[0];
      };
      let saved = await find();
      if (saved) {
        const current = await request(`/athlete/0/workouts/${saved.id}`);
        if (
          current.name === event.name &&
          current.description === event.description &&
          current.type === event.type
        )
          return current;
        let failure;
        try {
          await request(`/athlete/0/workouts/${saved.id}`, {
            method: "PUT",
            body: JSON.stringify({
              name: event.name,
              type: event.type,
              description: event.description,
            }),
          });
        } catch (error) {
          failure = error;
        }
        const updated = await request(`/athlete/0/workouts/${saved.id}`);
        if (
          updated.name !== event.name ||
          updated.description !== event.description ||
          updated.type !== event.type
        )
          throw failure || new Error("Library update could not be verified.");
        return updated;
      }
      const folders = await request("/athlete/0/folders");
      let folder = folders.find((f) => f.name === "AR Performance" && f.type === "FOLDER");
      if (!folder)
        folder = await request("/athlete/0/folders", {
          method: "POST",
          body: JSON.stringify({ name: "AR Performance", type: "FOLDER", visibility: "PRIVATE" }),
        });
      try {
        saved = await request("/athlete/0/workouts", {
          method: "POST",
          body: JSON.stringify({
            folder_id: folder.id,
            name: event.name,
            type: event.type,
            description: event.description,
            tags: [tag],
          }),
        });
      } catch (error) {
        saved = await find();
        if (!saved) throw error;
      }
      const verified = await request(`/athlete/0/workouts/${saved.id}`);
      if (
        verified.name !== event.name ||
        verified.description !== event.description ||
        verified.type !== event.type
      )
        throw new Error("Library save could not be verified. Refresh the library before retrying.");
      return verified;
    });
  pending = run;
  return run;
}
