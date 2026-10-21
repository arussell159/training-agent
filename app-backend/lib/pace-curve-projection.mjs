import { validDate } from "./intervals.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const positive = (value) => nonnegative(value) && value > 0;
const date = (value) => {
  if (typeof value !== "string") return null;
  try {
    return validDate(value.slice(0, 10));
  } catch {
    return null;
  }
};
const unavailable = () => {
  throw Error("The recorded pace curve could not be verified.");
};
export const PACE_CURVE_ERROR =
  "Recorded pace history is unavailable or could not be verified. Existing personal bests remain available where confirmed.";

/** Native distance/elapsed samples only; never interpolate or substitute a nominal distance. */
export function projectPaceCurve(bundle, sport, window) {
  if (
    !["Run", "Swim"].includes(sport) ||
    !object(window) ||
    (window.oldest !== null && date(window.oldest) !== window.oldest) ||
    date(window.newest) !== window.newest ||
    (window.oldest !== null && window.oldest > window.newest)
  )
    unavailable();
  const result = {
    version: 1,
    sport,
    kind: "pace",
    unit: "m/s",
    source: "intervals-pace-curve",
    window: { oldest: window.oldest, newest: window.newest },
    points: [],
    warning: null,
  };
  if (!object(bundle) || !object(bundle.activities)) unavailable();
  if (bundle.curve === null) return result;
  const curve = bundle.curve;
  if (!object(curve) || (curve.type != null && curve.type !== "PACE")) unavailable();
  const token = window.oldest === null ? "all" : `r.${window.oldest}.${window.newest}`,
    sourceStart = date(curve.start_date_local),
    sourceEnd = date(curve.end_date_local);
  if (
    curve.id !== token &&
    !(window.oldest !== null && sourceStart === window.oldest && sourceEnd === window.newest)
  )
    unavailable();
  if (
    (curve.start_date_local != null &&
      (!sourceStart || (window.oldest !== null && sourceStart !== window.oldest))) ||
    (curve.end_date_local != null && (!sourceEnd || sourceEnd !== window.newest))
  )
    unavailable();
  const axis = curve.distance,
    values = curve.values;
  if (
    !Array.isArray(axis) ||
    !Array.isArray(values) ||
    axis.length > 10000 ||
    values.length !== axis.length ||
    axis.some(
      (distance, index) => !positive(distance) || (index > 0 && distance <= axis[index - 1])
    )
  )
    unavailable();
  for (const key of ["activity_id", "start_index", "end_index"])
    if (curve[key] != null && (!Array.isArray(curve[key]) || curve[key].length !== axis.length))
      unavailable();
  let partial = false;
  result.points = axis.map((distance, index) => {
    const rawId = curve.activity_id?.[index],
      id = typeof rawId === "string" && /^i?[1-9]\d{0,29}$/.test(rawId) ? rawId : null,
      activity = id && Object.hasOwn(bundle.activities, id) ? bundle.activities[id] : null,
      measuredDate = object(activity) ? date(activity.start_date_local) : null;
    const sourceValid =
      object(activity) &&
      id !== null &&
      (activity.id == null || String(activity.id) === id) &&
      (activity.type == null ||
        (typeof activity.type === "string" &&
          (sport === "Run" ? /run/i : /swim/i).test(activity.type))) &&
      measuredDate !== null &&
      (window.oldest === null || measuredDate >= window.oldest) &&
      measuredDate <= window.newest &&
      activity.ignore_pace !== true;
    const elapsed = values[index],
      recordingDuration =
        object(activity) && nonnegative(activity.elapsed_time)
          ? activity.elapsed_time
          : object(activity) && nonnegative(activity.moving_time)
            ? activity.moving_time
            : null;
    const known =
      sourceValid &&
      positive(elapsed) &&
      positive(distance / elapsed) &&
      (recordingDuration === null || recordingDuration >= elapsed) &&
      (!nonnegative(activity.distance) || activity.distance >= distance);
    if (!known) partial = true;
    const point = {
      distance_meters: distance,
      elapsed_seconds: known ? elapsed : null,
      value: known ? distance / elapsed : null,
      activity_id: id,
      date: sourceValid ? measuredDate : null,
      name: sourceValid && typeof activity.name === "string" ? activity.name.slice(0, 512) : null,
      estimated: false,
    };
    if (known && curve.start_index != null && curve.end_index != null) {
      const start = curve.start_index[index],
        end = curve.end_index[index];
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start) {
        point.start_index = start;
        point.end_index = end;
      } else partial = true;
    } else if ((curve.start_index != null) !== (curve.end_index != null)) partial = true;
    return point;
  });
  if (partial)
    result.warning =
      "Some exact pace samples or recording details could not be verified. Unavailable values remain unknown.";
  return result;
}
