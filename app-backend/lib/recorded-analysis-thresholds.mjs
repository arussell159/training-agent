const positive = (value) => typeof value === "number" && Number.isFinite(value) && value > 0;
const boundaries = (value) =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.length <= 100 &&
  value.every((number, index) => positive(number) && (index === 0 || number > value[index - 1]));

// These values describe the provider's processing of this activity. Current
// athlete settings and device FIT zones are not substitutes for this history.
export function recordedAnalysisThresholds(activity) {
  return {
    version: 1,
    source: "intervals-activity",
    ftp: positive(activity?.icu_ftp) ? activity.icu_ftp : null,
    powerZones: boundaries(activity?.icu_power_zones) ? [...activity.icu_power_zones] : [],
    thresholdPace: positive(activity?.threshold_pace) ? activity.threshold_pace : null,
    paceZones: boundaries(activity?.pace_zones) ? [...activity.pace_zones] : [],
  };
}

export function validRecordedAnalysisThresholds(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    value.version === 1 &&
    value.source === "intervals-activity" &&
    [value.ftp, value.thresholdPace].every((number) => number === null || positive(number)) &&
    [value.powerZones, value.paceZones].every(
      (values) => Array.isArray(values) && (values.length === 0 || boundaries(values))
    )
  );
}

export function historicalAnalysisThresholds(summary) {
  const value = summary?.recorded_thresholds;
  return validRecordedAnalysisThresholds(value) ? value : null;
}
