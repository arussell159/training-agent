import {
  heartRateCurveSelection,
  heartRateNativeSports,
  heartRateSportMatches,
} from "./heart-rate-curve-model.mjs";
export const nativePowerSports = heartRateNativeSports;
export const nativePowerSourceMatches = heartRateSportMatches;
export const NATIVE_POWER_GRID_SECONDS = Object.freeze([
  5, 10, 12, 20, 30, 60, 120, 300, 360, 600, 720, 1200, 1800, 3600, 5400,
]);
export function nativePowerCurveSelection(input, today) {
  try {
    if (!input || input.kind !== "power") throw Error();
    return { ...heartRateCurveSelection({ ...input, kind: "heartRate" }, today), kind: "power" };
  } catch {
    throw Object.assign(
      Error("Choose supported native power sports and valid dates ending today or earlier."),
      { status: 400, code: "NATIVE_POWER_INVALID" }
    );
  }
}
