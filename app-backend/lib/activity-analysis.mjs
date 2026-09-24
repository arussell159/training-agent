import { dfaSignal } from "./dfa-signal.mjs";
import { recordedSwimYards } from "./swim-units.mjs";
import { gunzipSync } from "node:zlib";

function readFitMessages(buffer, wanted) {
  const b = buffer[0] === 31 && buffer[1] === 139 ? gunzipSync(buffer) : buffer;
  if (b.length < 14 || b.toString("ascii", 8, 12) !== ".FIT")
    throw new Error("Not a FIT recording");
  const defs = new Map(),
    messages = [];
  let p = b[0];
  const end = p + b.readUInt32LE(4);
  while (p < end) {
    const h = b[p++],
      compressed = !!(h & 128),
      local = compressed ? (h >> 5) & 3 : h & 15;
    if (!compressed && h & 64) {
      p++;
      const big = b[p++];
      const global = big ? b.readUInt16BE(p) : b.readUInt16LE(p);
      p += 2;
      const n = b[p++],
        fields = [];
      for (let i = 0; i < n; i++) {
        fields.push({ id: b[p], size: b[p + 1] });
        p += 3;
      }
      let extra = 0;
      if (h & 32) {
        const n = b[p++];
        for (let i = 0; i < n; i++) {
          extra += b[p + 1];
          p += 3;
        }
      }
      defs.set(local, { big, global, fields, extra });
    } else {
      const d = defs.get(local);
      if (!d) throw new Error("Invalid FIT definition");
      const v = {};
      for (const f of d.fields) {
        if (compressed && f.id === 253) continue;
        const val =
          f.size === 1
            ? b[p]
            : f.size === 2
              ? d.big
                ? b.readUInt16BE(p)
                : b.readUInt16LE(p)
              : f.size === 4
                ? d.big
                  ? b.readUInt32BE(p)
                  : b.readUInt32LE(p)
                : null;
        if (val !== null && val !== Math.pow(256, f.size) - 1) v[f.id] = val;
        p += f.size;
      }
      p += d.extra;
      if (wanted.has(d.global)) messages.push({ type: d.global, values: v });
    }
  }
  return messages;
}

export function readFitLaps(buffer) {
  return readFitMessages(buffer, new Set([19]))
    .map((message) => message.values)
    .filter((v) => v[2] != null && v[7] != null)
    .map((v) => ({
      timestamp: v[2],
      duration: v[7] / 1000,
      power: v[19] ?? null,
      heartRate: v[15] ?? null,
      distance: v[9] != null ? v[9] / 100 : null,
    }));
}

// Garmin FIT profile: session.pool_length is metres / 100; length type 1 is
// active, and total_timer_time is milliseconds of swimming, excluding pauses.
// https://github.com/garmin/fit-python-sdk/blob/main/garmin_fit_sdk/profile.py
export function readFitSwimLengths(buffer) {
  const messages = readFitMessages(buffer, new Set([18, 101]));
  const sessions = messages.filter((message) => message.type === 18 && message.values[44] > 0);
  return messages
    .filter((message) => message.type === 101)
    .flatMap(({ values: v }) => {
      if (v[12] !== 1 || v[2] == null || !((v[4] ?? v[3]) > 0)) return [];
      // Some exports stamp every message with the session start. Use elapsed
      // session duration for its bounds rather than that message timestamp.
      const session = sessions.find(
        ({ values: s }) =>
          s[2] != null && v[2] >= s[2] && v[2] < (s[7] > 0 ? s[2] + s[7] / 1000 : s[253])
      );
      if (!session) return [];
      return [
        {
          timestamp: v[2],
          duration: (v[4] ?? v[3]) / 1000,
          elapsedDuration: (v[3] ?? v[4]) / 1000,
          distance: session.values[44] / 100,
        },
      ];
    });
}

function activeTimeline(points, movingTime) {
  if (points.length < 2 || !(movingTime > 0))
    return { points, duration: points.at(-1)?.time || 0, at: (time) => time };
  const deltas = points
    .slice(1)
    .map((point, index) => point.time - points[index].time)
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((a, b) => a - b);
  if (!deltas.length) return { points, duration: points.at(-1)?.time || 0, at: (time) => time };
  const cadence = deltas[Math.floor(deltas.length / 2)];
  const maximumActiveGap = Math.max(1, cadence);
  const rawTimes = points.map((point) => point.time);
  const cumulative = [0];
  for (let index = 1; index < rawTimes.length; index += 1) {
    const elapsed = Math.max(0, rawTimes[index] - rawTimes[index - 1]);
    cumulative.push(cumulative.at(-1) + Math.min(elapsed, maximumActiveGap));
  }
  const accumulated = cumulative.at(-1);
  if (!(accumulated > 0)) return { points, duration: points.at(-1)?.time || 0, at: (time) => time };
  const scale = movingTime / accumulated;
  const activeTimes = cumulative.map((time) => time * scale);
  const at = (time) => {
    if (!Number.isFinite(time) || time <= rawTimes[0]) return 0;
    if (time >= rawTimes.at(-1)) return movingTime;
    let low = 0,
      high = rawTimes.length - 1;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (rawTimes[middle] <= time) low = middle;
      else high = middle;
    }
    const span = rawTimes[high] - rawTimes[low];
    const fraction = span > 0 ? (time - rawTimes[low]) / span : 0;
    return activeTimes[low] + (activeTimes[high] - activeTimes[low]) * fraction;
  };
  return {
    points: points.map((point, index) => ({ ...point, time: activeTimes[index] })),
    duration: movingTime,
    at,
  };
}

