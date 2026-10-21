// Disposable synthetic native velocity provider. Every DTO passes the production service.
import { createVelocityCurveService } from "../app-backend/lib/velocity-curve.mjs";
import { VELOCITY_GRID_SECONDS } from "../app-backend/lib/velocity-curve-model.mjs";
import { normalizeAnalysis } from "../app-backend/lib/activity-analysis.mjs";

export function createDesktopVelocityFixtures({ today }) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const day = date.toISOString().slice(0, 10);
  let scenario = "default";
  const requests = [];
  const make = (id, type, duration, speed, mode = "normal") => {
    const activity = {
      id,
      type,
      name: `Synthetic exact ${type} velocity source`,
      start_date_local: `${day}T07:00:00`,
      elapsed_time: duration,
      moving_time: duration,
      distance: duration * speed,
      stream_types: mode === "absent" ? ["time"] : ["time", "velocity_smooth"],
      icu_sync_date: `${day}T08:00:00Z`,
      icu_ignore_hr: type === "Run",
    };
    const seconds = [...VELOCITY_GRID_SECONDS, 17]
      .sort((a, b) => a - b)
      .filter((value) => value <= duration || (mode === "short" && value === 60));
    const values = seconds.map((value) => (value === 17 ? null : speed));
    const curve =
      mode === "missing"
        ? []
        : [
            {
              id: "velocity.synthetic-source-not-an-activity-id",
              stream_type: mode === "wrong" ? "watts" : "velocity_smooth",
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
      speed,
      mode,
      curve,
      streams: [
        { type: "time", data: Array.from({ length: duration + 1 }, (_, i) => i) },
        { type: "velocity_smooth", data: Array(duration + 1).fill(speed) },
        { type: "distance", data: Array.from({ length: duration + 1 }, (_, i) => i * speed) },
      ],
    };
  };
  const sources = [
    make("i740000001", "Ride", 5400, 12),
    make("i740000002", "Run", 600, 4),
    make("i740000003", "Swim", 1800, 1),
    make("i740000004", "Walk", 60, 0),
    make("i740000005", "Workout", 600, 5, "missing"),
    make("i740000006", "Rowing", 600, 6, "wrong"),
    make("i740000007", "WeightTraining", 10, 25, "short"),
    make("i740000008", "Hike", 60, 7, "absent"),
    make("i740000009", "Other", 300, 50),
    make("i740000010", "Run", 600, 40),
    make("i740000011", "Run", 600, 8),
  ];
  sources[8].activity.ignore_pace = true;
  sources[9].activity.ignore_velocity = true;
  sources[10].activity.ignore_parts = [{ start_index: 0, end_index: 12, pace: true }];
  sources[10].curve[0].start_index[0] = 100;
  sources[10].curve[0].end_index[0] = 105;
  const cappedSources = Array.from({ length: 130 }, (_, index) => {
    const row = make(
      `i75${String(index + 1).padStart(7, "0")}`,
      "Ride",
      10,
      index >= 128 ? 999 : 10 + (index % 3)
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
      url.searchParams.get("types") !== "velocity_smooth" ||
      url.searchParams.get("fatigue") !== "normal"
    )
      throw Error("Unexpected synthetic velocity request.");
    const row = active().find((row) => row.activity.id === match[1]);
    if (!row) throw Error("Synthetic velocity source unavailable.");
    return structuredClone(row.curve);
  };
  const service = createVelocityCurveService({
    request: () => request,
    now: () => Date.parse(`${today}T12:00:00Z`),
  });
  return {
    service,
    config: { INTERVALS_API_KEY: "synthetic-velocity-only", SETTINGS_SCOPE: "synthetic-velocity" },
    actor: { id: "synthetic-velocity-user", origin: "http://localhost", readOnly: false },
    snapshot: () =>
      structuredClone({
        today,
        day,
        scenario,
        axis: [...VELOCITY_GRID_SECONDS, 17].sort((a, b) => a - b),
        sources: active(),
        requests,
      }),
    setScenario(value) {
      if (!["default", "cap"].includes(value))
        throw Object.assign(Error("Choose a synthetic velocity scenario."), { status: 400 });
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
        activity_revision: "synthetic-exact-velocity-v1",
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
