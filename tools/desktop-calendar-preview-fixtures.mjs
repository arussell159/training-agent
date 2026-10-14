// A disposable provider double for browser verification. No credentials, disk
// persistence, Supabase access, or live Intervals/Garmin connection.
import {
  fixtureEvent,
  parseTestWorkout,
} from "../app-backend/lib/fixtures/workout-editor-fixtures.mjs";
import {
  loadWorkoutEditor,
  loadNewWorkoutEditor,
  createWorkoutEditor,
  saveWorkoutEditor,
} from "../app-backend/lib/workout-editor.mjs";
import {
  createCalendarNote,
  loadCalendarNote,
  saveCalendarNote,
} from "../app-backend/lib/calendar-notes.mjs";
import {
  changeIntervalsEvent,
  moveIntervalsEvent,
  mapIntervalsWorkout,
} from "../app-backend/lib/intervals.mjs";
import { updateWorkoutDescription } from "../app-backend/lib/workout-description.mjs";
import { loadPlannedWorkoutMetrics, savePlannedWorkoutMetrics } from "../app-backend/lib/planned-workout-metrics.mjs";
import { appendWorkoutComment } from "../app-backend/lib/workout-comments.mjs";

export function createDesktopCalendarPreview(fixture) {
  const events = new Map(),
    activities = new Map();
  let nextId = 9000,
    revision = 1;
  let comments = [];
  const shift = (days) =>
    new Date(Date.parse(`${fixture.today}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
  const weekday = new Date(`${fixture.today}T12:00:00Z`).getUTCDay();
  const monday = shift(-((weekday + 6) % 7)),
    sunday = new Date(Date.parse(`${monday}T12:00:00Z`) + 6 * 86400000).toISOString().slice(0, 10);
  const weekDay = (offset) =>
    new Date(Date.parse(`${monday}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
  const add = (sport, date, name, actualMinutes) => {
    const event = {
      ...fixtureEvent(sport),
      id: nextId++,
      start_date_local: `${date}T00:00:00`,
      name,
      ...(sport === "Swim" ? { moving_time: 1800 } : {}),
    };
    if (actualMinutes != null) {
      const activity = {
        id: `i${event.id}`,
        type: sport,
        name,
        start_date_local: `${date}T07:00:00`,
        paired_event_id: event.id,
        moving_time: actualMinutes * 60,
        distance: 5000,
        icu_training_load: 40,
        file_type: "fit",
      };
      activities.set(activity.id, activity);
      event.paired_activity_id = activity.id;
    }
    events.set(event.id, event);
  };
  add("Ride", weekDay(0), "Completed bike — on target", 27);
  add("Swim", weekDay(1), "Completed swim — near target", 20);
  add("Run", fixture.today, "Completed run — short session", 5);
  add("Ride", shift(1), "Editable bike workout", null);
  events.set(nextId, {
    id: nextId++,
    category: "NOTE",
    name: "Training note",
    description: "Notes stay above this day's workouts.",
    start_date_local: `${shift(1)}T00:00:00`,
  });

  const request = async (path, options = {}) => {
    const url = new URL(path, "http://fake-provider.invalid");
    if (url.pathname === "/athlete/0") return { id: "synthetic", sportSettings: [] };
    if (url.pathname === "/athlete/0/events" && !options.method)
      return [...events.values()]
        .filter((event) => {
          const day = event.start_date_local.slice(0, 10);
          return day >= url.searchParams.get("oldest") && day <= url.searchParams.get("newest");
        })
        .map((event) => structuredClone(event));
    const body = options.body ? JSON.parse(options.body) : {};
    if (url.pathname === "/athlete/0/events" && options.method === "POST") {
      const event = {
        ...body,
        id: nextId++,
        ...(body.category === "WORKOUT" ? { workout_doc: parseTestWorkout(body.description) } : {}),
      };
      events.set(event.id, event);
      revision++;
      return structuredClone(event);
    }
    const activityId = url.pathname.match(/^\/activity\/(i\d+)$/)?.[1];
    const id = activityId || Number(url.pathname.split("/").at(-1));
    const source = activityId ? activities : events;
    const event = source.get(id);
    if (!event) throw Object.assign(new Error("Synthetic event not found."), { status: 404 });
    if (options.method === "DELETE") {
      source.delete(id);
      revision++;
      return null;
    }
    if (options.method === "PUT") {
      source.set(id, {
        ...event,
        ...body,
        updated: new Date().toISOString(),
        ...(body.description != null && event.category === "WORKOUT"
          ? { workout_doc: parseTestWorkout(body.description) }
          : {}),
      });
      revision++;
    }
    return structuredClone(source.get(id));
  };
  const context = (start, end, scope) => {
    const base = fixture.context(start, end, scope);
    const samples = [
      ...new Map(
        [...base.history, ...base.planned]
          .filter((item) => item.workout_date < monday || item.workout_date > sunday)
          .map((item) => [item.id, item])
      ).values(),
    ];
    const local = [...events.values()].map((event) =>
      mapIntervalsWorkout(event, fixture.today, activities.get(event.paired_activity_id) || null)
    );
    const sessions = [...samples, ...local].filter(
      (item) => !start || (item.workout_date >= start && item.workout_date <= end)
    );
    return {
      ...base,
      version: `synthetic-calendar-${revision}`,
      history: sessions.filter((item) => item.workout_date <= fixture.today),
      planned: sessions.filter((item) => item.workout_date >= fixture.today),
    };
  };
  const project = (result) => ({
    ...result,
    ...(result.event
      ? {
          workout: mapIntervalsWorkout(
            result.event,
            fixture.today,
            activities.get(result.event.paired_activity_id) || null
          ),
        }
      : {}),
    context: context(),
  });
  const canWrite = (api, method) =>
    method !== "GET" &&
    (/^workouts\/(editor|event(?::|%3A)\d+(?:\/(editor|copy|move|planned-values))?)$/.test(api) ||
      /^calendar\/notes(?:\/event(?::|%3A)\d+)?$/.test(api) ||
      ["calendar/day-actions", "calendar/workout-description", "comments"].includes(api));
  const handle = async (api, method, input, url) => {
    if (api === "comments") {
      if (method === "GET") return { comments: comments.filter(item => item.workout_id === url.searchParams.get("workoutId")) };
      const result = appendWorkoutComment(comments, input);
      comments = result.comments;
      return result.comment;
    }
    const metrics = api.match(/^workouts\/(event(?::|%3A)\d+)\/planned-values$/);
    if (metrics) {
      const id = decodeURIComponent(metrics[1]);
      return method === "GET" ? project(await loadPlannedWorkoutMetrics(request, id)) : project(await savePlannedWorkoutMetrics(request, id, input));
    }
    if (api === "workouts/new/editor")
      return loadNewWorkoutEditor(request, url.searchParams.get("date"), {
        sport: url.searchParams.get("sport") || "Ride",
        name: url.searchParams.get("name") || "New workout",
      });
    if (api === "workouts/editor" && method === "POST")
      return project(await createWorkoutEditor(request, input, "synthetic-calendar"));
    const editor = api.match(/^workouts\/(event(?::|%3A)\d+)\/editor$/);
    if (editor) {
      const id = decodeURIComponent(editor[1]);
      return method === "GET"
        ? loadWorkoutEditor(request, id)
        : project(await saveWorkoutEditor(request, id, input, "synthetic-calendar"));
    }
    if (api === "calendar/notes" && method === "POST")
      return project(await createCalendarNote(request, input, "synthetic-calendar"));
    const note = api.match(/^calendar\/notes\/(event(?::|%3A)\d+)$/);
    if (note) {
      const id = decodeURIComponent(note[1]);
      return method === "GET"
        ? loadCalendarNote(request, id)
        : project(await saveCalendarNote(request, id, input));
    }
    const action = api.match(/^workouts\/(event(?::|%3A)\d+)(?:\/(copy|move))?$/);
    if (action) {
      const id = decodeURIComponent(action[1]);
      return project(
        action[2] === "move"
          ? await moveIntervalsEvent(request, id, input.date)
          : await changeIntervalsEvent(request, id, action[2] || "delete", { date: input.date })
      );
    }
    if (api === "calendar/workout-description")
      return project(await updateWorkoutDescription(request, input.id, input.description));
    if (api === "calendar/day-actions") {
      const found = await request(`/athlete/0/events?oldest=${input.date}&newest=${input.date}`),
        results = [];
      for (const event of found)
        results.push(await changeIntervalsEvent(request, `event:${event.id}`, input.action));
      return { results, failures: [], total: found.length, context: context() };
    }
    return undefined;
  };
  return {
    canWrite,
    handle,
    context,
    get version() {
      return `synthetic-calendar-${revision}`;
    },
  };
}
