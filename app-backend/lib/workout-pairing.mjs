import { athleteLocalDate } from "./athlete-date.mjs";
import { eventId, mapIntervalsWorkout } from "./intervals.mjs";
import { preserveRecordedWorkout } from "./workout-recording-merge.mjs";

// Hold the plan as well as the recording so an app move/delete cannot race a
// link. All pairings acquire the plan first, then the activity.
export function pairClaimedIntervalsWorkout(write, plannedId, completedId) {
  return write(plannedId, () =>
    write(completedId, (request) => pairIntervalsWorkout(request, plannedId, completedId))
  );
}

export async function pairIntervalsWorkout(request, plannedId, completedId) {
  const planned = eventId(plannedId);
  const completed = String(completedId || "").replace(/^activity:/i, "");
  if (!/^i?[1-9]\d*$/.test(completed))
    throw Object.assign(Error("Choose a completed Intervals.icu workout."), { status: 400 });
  const eventPath = `/athlete/0/events/${planned}`;
  const activityPath = `/activity/${completed}`;
  const [event, original] = await Promise.all([request(eventPath), request(activityPath)]);
  if (String(event?.id) !== planned || event.category !== "WORKOUT")
    throw Object.assign(Error("The planned workout could not be found."), { status: 404 });
  if (String(original?.id) !== completed || !original.type || !original.start_date_local)
    throw Object.assign(Error("The completed workout could not be found."), { status: 404 });
  const discipline = (value) =>
    /Ride|Bike/i.test(value || "")
      ? "Bike"
      : /Run/i.test(value || "")
        ? "Run"
        : /Swim/i.test(value || "")
          ? "Swim"
          : /Weight|Strength/i.test(value || "")
            ? "Strength"
            : value || "Other";
  if (discipline(event.type) !== discipline(original.type))
    throw Object.assign(Error("Only workouts in the same sport can be combined."), { status: 400 });
  if (event.paired_activity_id != null && String(event.paired_activity_id) !== completed)
    throw Object.assign(
      Error("This planned workout is already combined with another completed workout."),
      { status: 409 }
    );
  if (original.paired_event_id != null && String(original.paired_event_id) !== planned)
    throw Object.assign(
      Error("This completed workout is already combined with another planned workout."),
      { status: 409 }
    );
  if (String(original.paired_event_id) !== planned) {
    try {
      await request(activityPath, {
        method: "PUT",
        body: JSON.stringify({ paired_event_id: Number(planned) }),
      });
    } catch (error) {
      if (error.status >= 400 && error.status < 500) throw error;
      // A lost reply must be checked without replaying the pairing write.
    }
  }
  const activity = await request(activityPath);
  if (String(activity?.id) !== completed || String(activity?.paired_event_id) !== planned)
    throw Object.assign(
      Error("Intervals.icu did not confirm the workout pairing. Refresh before retrying."),
      { status: 502 }
    );
  return { plannedId: `event:${planned}`, completedId: `activity:${completed}`, event, activity };
}

// Use the verified activity itself, rather than waiting for its list endpoint
// to catch up. Keep existing plan drafts and remove only its standalone alias.
export function pairedWorkoutContext(
  context,
  { plannedId, completedId, event, activity },
  now = new Date()
) {
  const today = athleteLocalDate(now, context.athlete?.time_zone || "America/Chicago");
  const rows = new Map(
    [...(context.history || []), ...(context.planned || [])].map((w) => [String(w.id), w])
  );
  const provider = mapIntervalsWorkout(
    event,
    today,
    activity,
    false,
    context.athlete?.sport_settings || []
  );
  const current = rows.get(plannedId);
  const paired =
    current && ["pending", "failed"].includes(current.sync_status)
      ? preserveRecordedWorkout(current, provider)
      : provider;
  rows.delete(completedId);
  rows.set(plannedId, paired);
  const sessions = [...rows.values()].sort((a, b) => a.workout_date.localeCompare(b.workout_date));
  return {
    ...context,
    history: sessions.filter((w) => w.workout_date <= today),
    planned: sessions.filter((w) => w.workout_date >= today),
  };
}
