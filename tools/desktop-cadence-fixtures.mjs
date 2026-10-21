// Disposable synthetic native cadence provider. Every DTO passes the production service.
import { createCadenceCurveService } from "../app-backend/lib/cadence-curve.mjs";
import { CADENCE_GRID_SECONDS } from "../app-backend/lib/cadence-curve-model.mjs";
import { normalizeAnalysis } from "../app-backend/lib/activity-analysis.mjs";

export function createDesktopCadenceFixtures({ today }) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const day = date.toISOString().slice(0, 10);
  let scenario = "default";
  const requests = [];
  const make = (id, type, duration, rpm, mode = "normal") => {
    const activity = {
      id,
      type,
      name: `Synthetic exact ${type} cadence source`,
      start_date_local: `${day}T07:00:00`,
      elapsed_time: duration,
      moving_time: duration,
      distance: duration,
      stream_types: mode === "absent" ? ["time"] : ["time", "cadence"],
      icu_sync_date: `${day}T08:00:00Z`,
      icu_ignore_hr: type === "Run",
    };
    const seconds = [...CADENCE_GRID_SECONDS, 17]
      .sort((a, b) => a - b)
      .filter((value) => value <= duration || (mode === "short" && value === 60));
    const values = seconds.map((value) => (value === 17 ? null : rpm));
    const curve =
      mode === "missing"
        ? []
        : [
            {
              id: "cadence.synthetic-source-not-an-activity-id",
              stream_type: mode === "wrong" ? "watts" : "cadence",
              after_kj: 0,
              secs: seconds,
              values,
              watts: [...values],
              start_index: seconds.map(() => 0),
              end_index: [...seconds],
            },
          ];
    return {
      activity,
      rpm,
      mode,
      curve,
      streams: [
        { type: "time", data: Array.from({ length: duration + 1 }, (_, i) => i) },
        { type: "cadence", data: Array(duration + 1).fill(rpm) },
        { type: "distance", data: Array.from({ length: duration + 1 }, (_, i) => i) },
      ],
    };
  };
  const sources = [
    make("i720000001", "Ride", 5400, 100),
    make("i720000002", "Run", 600, 80.5),
    make("i720000003", "Other", 300, 110),
    make("i720000004", "Walk", 60, 0),
    make("i720000005", "Swim", 600, 50, "missing"),
    make("i720000006", "Rowing", 600, 60, "wrong"),
    make("i720000007", "WeightTraining", 10, 240, "short"),
    make("i720000008", "Hike", 60, 70, "absent"),
  ];
  const cappedSources = Array.from({ length: 130 }, (_, index) => {
    const row = make(
      `i73${String(index + 1).padStart(7, "0")}`,
      "Ride",
      10,
      index >= 128 ? 999 : 70 + index / 10
    );
    return row;
  });
  const active = () => (scenario === "cap" ? cappedSources : sources);
  const find = (id) =>
    [...sources, ...cappedSources].find(
      (row) => row.activity.id === String(id).replace(/^activity:/, "")
    );
  const request = async (path) => {
    requests.push(path);
    const url = new URL(path, "http://synthetic.invalid");
    if (url.pathname.endsWith("/activities"))
      return structuredClone(
        active()
          .filter(
            (row) => day >= url.searchParams.get("oldest") && day <= url.searchParams.get("newest")
          )
          .map((row) => row.activity)
      );
    const match = /^\/activity\/([^/]+)\/power-curves\.json$/.exec(url.pathname);
    if (
      !match ||
      url.searchParams.get("types") !== "cadence" ||
      url.searchParams.get("fatigue") !== "normal"
    )
      throw Error("Unexpected synthetic cadence request.");
    const row = active().find((row) => row.activity.id === match[1]);
    if (!row) throw Error("Synthetic cadence source unavailable.");
    return structuredClone(row.curve);
  };
  const service = createCadenceCurveService({
    request: () => request,
    now: () => Date.parse(`${today}T12:00:00Z`),
  });
  return {
    service,
    config: { INTERVALS_API_KEY: "synthetic-cadence-only", SETTINGS_SCOPE: "synthetic-cadence" },
    actor: { id: "synthetic-cadence-user", origin: "http://localhost", readOnly: false },
    snapshot: () =>
      structuredClone({
        today,
        day,
        scenario,
        axis: [...CADENCE_GRID_SECONDS, 17].sort((a, b) => a - b),
        sources: active(),
        requests,
      }),
    setScenario(value) {
      if (!["default", "cap"].includes(value))
        throw Object.assign(Error("Choose a synthetic cadence scenario."), { status: 400 });
      scenario = value;
      requests.length = 0;
      service.clear();
      return { scenario };
    },
    nativeActivity(id) {
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
    lookup(id) {
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
        activity_revision: "synthetic-exact-cadence-v1",
        workout_summary: {
          planned: null,
          completed: {
            duration_seconds: row.activity.elapsed_time,
            elapsed_time_seconds: row.activity.elapsed_time,
            distance_meters: row.activity.distance,
            tss: null,
          },
        },
      };
    },
    analysis(id) {
      const row = find(id);
      return row ? normalizeAnalysis(row.activity, row.streams) : null;
    },
  };
}
