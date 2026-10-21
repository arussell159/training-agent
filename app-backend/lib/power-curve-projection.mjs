import { validDate } from "./intervals.mjs";

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const nonnegative = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const date = (value) => {
  if (typeof value !== "string") return null;
  try {
    return validDate(value.slice(0, 10));
  } catch {
    return null;
  }
};
const unavailable = () => {
  throw Error("The recorded power curve could not be verified.");
};
export const POWER_CURVE_ERROR =
  "Recorded power history is unavailable or could not be verified. Existing personal bests remain available where confirmed.";

/** Exact provider samples only: no interpolation, sport conversion or inferred W/kg. */
export function projectPowerCurve(bundle, window) {
  if (
    !object(window) ||
    (window.oldest !== null && date(window.oldest) !== window.oldest) ||
    date(window.newest) !== window.newest ||
    (window.oldest !== null && window.oldest > window.newest)
  )
    unavailable();
  const result = {
    version: 1,
    sport: "Bike",
    kind: "power",
    unit: "watts",
    source: "intervals-power-curve",
    window: { oldest: window.oldest, newest: window.newest },
    points: [],
    warning: null,
  };
  if (!object(bundle) || !object(bundle.activities)) unavailable();
  if (bundle.curve === null) return result;
  const curve = bundle.curve;
  if (!object(curve)) unavailable();
  const token = window.oldest === null ? "all" : `r.${window.oldest}.${window.newest}`;
  const sourceStart = date(curve.start_date_local),
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
  const axis = curve.secs,
    values = curve.values ?? curve.watts;
  if (
    !Array.isArray(axis) ||
    !Array.isArray(values) ||
    axis.length > 10000 ||
    values.length !== axis.length ||
    axis.some(
      (seconds, index) =>
        !Number.isSafeInteger(seconds) || seconds < 1 || (index > 0 && seconds <= axis[index - 1])
    )
  )
    unavailable();
  for (const key of ["activity_id", "watts_per_kg", "wkg_activity_id", "start_index", "end_index"])
    if (curve[key] != null && (!Array.isArray(curve[key]) || curve[key].length !== axis.length))
      unavailable();
  let partial = false;
  result.points = axis.map((seconds, index) => {
    const rawId = curve.activity_id?.[index],
      id = typeof rawId === "string" && /^i?[1-9]\d{0,29}$/.test(rawId) ? rawId : null;
    const activity = id && Object.hasOwn(bundle.activities, id) ? bundle.activities[id] : null;
    const measuredDate = object(activity) ? date(activity.start_date_local) : null;
    const sourceValid =
      object(activity) &&
      id !== null &&
      (activity.id == null || String(activity.id) === id) &&
      (activity.type == null ||
        (typeof activity.type === "string" &&
          /ride|bike|cyclocross|handcycle|velomobile/i.test(activity.type))) &&
      measuredDate !== null &&
      (window.oldest === null || measuredDate >= window.oldest) &&
      measuredDate <= window.newest &&
      activity.icu_ignore_power !== true;
    const duration =
      object(activity) && nonnegative(activity.elapsed_time)
        ? activity.elapsed_time
        : object(activity) && nonnegative(activity.moving_time)
          ? activity.moving_time
          : null;
    const known =
      sourceValid && (duration === null || duration >= seconds) && nonnegative(values[index]);
    if (!known) partial = true;
    const point = {
      duration_seconds: seconds,
      value: known ? values[index] : null,
      activity_id: id,
      date: sourceValid ? measuredDate : null,
      name: sourceValid && typeof activity.name === "string" ? activity.name.slice(0, 512) : null,
      estimated: false,
    };
    if (known && nonnegative(curve.watts_per_kg?.[index]) && curve.wkg_activity_id?.[index] === id)
      point.watts_per_kg = curve.watts_per_kg[index];
    else if (curve.watts_per_kg?.[index] != null) partial = true;
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
      "Some exact power samples or recording details could not be verified. Unavailable values remain unknown.";
  return result;
}
