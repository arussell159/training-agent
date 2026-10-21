// Public labels and values observed in the desktop TrainingPeaks Event picker.
// Exact reference types live in private app storage; native sport mappings use
// supported Intervals sports and never imply unsupported multisport structure.
export function raceEventKey(externalId) {
  return typeof externalId === "string"
    ? externalId.match(/^training-agent-event:([a-zA-Z0-9_-]{16,80})$/)?.[1] || null
    : null;
}
export const raceEventTypeGroups = [
  {
    label: "Running",
    options: [
      ["RunningRoad", "Road Running", "Run"],
      ["RunningTrail", "Trail Running", "TrailRun"],
      ["RunningTrack", "Track Running", "Run"],
      ["RunningCrossCountry", "Cross Country", "Run"],
      ["RunningOther", "Running", "Run"],
    ],
  },
  {
    label: "Cycling",
    options: [
      ["CyclingRoad", "Road Bike", "Ride"],
      ["CyclingMountain", "Mountain Bike", "MountainBikeRide"],
      ["CyclingCyclocross", "Cyclocross", "Cyclocross"],
      ["CyclingTrack", "Track Cycling", "TrackRide"],
      ["CyclingOther", "Cycling", "Ride"],
    ],
  },
  {
    label: "Swimming",
    options: [
      ["SwimOpenWater", "Open Water Swim", "OpenWaterSwim"],
      ["SwimPool", "Lap Swim", "Swim"],
    ],
  },
  {
    label: "Multisport",
    options: [
      ["MultisportTriathlon", "Triathlon", "Other"],
      ["MultisportXterra", "Xterra", "Other"],
      ["MultisportDuathlon", "Duathlon", "Other"],
      ["MultisportAquabike", "Aquabike", "Other"],
      ["MultisportAquathon", "Aquathon", "Other"],
      ["MultisportOther", "Multisport", "Other"],
    ],
  },
  {
    label: "Rowing",
    options: [
      ["RowingRegatta", "Regatta", "Rowing"],
      ["RowingOther", "Rowing", "Rowing"],
    ],
  },
  {
    label: "Snow",
    options: [
      ["SnowAlpine", "Alpine Skiing", "AlpineSki"],
      ["SnowNordic", "Nordic Skiing", "NordicSki"],
      ["SnowSkiMountaineering", "Ski Mountaineering", "BackcountrySki"],
      ["SnowSnowshoe", "Snowshoeing", "Snowshoe"],
      ["SnowOther", "Snow", "Other"],
    ],
  },
  {
    label: "Other",
    options: [
      ["OtherAdventure", "Adventure", "Other"],
      ["OtherObstacle", "OCR", "Other"],
      ["OtherSpeedSkate", "Speed Skate", "IceSkate"],
      ["OtherOther", "Other", "Other"],
    ],
  },
];
export const raceEventTypes = Object.fromEntries(
  raceEventTypeGroups.flatMap((group) =>
    group.options.map(([value, label, sport]) => [value, { label, sport }])
  )
);
export const runningRaceDistances = [
  ["", "Select Distance"],
  ["5000", "5k"],
  ["10000", "10k"],
  ["21097", "Half Marathon"],
  ["42195", "Marathon"],
  ["100000", "Ultra"],
  ["0", "Other"],
];
export const runningAtpEventTypes = [
  ["", "Select ATP Event Type"],
  ["RunUnderOneHour", "Run (0-1 hrs)"],
  ["RunOnetoTwoHours", "Run (1-2 hrs)"],
  ["RunOverTwoHours", "Run (2+ hrs)"],
];
export const cyclingAtpEventTypes = [
  ["", "Select ATP Event Type"],
  ["BikeCentury", "Bike (100 mi)"],
  ["RoadBikeUnderTwoHours", "Bike (0-2 hrs)"],
  ["RoadBikeOverTwoHours", "Bike (2+ hrs)"],
  ["MtbUnderTwoHours", "Mountain bike (0-2 hrs)"],
  ["MtbOverTwoHours", "Mountain bike (2+ hrs)"],
];
export const triathlonAtpEventTypes = [
  ["", "Select ATP Event Type"],
  ["TriUnderTwoHours", "Triathlon (0-2 hrs)"],
  ["TriTwoToFourHours", "Triathlon (2-4 hrs)"],
  ["TriOverFourHours", "Triathlon (4+ hrs)"],
];
export const duathlonAtpEventTypes = [
  ["", "Select ATP Event Type"],
  ["DuUnderTwoHours", "Duathlon (0-2 hrs)"],
  ["DuTwoToFourHours", "Duathlon (2-4 hrs)"],
  ["DuOverFourHours", "Duathlon (4+ hrs)"],
];
export const allAtpEventTypes = [
  ...runningAtpEventTypes,
  ...cyclingAtpEventTypes.slice(1),
  ...triathlonAtpEventTypes.slice(1),
  ...duathlonAtpEventTypes.slice(1),
];
export function raceAtpEventTypes(eventType) {
  if (eventType?.startsWith("Running")) return runningAtpEventTypes;
  if (eventType?.startsWith("Cycling")) return cyclingAtpEventTypes;
  if (eventType === "MultisportTriathlon") return triathlonAtpEventTypes;
  if (eventType === "MultisportDuathlon") return duathlonAtpEventTypes;
  return allAtpEventTypes;
}
export const raceGoalDistanceUnits = ["mi", "km", "yds", "m"];
export const emptyRaceGoals = () => ({
  time: "",
  distance: "",
  distanceUnit: "mi",
  place: "",
  finish: false,
  setPr: false,
  custom: [],
});
export function validateRaceGoals(input = emptyRaceGoals()) {
  const fail = (message) => {
    throw Object.assign(Error(message), { status: 400 });
  };
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(emptyRaceGoals(), key))
  )
    fail("Check the event goals.");
  const goals = { ...emptyRaceGoals(), ...input };
  if (
    typeof goals.time !== "string" ||
    (goals.time && !/^\d{1,4}:[0-5]\d(?::[0-5]\d)?$/.test(goals.time))
  )
    fail("Enter a goal time as minutes:seconds or hours:minutes:seconds.");
  if (
    typeof goals.distance !== "string" ||
    (goals.distance &&
      (!/^\d+(?:\.\d+)?$/.test(goals.distance) ||
        !(Number(goals.distance) > 0) ||
        !Number.isFinite(Number(goals.distance))))
  )
    fail("Enter a positive goal distance.");
  if (!raceGoalDistanceUnits.includes(goals.distanceUnit)) fail("Choose a goal distance unit.");
  if (
    typeof goals.place !== "string" ||
    (goals.place && (!/^[1-9]\d*$/.test(goals.place) || !Number.isSafeInteger(Number(goals.place))))
  )
    fail("Enter a positive whole finishing place.");
  if (typeof goals.finish !== "boolean" || typeof goals.setPr !== "boolean")
    fail("Check the event goal choices.");
  if (
    !Array.isArray(goals.custom) ||
    goals.custom.length > 30 ||
    goals.custom.some((value) => typeof value !== "string" || !value.trim() || value.length > 1000)
  )
    fail("Custom goals must contain text under 1,001 characters (up to 30 goals).");
  return { ...goals, custom: goals.custom.map((value) => value.trim()) };
}
export function raceDetailsDate(value) {
  const date =
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00Z`);
  if (!date || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    throw Object.assign(Error("Choose a valid event date."), { status: 400 });
  return value;
}
export function validateRaceEventDetails(value) {
  const fail = (message) => {
    throw Object.assign(Error(message), { status: 400 });
  };
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some(
      (key) =>
        ![
          "name",
          "date",
          "priority",
          "eventType",
          "description",
          "raceDistance",
          "atpEventType",
          "goals",
        ].includes(key)
    )
  )
    fail("Check the event fields.");
  if (typeof value.name !== "string" || !value.name.trim() || value.name.trim().length > 150)
    fail("Enter an event name under 151 characters.");
  raceDetailsDate(value.date);
  if (!["", "A", "B", "C"].includes(value.priority))
    fail("Choose event priority A, B or C, or leave it unspecified.");
  if (!Object.hasOwn(raceEventTypes, value.eventType)) fail("Choose an event type.");
  if (typeof value.description !== "string" || value.description.length > 12000)
    fail("Event description must be text under 12,001 characters.");
  const raceDistance = value.raceDistance ?? "",
    atpEventType = value.atpEventType ?? "";
  if (!runningRaceDistances.some(([key]) => key === raceDistance))
    fail("Choose a supported event distance.");
  if (!value.eventType.startsWith("Running") && raceDistance !== "")
    fail("Event distance presets apply to running events.");
  if (!raceAtpEventTypes(value.eventType).some(([key]) => key === atpEventType))
    fail("Choose a supported ATP event type.");
  return {
    name: value.name.trim(),
    date: value.date,
    priority: value.priority,
    eventType: value.eventType,
    description: value.description,
    raceDistance,
    atpEventType,
    goals: validateRaceGoals(value.goals),
  };
}