export function normalizeAnalysis(activity, streams, fitLaps = [], fitSwimLengths = []) {
  const byType = new Map(streams.map((s) => [s.type, s.data || []])),
    times = byType.get("time") || [];
  const location = streams.find((stream) => stream.type === "latlng");
  const numeric = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const coordinate = (i) =>
    Array.isArray(location?.data?.[i])
      ? location.data[i]
      : [location?.data?.[i], location?.data2?.[i]];
  const recordedPoints = times
    .map((time, i) => {
      const position = coordinate(i),
        latitude = numeric(position?.[0]),
        longitude = numeric(position?.[1]);
      return {
        time: numeric(time),
        dfaA1: numeric(byType.get("dfa_a1")?.[i]),
        dfaArtifacts:
          numeric(byType.get("artifacts")?.[i]) >= 0 ? numeric(byType.get("artifacts")?.[i]) : null,
        power: numeric(byType.get("watts")?.[i]),
        heartRate: numeric(byType.get("heartrate")?.[i]),
        cadence: numeric(byType.get("cadence")?.[i]),
        speed: numeric(byType.get("velocity_smooth")?.[i]),
        distance: numeric(byType.get("distance")?.[i]),
        elevation: numeric(byType.get("altitude")?.[i]),
        latitude: latitude != null && Math.abs(latitude) <= 85 ? latitude : null,
        longitude: longitude != null && Math.abs(longitude) <= 180 ? longitude : null,
      };
    })
    .filter((p) => p.time !== null);
  const timeline = activeTimeline(recordedPoints, numeric(activity.moving_time));
  const points = timeline.points;
  const epoch = Date.UTC(1989, 11, 31) / 1000,
    start = Date.parse(activity.start_date) / 1000 - epoch;
  const laps = fitLaps
    .filter((l) => Number.isFinite(start))
    .map((l, i) => ({
      id: `lap-${i}`,
      label: `Lap ${i + 1}`,
      start: timeline.at(Math.max(0, l.timestamp - start)),
      end: timeline.at(l.timestamp - start + l.duration),
      power: l.power,
      heartRate: l.heartRate,
      distance: l.distance,
      kind: "lap",
    }));
  const intervals = (activity.icu_intervals || [])
    .filter((l) => Number.isFinite(l.start_time) && Number.isFinite(l.end_time))
    .map((l, i) => ({
      id: `interval-${i}`,
      label: l.label || `${l.type === "WORK" ? "Work" : "Recovery"} ${i + 1}`,
      start: timeline.at(l.start_time),
      end: timeline.at(l.end_time),
      power: l.average_watts ?? null,
      heartRate: l.average_heartrate ?? null,
      distance: l.distance ?? null,
      kind: "interval",
    }));
  // FIT laps are the watch's recorded repeats with precise lap times. Prefer
  // them to Intervals' inferred WORK boundaries; retain WORK as a fallback.
  // Rest laps stay out of the pace chart and each swimming lap's pace.
  const swim = /swim/i.test(activity.type || "");
  const validIntervals = (activity.icu_intervals || []).filter(
    (l) => Number.isFinite(l.start_time) && Number.isFinite(l.end_time)
  );
  const workIntervals = intervals.filter(
    (l, i) => validIntervals[i].type === "WORK" && l.end > l.start
  );
  const swimLaps = laps.filter((l) => l.distance > 0 && l.end > l.start);
  const displayedLaps = swim
    ? (swimLaps.length ? swimLaps : workIntervals).map((l, i) => ({
        ...l,
        label:
          l.distance > 0
            ? `${Math.round(recordedSwimYards(l.distance))} yd · ${swimLaps.length ? l.label : `Interval ${i + 1}`}`
            : `Interval ${i + 1}`,
        speed: l.distance > 0 && l.end > l.start ? l.distance / (l.end - l.start) : null,
      }))
    : laps;
  return {
    version: 7,
    dfa: /ride|bike|cycl|run/i.test(activity.type || "") ? dfaSignal(points) : null,
    activityId: activity.id,
    points,
    laps: displayedLaps,
    swimLengths:
      swim && Number.isFinite(start)
        ? fitSwimLengths.map((length) => ({
            start: timeline.at(length.timestamp - start),
            end: timeline.at(length.timestamp - start + length.elapsedDuration),
            seconds: length.duration,
            distance: length.distance,
          }))
        : [],
    intervals,
    duration: timeline.duration,
  };
}
