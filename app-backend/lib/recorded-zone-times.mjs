const finite = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
const bounds = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 100 &&
  value.every((n, i) => finite(n) && n > 0 && (!i || n > value[i - 1]));

export function validRecordedZoneTimes(value) {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    ["power", "speed", "gap-speed"].includes(value.basis) &&
    value.unit === (value.basis === "power" ? "%ftp" : "%threshold-speed") &&
    bounds(value.boundaries_percent) &&
    Array.isArray(value.seconds) &&
    value.seconds.length === value.boundaries_percent.length &&
    value.seconds.every(finite) &&
    (value.threshold === null || (finite(value.threshold) && value.threshold > 0))
  );
}

/** Native source seconds, not recalculated from streams or present-day athlete settings.
 * Sweet spot overlaps standard power zones and must never be added as another zone.
 * GAP and ordinary speed remain separate inputs even if their bounds match.
 */
export function recordedZoneTimes(activity, kind) {
  const power = kind === "power";
  if (!power && kind !== "pace") throw Error("Choose power or pace zone times.");
  const boundaries = power ? activity?.icu_power_zones : activity?.pace_zones;
  if (!bounds(boundaries)) return null;
  let seconds;
  if (power) {
    const rows = activity?.icu_zone_times;
    if (!Array.isArray(rows) || rows.length > 101) return null;
    const values = new Map();
    for (const row of rows) {
      if (
        !row ||
        typeof row.id !== "string" ||
        !finite(row.secs) ||
        values.has(row.id) ||
        (row.id !== "SS" && !/^Z[1-9]\d?$|^Z100$/.test(row.id))
      )
        return null;
      values.set(row.id, row.secs);
    }
    if ([...values.keys()].some((id) => id !== "SS" && Number(id.slice(1)) > boundaries.length))
      return null;
    seconds = boundaries.map((_, index) => values.get(`Z${index + 1}`));
  } else
    seconds =
      activity?.use_gap_zone_times === true ? activity?.gap_zone_times : activity?.pace_zone_times;
  const threshold = power ? activity?.icu_ftp : activity?.threshold_pace;
  const result = {
    basis: power ? "power" : activity?.use_gap_zone_times === true ? "gap-speed" : "speed",
    unit: power ? "%ftp" : "%threshold-speed",
    boundaries_percent: [...boundaries],
    seconds: Array.isArray(seconds) ? [...seconds] : [],
    threshold: finite(threshold) && threshold > 0 ? threshold : null,
  };
  return validRecordedZoneTimes(result) ? result : null;
}
