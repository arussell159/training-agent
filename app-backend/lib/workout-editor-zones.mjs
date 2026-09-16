import { clock, paceFactors, round } from "./workout-editor-model.mjs";

export function sportZoneSettings(settings, sport) {
  const family = /swim/i.test(sport) ? /swim/i : /run/i.test(sport) ? /run/i : /ride|bike/i;
  return (
    settings.find((s) => (s.types || [s.type]).includes(sport)) ||
    settings.find((s) => (s.types || [s.type]).some((t) => family.test(t || "")))
  );
}

// Provider boundaries are the upper percentage of each zone. Open zones stay
// native zone prescriptions so we never invent a finite lower/upper bound.
export function workoutZoneOptions(settings, sport, preferredUnit) {
  const setting = sportZoneSettings(settings, sport);
  if (!setting) return [];
  const bike = /ride|bike/i.test(sport),
    kind = bike ? "power" : "pace";
  const boundaries = bike ? setting.power_zones : setting.pace_zones;
  if (!Array.isArray(boundaries)) return [];
  const threshold = bike ? setting.ftp : setting.threshold_pace;
  const absoluteUnit = bike ? "w" : /swim/i.test(sport) ? "secs/100y" : "secs/mi";
  const names = bike ? setting.power_zone_names : setting.pace_zone_names;
  const amount = (percent, unit) =>
    bike
      ? unit === "w"
        ? Math.round((threshold * percent) / 100)
        : percent
      : paceFactors[unit]
        ? Math.round(paceFactors[unit] / ((threshold * percent) / 100))
        : percent;
  const display = (percent) =>
    bike ? `${amount(percent, "w")} W` : clock(amount(percent, absoluteUnit));
  return boundaries.flatMap((high, index) => {
    const low = index ? boundaries[index - 1] : 0;
    if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return [];
    const openLow = !bike && low === 0,
      openHigh = high >= 999;
    const unit =
      threshold > 0 && (bike ? preferredUnit === "w" : Boolean(paceFactors[preferredUnit]))
        ? preferredUnit
        : bike
          ? "%ftp"
          : "%pace";
    const range =
      threshold > 0
        ? openHigh
          ? `${bike ? "Over" : "Faster than"} ${display(low)}`
          : openLow
            ? `Slower than ${display(high)}`
            : bike
              ? `${amount(low, "w")}–${amount(high, "w")} W`
              : `${display(high)}–${display(low)}`
        : `${round(low, 1)}–${round(high, 1)}%`;
    return [
      {
        id: String(index + 1),
        label: `Zone ${index + 1} | ${range}${!bike && threshold > 0 ? (/swim/i.test(sport) ? " /100 yd" : " /mi") : ""}${names?.[index] ? ` · ${names[index]}` : ""}`,
        target:
          openLow || openHigh
            ? { kind, unit: `${kind}_zone`, mode: "single", value: index + 1 }
            : { kind, unit, mode: "range", start: amount(low, unit), end: amount(high, unit) },
      },
    ];
  });
}
