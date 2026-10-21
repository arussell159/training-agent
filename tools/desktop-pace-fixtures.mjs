// Isolated synthetic recordings. Production pure projections only; no provider I/O.
import { projectPaceCurve } from "../app-backend/lib/pace-curve-projection.mjs";
import { normalizeAnalysis, recordedEffortBounds } from "../app-backend/lib/activity-analysis.mjs";

export function createDesktopPaceSources({ today, dateShift }) {
  const sources = [
    {
      id: "i700000001",
      type: "Run",
      offset: -1,
      speed: 4,
      seconds: 400,
      anchors: [800, 1000, 1600],
    },
    { id: "i700000002", type: "Swim", offset: -2, speed: 1, seconds: 400, anchors: [100, 200] },
    {
      id: "i700000011",
      type: "Run",
      offset: -1,
      speed: 5,
      seconds: 400,
      anchors: [1100],
      ignored: true,
    },
    {
      id: "i700000012",
      type: "Run",
      offset: -1,
      speed: 4,
      seconds: 100,
      anchors: [1200],
      short: true,
    },
    {
      id: "i700000021",
      type: "Swim",
      offset: -2,
      speed: 1,
      seconds: 400,
      anchors: [150],
      ignored: true,
    },
    {
      id: "i700000022",
      type: "Swim",
      offset: -2,
      speed: 1,
      seconds: 100,
      anchors: [300],
      short: true,
    },
  ].map((spec) => {
    const times = Array.from({ length: spec.seconds + 1 }, (_, i) => i),
      date = dateShift(today, spec.offset),
      activity = {
        id: spec.id,
        type: spec.type,
        name: `Synthetic exact ${spec.type.toLowerCase()} pace${spec.ignored ? " ignored" : spec.short ? " too short" : ""}`,
        start_date_local: `${date}T07:00:00`,
        moving_time: spec.seconds,
        elapsed_time: spec.seconds,
        distance: spec.seconds * spec.speed,
        ignore_pace: spec.ignored === true,
      },
      streams = [
        { type: "time", data: times },
        { type: "distance", data: times.map((time) => time * spec.speed) },
        { type: "velocity_smooth", data: times.map(() => spec.speed) },
      ],
      curve = {
        distance: spec.anchors,
        values: spec.anchors.map((distance) => distance / spec.speed),
        activity_id: spec.anchors.map(() => spec.id),
        start_index: spec.anchors.map(() => 0),
        end_index: spec.anchors.map((distance) => distance / spec.speed),
      };
    return { activity, streams, curve, eligible: !spec.ignored && !spec.short };
  });
  const source = (id) =>
    sources.find((row) => row.activity.id === String(id).replace(/^activity:/, ""));
  const records = sources.map(({ activity }) => ({
    id: activity.id,
    date: activity.start_date_local.slice(0, 10),
    sport: activity.type,
    name: activity.name,
    distance_meters: activity.distance,
    duration_seconds: activity.elapsed_time,
    elevation_meters: null,
    achievements: [],
  }));
  function lookup(id) {
    const found = source(id);
    if (!found) return undefined;
    const row = records.find((row) => row.id === found.activity.id);
    return {
      id: `activity:${row.id}`,
      activity_id: row.id,
      date: row.date,
      workout_date: row.date,
      sport: row.sport,
      title: row.name,
      duration: `${Math.floor(row.duration_seconds / 60)}m ${row.duration_seconds % 60}s`,
      duration_seconds: row.duration_seconds,
      elapsed_time_seconds: row.duration_seconds,
      actualDurationMinutes: row.duration_seconds / 60,
      distance_meters: row.distance_meters,
      activity_type: row.sport,
      provider_type: row.sport,
      completed: true,
      status: "completed",
      read_only: true,
      activity_revision: "synthetic-exact-pace-v1",
      recorded_start_local: found.activity.start_date_local,
      workout_summary: {
        planned: null,
        completed: {
          duration_seconds: row.duration_seconds,
          elapsed_time_seconds: row.duration_seconds,
          distance_meters: row.distance_meters,
          average_speed: found.activity.distance / found.activity.elapsed_time,
          tss: null,
        },
      },
    };
  }
  const analysis = (id) => {
    const found = source(id);
    return found ? normalizeAnalysis(found.activity, found.streams) : null;
  };
  function project(sport, window, samples, inventory) {
    const values = new Map(
      samples.map(([distance, elapsed]) => {
        const row = inventory.findLast(
          (row) =>
            row.sport === sport &&
            (!window.oldest || row.date >= window.oldest) &&
            row.date <= window.newest &&
            row.distance_meters >= distance &&
            row.duration_seconds >= elapsed
        );
        return [distance, { elapsed, id: row?.id || null }];
      })
    );
    for (const row of sources.filter((row) => row.activity.type === sport))
      row.curve.distance.forEach((distance, index) =>
        values.set(distance, {
          elapsed: row.curve.values[index],
          id: row.activity.id,
          start: row.curve.start_index[index],
          end: row.curve.end_index[index],
        })
      );
    const sorted = [...values].sort(([a], [b]) => a - b),
      activities = Object.fromEntries(
        inventory.map((row) => [
          row.id,
          {
            id: row.id,
            type: row.sport,
            start_date_local: `${row.date}T07:00:00`,
            name: row.name,
            elapsed_time: row.duration_seconds,
            distance: row.distance_meters,
          },
        ])
      );
    for (const row of sources) activities[row.activity.id] = row.activity;
    return projectPaceCurve(
      {
        activities,
        curve: {
          id: window.oldest === null ? "all" : `r.${window.oldest}.${window.newest}`,
          type: "PACE",
          distance: sorted.map(([distance]) => distance),
          values: sorted.map(([, row]) => row.elapsed),
          activity_id: sorted.map(([, row]) => row.id),
          start_index: sorted.map(([, row]) => row.start ?? null),
          end_index: sorted.map(([, row]) => row.end ?? null),
        },
      },
      sport,
      window
    );
  }
  function effort(id, type, distance) {
    const row = source(id),
      base = { available: false, activity_id: id, type, source: "synthetic-local-preview" };
    if (!row) return null;
    const index = row.curve.distance.indexOf(distance);
    if (type !== row.activity.type || index < 0 || !row.eligible)
      return { ...base, reason: "The exact native pace source is unavailable or excluded." };
    const start = row.curve.start_index[index],
      end = row.curve.end_index[index],
      times = row.streams.find((stream) => stream.type === "time").data,
      distances = row.streams.find((stream) => stream.type === "distance").data,
      bounds = recordedEffortBounds(row.activity, row.streams, start, end);
    if (
      !bounds ||
      times[end] - times[start] !== row.curve.values[index] ||
      distances[end] - distances[start] !== distance
    )
      return { ...base, reason: "Exact raw pace source samples could not be verified." };
    return {
      ...base,
      available: true,
      value: distance / row.curve.values[index],
      duration_seconds: null,
      distance_meters: distance,
      ...bounds,
    };
  }
  return {
    records,
    lookup,
    analysis,
    project,
    effort,
    snapshot: () => structuredClone({ today, sources }),
    nativeActivity: (id) => {
      const row = source(id);
      return row
        ? {
            ...structuredClone(row.activity),
            description: "",
            read_only: true,
            athlete_cannot_edit: true,
          }
        : null;
    },
  };
}
