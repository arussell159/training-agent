import {
  heartRateCurveSelection,
  heartRateNativeSports,
  heartRateSportMatches,
} from "./heart-rate-curve-model.mjs";
export const velocityNativeSports = heartRateNativeSports;
export const VELOCITY_GRID_SECONDS = [
  5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400,
];
export const velocitySourceMatches = heartRateSportMatches;
export function velocityCurveSelection(input, today) {
  if (input && Object.hasOwn(input, "tags"))
    throw Object.assign(
      Error("Native velocity tag filtering is not supported. No unfiltered substitute was loaded."),
      { status: 400, code: "VELOCITY_FILTER_UNSUPPORTED" }
    );
  if (input?.kind !== "velocity")
    throw Object.assign(Error("Choose supported velocity curve options."), {
      status: 400,
      code: "VELOCITY_CURVE_INVALID",
    });
  try {
    return { ...heartRateCurveSelection({ ...input, kind: "heartRate" }, today), kind: "velocity" };
  } catch {
    throw Object.assign(
      Error("Choose supported native velocity sports and valid dates ending today or earlier."),
      { status: 400, code: "VELOCITY_CURVE_INVALID" }
    );
  }
}
