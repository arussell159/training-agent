// Explicitly synthetic native recording catalog, membership and per-record curves.
import { createChartTagsService } from "../app-backend/lib/chart-tags.mjs";
import { createTaggedActivityCurvesService } from "../app-backend/lib/tagged-activity-curves.mjs";
import { normalizeAnalysis } from "../app-backend/lib/activity-analysis.mjs";
const kinds = ["heartRate", "power", "cadence", "velocity"],
  streams = {
    heartRate: "heartrate",
    power: "watts",
    cadence: "cadence",
    velocity: "velocity_smooth",
  };
export function createDesktopChartTagsFixtures({ today }) {
  const date = new Date(`${today}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const day = date.toISOString().slice(0, 10),
    requests = [];
  let scenario = "default";
  const catalogTags = ["Running", "Cycling", "Case,Comma", "Élite", "running"];
  const make = (id, type, tags, values, duration = 600, short = false) => {
    const activity = {
      id,
      type,
      name: `Synthetic native tagged ${type} source`,
      start_date_local: `${day}T07:00:00`,
      elapsed_time: duration,
      moving_time: duration,
      distance: duration * values.velocity,
      stream_types: ["time", ...Object.values(streams)],
      icu_sync_date: `${day}T08:00:00Z`,
    };
    if (tags !== undefined) activity.tags = tags;
    const axis =
      duration === 10 && !short
        ? [5, 10]
        : [5, 17, 60, 600].filter((seconds) => seconds <= duration || (short && seconds === 60));
    const curves = Object.fromEntries(
      kinds.map((kind) => {
        const samples = axis.map((seconds) =>
            seconds === 17 ? null : short && seconds > duration ? 999 : values[kind]
          ),
          curve = {
            id: `synthetic-${kind}-not-an-activity-id`,
            secs: axis,
            values: samples,
            start_index: axis.map(() => 0),
            end_index: [...axis],
          };
        if (kind !== "heartRate") {
          curve.stream_type = streams[kind];
          curve.after_kj = 0;
          curve.watts = [...samples];
        }
        return [kind, ["cadence", "velocity"].includes(kind) ? [curve] : curve];
      })
    );
    return {
      activity,
      values,
      curves,
      streams: [
        { type: "time", data: Array.from({ length: duration + 1 }, (_, i) => i) },
        {
          type: "distance",
          data: Array.from({ length: duration + 1 }, (_, i) => i * values.velocity),
        },
        ...kinds.map((kind) => ({
          type: streams[kind],
          data: Array(duration + 1).fill(values[kind]),
        })),
      ],
    };
  };
  const sources = [
    make("i760000001", "Ride", [], { heartRate: 240, power: 1000, cadence: 140, velocity: 40 }),
    make("i760000002", "Run", ["Running", "Case,Comma", "Élite"], {
      heartRate: 180,
      power: 300,
      cadence: 85,
      velocity: 5,
    }),
    make("i760000003", "Ride", ["Cycling"], {
      heartRate: 170,
      power: 400,
      cadence: 90,
      velocity: 10,
    }),
    make("i760000004", "Swim", ["Cycling", "Élite"], {
      heartRate: 190,
      power: 200,
      cadence: 60,
      velocity: 2,
    }),
    make("i760000005", "Run", undefined, {
      heartRate: 250,
      power: 1200,
      cadence: 160,
      velocity: 50,
    }),
    make("i760000006", "Run", null, { heartRate: 250, power: 1200, cadence: 160, velocity: 50 }),
    make("i760000007", "Run", "Running", {
      heartRate: 250,
      power: 1200,
      cadence: 160,
      velocity: 50,
    }),
    make("i760000008", "Run", ["Running"], {
      heartRate: 250,
      power: 1200,
      cadence: 160,
      velocity: 50,
    }),
    make(
      "i760000009",
      "Run",
      ["Running"],
      { heartRate: 200, power: 350, cadence: 95, velocity: 6 },
      10,
      true
    ),
    make("i760000010", "Walk", [], { heartRate: 0, power: 0, cadence: 0, velocity: 0 }),
    make("i760000011", "Walk", ["running"], { heartRate: 0, power: 0, cadence: 0, velocity: 0 }),
  ];
  Object.assign(sources[7].activity, {
    icu_ignore_hr: true,
    icu_ignore_power: true,
    ignore_pace: true,
    ignore_velocity: true,
    stream_types: ["time", "heartrate", "watts", "velocity_smooth"],
  });
  const cappedSources = Array.from({ length: 260 }, (_, index) =>
    make(
      `i77${String(index + 1).padStart(7, "0")}`,
      "Ride",
      index < 130 ? [] : ["Running"],
      {
        heartRate: index >= 258 ? 250 : 170,
        power: index >= 258 ? 999 : 300,
        cadence: index >= 258 ? 200 : 90,
        velocity: index >= 258 ? 99 : 12,
      },
      10
    )
  );
  const active = () => (scenario === "cap" ? cappedSources : sources);
  const nativeTags = () =>
    scenario === "empty"
      ? []
      : scenario === "removed"
        ? catalogTags.filter((tag) => tag !== "Running")
        : catalogTags;
  const find = (id) =>
    [...sources, ...cappedSources].find(
      (row) => row.activity.id === String(id).replace(/^activity:/, "")
    );
  const request = async (path, options = {}) => {
    if (options.method && options.method !== "GET")
      throw Error("Synthetic native chart tags are read-only.");
    requests.push(path);
    const url = new URL(path, "http://synthetic.invalid");
    if (url.pathname === "/athlete/0/activity-tags") return [...nativeTags()];
    if (url.pathname === "/athlete/0/activities")
      return structuredClone(
        active()
          .filter(
            () => day >= url.searchParams.get("oldest") && day <= url.searchParams.get("newest")
          )
          .map((row) => row.activity)
      );
    const match = /^\/activity\/([^/]+)\/(hr-curve|power-curve|power-curves)\.json$/.exec(
      url.pathname
    );
    if (!match) throw Error("Unexpected synthetic tagged native route.");
    const row = active().find((row) => row.activity.id === match[1]);
    if (!row) throw Error("Synthetic tagged native source missing.");
    const kind =
      match[2] === "hr-curve"
        ? "heartRate"
        : match[2] === "power-curve"
          ? "power"
          : url.searchParams.get("types") === "cadence"
            ? "cadence"
            : url.searchParams.get("types") === "velocity_smooth"
              ? "velocity"
              : null;
    if (!kind) throw Error("Unsupported synthetic tagged sensor.");
    return structuredClone(row.curves[kind]);
  };
  const now = () => Date.parse(`${today}T12:00:00Z`),
    catalog = createChartTagsService({ request: () => request, now }),
    service = createTaggedActivityCurvesService({ request: () => request, catalog, now });
  const config = {
      INTERVALS_API_KEY: "synthetic-native-chart-tags",
      SETTINGS_SCOPE: "synthetic-native-chart-tags",
    },
    actor = { id: "synthetic-native-tag-user", origin: "http://localhost" };
  return {
    catalog,
    service,
    config,
    actor,
    request,
    snapshot: () =>
      structuredClone({ today, day, scenario, catalog: nativeTags(), sources: active(), requests }),
    setScenario(value) {
      if (!["default", "cap", "empty", "removed"].includes(value))
        throw Object.assign(Error("Choose a synthetic chart-tag scenario."), { status: 400 });
      scenario = value;
      requests.length = 0;
      catalog.clear();
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
        activity_revision: "synthetic-native-chart-tags-v1",
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
