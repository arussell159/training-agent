// Disposable synthetic native HR provider, pure recorded streams and oracle.
import { createHeartRateCurveService } from "../app-backend/lib/heart-rate-curve.mjs";
import { normalizeAnalysis, recordedEffortBounds } from "../app-backend/lib/activity-analysis.mjs";
import { heartRateSportMatches } from "../app-backend/lib/heart-rate-curve-model.mjs";
export function createDesktopHeartRateFixtures({ today }) {
  const specs = [
    ["i710000001", "Run", 600, 180],
    ["i710000002", "Ride", 120, 200],
    ["i710000003", "Swim", 600, 150],
    ["i710000004", "Other", 300, 210],
    ["i710000005", "Workout", 600, 250, true],
    ["i710000006", "WeightTraining", 10, 240],
    ["i710000007", "Walk", 60, 0],
  ];
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const day = date.toISOString().slice(0, 10),
    axis = [5, 60, 120, 180, 300, 600];
  const sources = specs.map(([id, type, duration, bpm, ignored]) => ({
    activity: {
      id,
      type,
      name: `Synthetic exact ${type} heart-rate source`,
      start_date_local: `${day}T07:00:00`,
      elapsed_time: duration,
      moving_time: duration,
      distance: duration,
      icu_ignore_hr: ignored === true,
    },
    streams: [
      { type: "time", data: Array.from({ length: duration + 1 }, (_, i) => i) },
      { type: "heartrate", data: Array(duration + 1).fill(bpm) },
      { type: "distance", data: Array.from({ length: duration + 1 }, (_, i) => i) },
    ],
    bpm,
  }));
  const find = (id) =>
    sources.find((row) => row.activity.id === String(id).replace(/^activity:/, ""));
  const request = async (path) => {
    const url = new URL(path, "http://synthetic.invalid");
    if (url.pathname.endsWith("/activities"))
      return structuredClone(
        sources
          .filter(
            (row) => day >= url.searchParams.get("oldest") && day <= url.searchParams.get("newest")
          )
          .map((row) => row.activity)
      );
    if (!url.pathname.endsWith("/hr-curves.json")) throw Error("Unexpected synthetic HR request.");
    const selected = url.searchParams.get("type") || "all",
      token = url.searchParams.get("curves"),
      [, start, end] = token.split(".");
    if (day < start || day > end) return { list: [], activities: {} };
    const candidates = sources.filter((row) => heartRateSportMatches(row.activity.type, selected));
    if (!candidates.length) return { list: [], activities: {} };
    const winners = axis.map((seconds) => {
      if (selected === "all" && seconds === 120) return find("i710000005");
      if (selected === "all" && seconds === 180) return find("i710000006");
      return (
        candidates
          .filter((row) => !row.activity.icu_ignore_hr && row.activity.elapsed_time >= seconds)
          .sort((a, b) => b.bpm - a.bpm)[0] || null
      );
    });
    return {
      list: [
        {
          id: token,
          start_date_local: start,
          end_date_local: end,
          secs: [...axis],
          values: winners.map((row) => row?.bpm ?? null),
          activity_id: winners.map((row) => row?.activity.id ?? null),
          start_index: winners.map((row) => (row ? 0 : null)),
          end_index: winners.map((row, i) => (row ? axis[i] : null)),
        },
      ],
      activities: Object.fromEntries(
        sources.map((row) => [
          row.activity.id,
          {
            id: row.activity.id,
            start_date_local: row.activity.start_date_local,
            name: row.activity.name,
          },
        ])
      ),
    };
  };
  const service = createHeartRateCurveService({
    request: () => request,
    now: () => Date.parse(`${today}T12:00:00Z`),
  });
  const lookup = (id) => {
    const row = find(id);
    if (!row) return undefined;
    return {
      id: `activity:${row.activity.id}`,
      activity_id: row.activity.id,
      date: day,
      workout_date: day,
      sport: row.activity.type === "Ride" ? "Bike" : row.activity.type,
      title: row.activity.name,
      duration: `${Math.floor(row.activity.elapsed_time / 60)}m ${row.activity.elapsed_time % 60}s`,
      duration_seconds: row.activity.elapsed_time,
      elapsed_time_seconds: row.activity.elapsed_time,
      actualDurationMinutes: row.activity.elapsed_time / 60,
      distance_meters: row.activity.distance,
      activity_type: row.activity.type,
      provider_type: row.activity.type,
      completed: true,
      status: "completed",
      read_only: true,
      activity_revision: "synthetic-exact-hr-v1",
      workout_summary: {
        planned: null,
        completed: {
          duration_seconds: row.activity.elapsed_time,
          elapsed_time_seconds: row.activity.elapsed_time,
          distance_meters: row.activity.distance,
          average_heartrate: row.bpm,
          tss: null,
        },
      },
    };
  };
  const analysis = (id) => {
    const row = find(id);
    return row ? normalizeAnalysis(row.activity, row.streams) : null;
  };
  const effort = (id, seconds) => {
    const row = find(id),
      base = {
        available: false,
        activity_id: id,
        kind: "heartRate",
        source: "synthetic-local-preview",
      };
    if (!row) return null;
    if (
      row.activity.icu_ignore_hr ||
      !axis.includes(seconds) ||
      seconds > row.activity.elapsed_time
    )
      return { ...base, reason: "Exact eligible raw HR source samples are unavailable." };
    const bounds = recordedEffortBounds(row.activity, row.streams, 0, seconds);
    return bounds
      ? { ...base, available: true, value: row.bpm, duration_seconds: seconds, ...bounds }
      : { ...base, reason: "Exact raw HR source sample bounds are unavailable." };
  };
  return {
    service,
    lookup,
    analysis,
    effort,
    snapshot: () => structuredClone({ today, axis, sources }),
    config: { INTERVALS_API_KEY: "synthetic-hr-only", SETTINGS_SCOPE: "synthetic-hr" },
    actor: { id: "synthetic-hr-user", origin: "http://localhost", readOnly: false },
    nativeActivity: (id) => {
      const row = find(id);
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
