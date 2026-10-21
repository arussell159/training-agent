// Unfiltered native Power corpus. No tag catalog or membership request exists here.
import { createNativePowerCurveService } from "../app-backend/lib/native-power-curve.mjs";
import { NATIVE_POWER_GRID_SECONDS } from "../app-backend/lib/native-power-curve-model.mjs";
import { normalizeAnalysis } from "../app-backend/lib/activity-analysis.mjs";
export function createDesktopNativePowerFixtures({ today }) {
  const stamp = new Date(`${today}T12:00:00Z`);
  stamp.setUTCDate(stamp.getUTCDate() - 1);
  const day = stamp.toISOString().slice(0, 10),
    requests = [];
  let scenario = "default";
  const make = (id, type, duration, watts, mode = "normal") => {
    const activity = {
      id,
      type,
      name: `Synthetic unfiltered ${type} native power`,
      start_date_local: `${day}T07:00:00`,
      elapsed_time: duration,
      moving_time: duration,
      distance: duration * 4,
      stream_types: mode === "absent" ? ["time"] : ["time", "watts"],
      icu_sync_date: `${day}T08:00:00Z`,
    };
    const axis = [...NATIVE_POWER_GRID_SECONDS, 17]
      .sort((a, b) => a - b)
      .filter((value) => value <= duration || (mode === "short" && value === 60));
    const values = axis.map((seconds) =>
      seconds === 17 ? null : mode === "short" && seconds > duration ? 999 : watts
    );
    const curve = {
      id: "native-normal-power-not-a-recording-id",
      stream_type: mode === "wrong" ? "velocity_smooth" : "watts",
      after_kj: 0,
      secs: mode === "missing" ? [] : axis,
      values: mode === "missing" ? [] : values,
      watts: mode === "missing" ? [] : [...values],
      start_index: mode === "missing" ? [] : axis.map(() => 0),
      end_index: mode === "missing" ? [] : [...axis],
    };
    return {
      activity,
      watts,
      mode,
      curve,
      streams: [
        { type: "time", data: Array.from({ length: duration + 1 }, (_, i) => i) },
        { type: "watts", data: Array(duration + 1).fill(watts) },
        { type: "distance", data: Array.from({ length: duration + 1 }, (_, i) => i * 4) },
      ],
    };
  };
  const sources = [
    make("i780000001", "Ride", 5400, 300),
    make("i780000002", "Run", 600, 400),
    make("i780000003", "TrailRun", 120, 450),
    make("i780000004", "Swim", 600, 50, "absent"),
    make("i780000005", "Walk", 60, 0),
    make("i780000006", "Other", 600, 1000),
    make("i780000007", "Run", 10, 500, "short"),
    make("i780000008", "Workout", 600, 200),
    make("i780000009", "WeightTraining", 600, 150),
    make("i780000010", "Rowing", 600, 200, "missing"),
    make("i780000011", "Kayaking", 600, 200, "wrong"),
    make("i780000012", "Run", 600, 420),
  ];
  sources[5].activity.icu_ignore_power = true;
  delete sources[7].activity.elapsed_time;
  delete sources[7].activity.moving_time;
  delete sources[8].activity.stream_types;
  sources[11].activity.ignore_parts = [{ power: true, start_index: 0, end_index: 12 }];
  sources[11].curve.start_index[0] = 100;
  sources[11].curve.end_index[0] = 105;
  // Missing/malformed/empty tag metadata is intentionally irrelevant to unfiltered Power.
  sources[1].activity.tags = null;
  sources[2].activity.tags = "not-an-array";
  sources[0].activity.tags = [];
  const capped = Array.from({ length: 130 }, (_, index) =>
    make(
      `i79${String(index + 1).padStart(7, "0")}`,
      index % 2 ? "Run" : "Ride",
      10,
      index >= 128 ? 999 : 300
    )
  );
  const active = () => (scenario === "cap" ? capped : sources),
    find = (id) =>
      [...sources, ...capped].find(
        (row) => row.activity.id === String(id).replace(/^activity:/, "")
      );
  const request = async (path, options = {}) => {
    if (options.method && options.method !== "GET")
      throw Error("Unfiltered synthetic power is read-only.");
    requests.push(path);
    const url = new URL(path, "http://synthetic.invalid");
    if (url.pathname === "/athlete/0/activities")
      return structuredClone(
        active()
          .filter(
            () => day >= url.searchParams.get("oldest") && day <= url.searchParams.get("newest")
          )
          .map((row) => row.activity)
      );
    const match = /^\/activity\/([^/]+)\/power-curve\.json$/.exec(url.pathname);
    if (!match || url.search) throw Error("Unexpected unfiltered native power request.");
    const source = active().find((row) => row.activity.id === match[1]);
    if (!source) throw Error("Synthetic native power source unavailable.");
    return structuredClone(source.curve);
  };
  const config = {
      INTERVALS_API_KEY: "synthetic-unfiltered-native-power",
      SETTINGS_SCOPE: "synthetic-unfiltered-native-power",
    },
    actor = { id: "synthetic-unfiltered-native-power-user", origin: "http://localhost" },
    service = createNativePowerCurveService({
      request: () => request,
      now: () => Date.parse(`${today}T12:00:00Z`),
    });
  return {
    service,
    config,
    actor,
    request,
    snapshot: () => structuredClone({ today, day, scenario, sources: active(), requests }),
    setScenario(value) {
      if (!["default", "cap"].includes(value))
        throw Object.assign(Error("Choose a synthetic native power scenario."), { status: 400 });
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
      const duration = row.streams[0].data.at(-1);
      return {
        id: `activity:${row.activity.id}`,
        activity_id: row.activity.id,
        date: day,
        workout_date: day,
        sport: row.activity.type === "Ride" ? "Bike" : row.activity.type,
        title: row.activity.name,
        duration: `${Math.floor(duration / 60)}m ${duration % 60}s`,
        duration_seconds: duration,
        elapsed_time_seconds: duration,
        actualDurationMinutes: duration / 60,
        distance_meters: row.activity.distance,
        activity_type: row.activity.type,
        provider_type: row.activity.type,
        completed: true,
        status: "completed",
        read_only: true,
        activity_revision: "synthetic-unfiltered-native-power-v1",
        workout_summary: {
          planned: null,
          completed: {
            duration_seconds: duration,
            elapsed_time_seconds: duration,
            distance_meters: row.activity.distance,
            tss: null,
          },
        },
      };
    },
    analysis(id) {
      const row = find(id);
      return row
        ? normalizeAnalysis(
            {
              ...row.activity,
              elapsed_time: row.streams[0].data.at(-1),
              moving_time: row.streams[0].data.at(-1),
            },
            row.streams
          )
        : null;
    },
  };
}
