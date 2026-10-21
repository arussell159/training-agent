const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error("Invalid date");
  const date = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw Error("Invalid date");
};

export const heartRateNativeSports = [
  "Ride",
  "Run",
  "Swim",
  "WeightTraining",
  "Hike",
  "Walk",
  "AlpineSki",
  "BackcountrySki",
  "Badminton",
  "Canoeing",
  "Crossfit",
  "EBikeRide",
  "EMountainBikeRide",
  "Elliptical",
  "Golf",
  "GravelRide",
  "TrackRide",
  "Handcycle",
  "HighIntensityIntervalTraining",
  "Hockey",
  "IceSkate",
  "InlineSkate",
  "Kayaking",
  "Kitesurf",
  "MountainBikeRide",
  "Cyclocross",
  "NordicSki",
  "OpenWaterSwim",
  "Padel",
  "Pilates",
  "Pickleball",
  "Racquetball",
  "Rugby",
  "RockClimbing",
  "RollerSki",
  "Rowing",
  "Sail",
  "Skateboard",
  "Snowboard",
  "Snowshoe",
  "Soccer",
  "Squash",
  "StairStepper",
  "StandUpPaddling",
  "Surfing",
  "TableTennis",
  "Tennis",
  "TrailRun",
  "Transition",
  "Velomobile",
  "VirtualRide",
  "VirtualRow",
  "VirtualRun",
  "VirtualSki",
  "WaterSport",
  "Wheelchair",
  "Windsurf",
  "Workout",
  "Yoga",
  "Other",
];
const invalid = () => {
  throw Object.assign(
    Error("Choose a supported HR sport selection and valid dates ending today or earlier."),
    { status: 400, code: "HR_CURVE_INVALID" }
  );
};
export function heartRateCurveSelection(input, today) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !["kind", "sport", "start", "end"].includes(key)) ||
    input.kind !== "heartRate" ||
    typeof input.sport !== "string"
  )
    invalid();
  try {
    validDate(input.start);
    validDate(input.end);
    validDate(today);
  } catch {
    invalid();
  }
  if (input.start < "1900-01-01" || input.start > input.end || input.end > today) invalid();
  const types = input.sport === "all" ? [] : input.sport.split(",");
  if (
    input.sport !== "all" &&
    (!types.length ||
      types.length > 14 ||
      new Set(types).size !== types.length ||
      types.some((type) => !heartRateNativeSports.includes(type)))
  )
    invalid();
  types.sort();
  return {
    kind: "heartRate",
    sport: types.length ? types.join(",") : "all",
    nativeTypes: types,
    start: input.start,
    end: input.end,
  };
}

// Existing native endpoints explicitly use sport families for these selections.
// Other enum values require exact native identity; no private variant inference.
export function heartRateSportMatches(native, selected) {
  if (selected === "all") return heartRateNativeSports.includes(native);
  if (selected === "Ride")
    return [
      "Ride",
      "VirtualRide",
      "EBikeRide",
      "EMountainBikeRide",
      "GravelRide",
      "TrackRide",
      "Handcycle",
      "MountainBikeRide",
      "Cyclocross",
      "Velomobile",
    ].includes(native);
  if (selected === "Run") return ["Run", "TrailRun", "VirtualRun"].includes(native);
  if (selected === "Swim") return ["Swim", "OpenWaterSwim"].includes(native);
  return native === selected;
}
