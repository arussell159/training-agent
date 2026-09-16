// Independent, deliberately small provider double for editor contract tests.
// This is not production parsing code and does not claim to emulate devices.
export function parseTestWorkout(description) {
  const source = description.replace(/```[\s\S]*?```/g, "");
  const steps = [];
  let group = null;
  for (const line of source.split("\n")) {
    const text = line.trim();
    if (!text) {
      group = null;
      continue;
    }
    const repeat = text.match(/^(\d+)x$/);
    if (repeat) {
      group = { reps: Number(repeat[1]), steps: [] };
      steps.push(group);
      continue;
    }
    if (!text.startsWith("- ")) continue;
    const s = {},
      amount = text.match(/(?:^|\s)(\d+(?:\.\d+)?)(s|mtr|km|mi|y)\b/);
    if (!amount) throw Error("Fixture parser cannot read the end condition");
    const v = Number(amount[1]),
      u = amount[2];
    if (u === "s") s.duration = v;
    else s.distance = v * { mtr: 1, km: 1000, mi: 1609.344, y: 0.9144 }[u];
    const absolute = text.match(
      /(\d+):(\d{2})(?:-(\d+):(\d{2}))?\/(mi|km|100y|100m|500m|400m|250m) Pace/
    );
    const numeric = text.match(
      /(?:^|\s)(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?(w|bpm|%)(?:\s+(HR|LTHR|Pace))?\b/
    );
    const percent = text.match(
      /(?:^|\s)(\d+(?:\.\d+)?)(?:-(\d+(?:\.\d+)?))?%(?:\s+(HR|LTHR|Pace))?/
    );
    const zone = text.match(/\bZ(\d+)(?:-Z(\d+))?(?:\s+(HR|Pace))?/);
    if (absolute)
      s.pace = {
        units: `secs/${absolute[5]}`,
        ...(absolute[3]
          ? {
              start: Number(absolute[1]) * 60 + Number(absolute[2]),
              end: Number(absolute[3]) * 60 + Number(absolute[4]),
            }
          : { value: Number(absolute[1]) * 60 + Number(absolute[2]) }),
      };
    else if (zone) {
      const key = zone[3] === "HR" ? "hr" : zone[3] === "Pace" ? "pace" : "power";
      s[key] = {
        units: `${key}_zone`,
        ...(zone[2]
          ? { start: Number(zone[1]), end: Number(zone[2]) }
          : { value: Number(zone[1]) }),
      };
    } else if (numeric || percent) {
      const n = numeric || [null, percent[1], percent[2], "%", percent[3]];
      const key =
        n[3] === "bpm" || ["HR", "LTHR"].includes(n[4]) ? "hr" : n[4] === "Pace" ? "pace" : "power";
      s[key] = {
        units:
          n[3] === "%"
            ? n[4] === "HR"
              ? "%hr"
              : n[4] === "LTHR"
                ? "%lthr"
                : n[4] === "Pace"
                  ? "%pace"
                  : "%ftp"
            : n[3],
        ...(n[2] ? { start: Number(n[1]), end: Number(n[2]) } : { value: Number(n[1]) }),
      };
    }
    if (/\bramp\b/i.test(text)) s.ramp = true;
    if (/Press lap/i.test(text)) s.press_lap = true;
    s.intensity = text.match(/intensity=(\w+)/)?.[1] || "active";
    const cadence = text.match(/(\d+)(?:-(\d+))?rpm/);
    if (cadence)
      s.cadence = {
        units: "rpm",
        ...(cadence[2]
          ? { start: Number(cadence[1]), end: Number(cadence[2]) }
          : { value: Number(cadence[1]) }),
      };
    if (!s.duration && s.distance && s.pace?.units?.startsWith("secs/")) {
      const factor = { mi: 1609.344, km: 1000, "100y": 91.44, "100m": 100 }[s.pace.units.slice(5)];
      s.duration = (s.distance / factor) * (s.pace.value ?? (s.pace.start + s.pace.end) / 2);
    }
    (group ? group.steps : steps).push(s);
  }
  const sum = (nodes, key) =>
    nodes.reduce((n, s) => n + (s.steps ? s.reps * sum(s.steps, key) : s[key] || 0), 0);
  return {
    steps,
    duration: sum(steps, "duration"),
    distance: sum(steps, "distance"),
    options: {
      ...(source.match(/Pool length: (\S+)/)
        ? { pool_length: source.match(/Pool length: (\S+)/)[1] }
        : {}),
    },
  };
}
export function fixtureEvent(sport = "Ride") {
  const text =
    sport === "Ride"
      ? "- 600s ramp 100-180w intensity=warmup\n\n3x\n- 180s 200-220w 85-95rpm intensity=active\n- 60s 100w intensity=recovery\n\n- 300s ramp 150-90w intensity=cooldown"
      : sport === "Run"
        ? "- 300s 10:00/mi Pace intensity=warmup\n\n4x\n- 120s 7:30-8:00/mi Pace intensity=active\n- 60s 10:30/mi Pace intensity=recovery\n\n- 300s 10:00/mi Pace intensity=cooldown"
        : "Pool length: 25y\n\n- 200y Z1 Pace intensity=warmup\n\n4x\n- 100y Z3 Pace intensity=active\n- 20s intensity=rest\n\n- 100y Z1 Pace intensity=cooldown";
  return {
    id: 100,
    name: `${sport} custom title`,
    category: "WORKOUT",
    type: sport,
    start_date_local: "2026-10-10T06:30:00",
    end_date_local: "2026-10-10T08:00:00",
    description: `Coach: smooth and controlled.\n\n${text}`,
    workout_doc: parseTestWorkout(text),
    updated: "2026-09-16T12:00:00Z",
    calendar_id: 7,
    uid: "preserved-uid",
    external_id: "external-training-plan",
    color: "#abc123",
    paired_activity_id: null,
    icu_ftp: 250,
    custom_metadata: { keep: true },
  };
}
export function fakeProvider(initial, options = {}) {
  let current = structuredClone(initial);
  const calls = [];
  const createdEvents = new Map();
  return {
    calls,
    event: () => structuredClone(current),
    setEvent: (value) => {
      current = structuredClone(value);
    },
    request: async (path, request = {}) => {
      calls.push({ path, ...request });
      if (path === "/athlete/0")
        return {
          sportSettings: [
            {
              types: ["Ride", "VirtualRide"],
              ftp: 250,
              power_zones: [55, 75, 90, 105, 120, 150, 999],
            },
            {
              types: ["Run", "TrailRun"],
              threshold_pace: 1609.344 / 450,
              pace_zones: [80, 89, 95, 100, 999],
            },
            { types: ["Swim"], threshold_pace: 91.44 / 98, pace_zones: [81, 91.5, 95, 100, 999] },
          ],
        };
      if (path.startsWith("/athlete/0/events?"))
        return structuredClone([current, ...createdEvents.values()]);
      if (request.method === "POST") {
        if (path !== "/athlete/0/events") throw Error("Unexpected POST");
        const patch = JSON.parse(request.body);
        const created = {
          ...patch,
          id: 201 + createdEvents.size,
          workout_doc: parseTestWorkout(patch.description),
          updated: "2026-09-16T14:00:00Z",
        };
        createdEvents.set(created.id, created);
        if (options.uncertainCreate) throw Error("Connection lost after create");
        return structuredClone(created);
      }
      const createdId = Number(path.split("/").at(-1));
      if (createdEvents.has(createdId)) {
        if (request.method === "PUT") {
          const patch = JSON.parse(request.body);
          createdEvents.set(createdId, {
            ...createdEvents.get(createdId),
            ...patch,
            workout_doc: parseTestWorkout(patch.description),
          });
        }
        return structuredClone(createdEvents.get(createdId));
      }
      if (request.method) {
        if (request.method !== "PUT") throw Error("Only existing event updates are allowed");
        if (options.deny) throw Object.assign(Error("Forbidden"), { status: 403 });
        if (options.fail) throw Error("Offline");
        const patch = JSON.parse(request.body);
        current = {
          ...current,
          ...patch,
          workout_doc: parseTestWorkout(patch.description),
          updated: "2026-09-16T13:00:00Z",
        };
        options.corrupt?.(current);
        if (options.uncertain) throw Error("Connection lost after write");
      }
      return structuredClone(current);
    },
  };
}
