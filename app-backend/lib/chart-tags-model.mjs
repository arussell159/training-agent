import {
  heartRateCurveSelection,
  heartRateNativeSports,
  heartRateSportMatches,
} from "./heart-rate-curve-model.mjs";
export const chartTagKinds = Object.freeze(["heartRate", "power", "cadence", "velocity"]);
export const chartTagNativeSports = heartRateNativeSports;
export const chartTagSportMatches = heartRateSportMatches;
export const chartTagKindPolicy = Object.freeze({
  heartRate: {
    unit: "bpm",
    unitPolicy: "native-bpm",
    stream: "heartrate",
    ignore: "icu_ignore_hr",
    part: "hr",
  },
  power: {
    unit: "W",
    unitPolicy: "native-watts",
    stream: "watts",
    ignore: "icu_ignore_power",
    part: "power",
  },
  cadence: { unit: "rpm", unitPolicy: "native-rpm", stream: "cadence", ignore: null, part: null },
  velocity: {
    unit: "m/s",
    unitPolicy: "native-velocity-smooth",
    stream: "velocity_smooth",
    ignore: "ignore_velocity",
    part: "pace",
  },
});
export function chartTagError(
  message = "Native tagged chart data could not be verified. Please retry.",
  status = 502,
  code = "CHART_TAG_UNAVAILABLE"
) {
  throw Object.assign(Error(message), { status, code });
}
export const validChartTag = (value) =>
  typeof value === "string" &&
  value.length <= 128 &&
  value.trim().length > 0 &&
  !/[\u0000-\u001f\u007f]/.test(value);
export function parseChartTagFilter(input) {
  let tags = [];
  try {
    tags =
      input.tags === undefined
        ? []
        : typeof input.tags === "string"
          ? JSON.parse(input.tags)
          : input.tags;
  } catch {
    chartTagError("Choose an exact JSON array of native recording tags.", 400, "CHART_TAG_INVALID");
  }
  if (
    !Array.isArray(tags) ||
    tags.length > 20 ||
    tags.some((tag) => !validChartTag(tag)) ||
    new Set(tags).size !== tags.length
  )
    chartTagError("Choose up to 20 unique native recording tags.", 400, "CHART_TAG_INVALID");
  if (tags.length) {
    if (
      !/^[a-f0-9]{64}$/.test(input.tagScope || "") ||
      !/^[a-f0-9]{64}$/.test(input.tagRevision || "")
    )
      chartTagError("Reload native recording tags before filtering.", 400, "CHART_TAG_INVALID");
  } else if (input.tagScope !== undefined || input.tagRevision !== undefined)
    chartTagError("Tag account bindings require a nonempty tag filter.", 400, "CHART_TAG_INVALID");
  return {
    tags: [...tags],
    ...(tags.length ? { tagScope: input.tagScope, tagRevision: input.tagRevision } : {}),
  };
}
export function taggedCurveSelection(input, today) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) => !["kind", "sport", "start", "end", "tags", "tagScope", "tagRevision"].includes(key)
    ) ||
    !chartTagKinds.includes(input.kind)
  )
    chartTagError("Choose supported tagged chart options.", 400, "CHART_TAG_INVALID");
  const filter = parseChartTagFilter(input);
  if (!filter.tags.length)
    chartTagError("Use the original chart reader without a tag filter.", 400, "CHART_TAG_INVALID");
  let selected;
  try {
    selected = heartRateCurveSelection(
      { kind: "heartRate", sport: input.sport, start: input.start, end: input.end },
      today
    );
  } catch {
    chartTagError(
      "Choose supported native sports and valid chart dates.",
      400,
      "CHART_TAG_INVALID"
    );
  }
  return { ...selected, kind: input.kind, ...filter };
}
