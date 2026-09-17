import { clone, convertTarget, paceFactors } from "./workout-editor-model.mjs";
import { sportZoneSettings } from "./workout-editor-zones.mjs";

export function parseDurationInput(text) {
  const input = String(text).trim();
  let parts;
  if (/^\d{1,7}$/.test(input)) {
    const digits = input.padStart(6, "0");
    parts = [digits.slice(0, -4), digits.slice(-4, -2), digits.slice(-2)].map(Number);
  } else if (/^\d{1,3}:[0-5]\d(?::[0-5]\d)?$/.test(input)) {
    parts = input.split(":").map(Number);
    if (parts.length === 2) parts.unshift(0);
  } else return null;
  const [hours, minutes, seconds] = parts;
  return minutes < 60 && seconds < 60 ? hours * 3600 + minutes * 60 + seconds : null;
}

export function durationClock(value) {
  const seconds = Math.max(0, Math.round(value));
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
}

export function editorUnits(sport) {
  return /swim/i.test(sport)
    ? { kind: "pace", target: "secs/100y", label: "min/100y", distance: "yd", distanceLabel: "yds" }
    : /run/i.test(sport)
      ? { kind: "pace", target: "secs/mi", label: "min/mile", distance: "mi", distanceLabel: "mi" }
      : { kind: "power", target: "w", label: "W", distance: "mi", distanceLabel: "mi" };
}

// Display conversions never mutate the imported prescription. Editing the
// displayed numbers writes an absolute target in the sport's fixed units.
// Open zones and missing thresholds remain native until the user replaces them.
export function editorTarget(target, sport, settings = [], thresholds = {}) {
  if (target.kind === "none") return clone(target);
  const units = editorUnits(sport);
  if (target.kind !== units.kind) return null;
  const setting = sportZoneSettings(settings, sport);
  const ftp = thresholds.ftp || setting?.ftp;
  const pace = thresholds.pace || setting?.threshold_pace;
  try {
    return convertTarget(target, units.target, ftp);
  } catch {
    /* Resolve zones below. */
  }
  let relative = target;
  if (target.unit.endsWith("_zone")) {
    const boundaries = target.kind === "power" ? setting?.power_zones : setting?.pace_zones;
    const first = target.mode === "single" ? target.value : target.start;
    const last = target.mode === "single" ? target.value : target.end;
    if (!boundaries || !Number.isInteger(first) || !Number.isInteger(last)) return null;
    const low = first === 1 ? 0 : boundaries[first - 2],
      high = boundaries[last - 1];
    if (
      !Number.isFinite(low) ||
      !Number.isFinite(high) ||
      high >= 999 ||
      high <= low ||
      (target.kind === "pace" && low === 0)
    )
      return null;
    relative = {
      kind: target.kind,
      unit: target.kind === "power" ? "%ftp" : "%pace",
      mode: "range",
      start: low,
      end: high,
    };
  }
  if (relative.kind === "power") {
    try {
      return convertTarget(relative, units.target, ftp);
    } catch {
      return null;
    }
  }
  if (relative.unit !== "%pace" || !(pace > 0)) return null;
  const amount = (n) => paceFactors[units.target] / ((pace * n) / 100);
  if (
    (relative.mode === "single" ? [relative.value] : [relative.start, relative.end]).some(
      (n) => !(n > 0)
    )
  )
    return null;
  return {
    ...relative,
    unit: units.target,
    ...(relative.mode === "single"
      ? { value: amount(relative.value) }
      : { start: amount(relative.start), end: amount(relative.end) }),
  };
}
