import {
  heartRateCurveSelection,
  heartRateNativeSports,
  heartRateSportMatches,
} from "./heart-rate-curve-model.mjs";
export const cadenceNativeSports = heartRateNativeSports;
export const CADENCE_GRID_SECONDS = [
  5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400,
];
export const cadenceSourceMatches = heartRateSportMatches;
export function cadenceCurveSelection(input, today) {
  if (input && Object.hasOwn(input, "tags"))
    throw Object.assign(
      Error("Native cadence tag filtering is not supported. No unfiltered substitute was loaded."),
      { status: 400, code: "CADENCE_FILTER_UNSUPPORTED" }
    );
  if (input?.kind !== "cadence")
    throw Object.assign(Error("Choose supported cadence curve options."), {
      status: 400,
      code: "CADENCE_CURVE_INVALID",
    });
  try {
    return { ...heartRateCurveSelection({ ...input, kind: "heartRate" }, today), kind: "cadence" };
  } catch {
    throw Object.assign(
      Error("Choose supported native cadence sports and valid dates ending today or earlier."),
      { status: 400, code: "CADENCE_CURVE_INVALID" }
    );
  }
}
