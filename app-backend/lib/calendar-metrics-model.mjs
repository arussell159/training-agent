// Shared reference field definitions. Numeric values use the displayed units;
// provider conversion is explicit in the backend service, never in subjective scales.
const level7 = ["None", "Very Low", "Low", "Average", "High", "Very High", "Extreme"];
export const calendarMetricFields = [
  { key: "weight", label: "Weight", kind: "number", unit: "lbs", min: 0, max: 1000, step: "any" },
  {
    key: "sleepHours",
    label: "Sleep Hours",
    kind: "number",
    unit: "hrs",
    min: 0,
    max: 24,
    step: "any",
  },
  {
    key: "sleepQuality",
    label: "Sleep Quality",
    kind: "select",
    unit: "",
    options: ["Horrible", "Poor", "Bad", "Average", "Good", "Better", "Best"],
  },
  { key: "fatigue", label: "Fatigue", kind: "select", unit: "", options: [...level7] },
  {
    key: "soreness",
    label: "Soreness",
    kind: "select",
    unit: "",
    options: [
      "None",
      "Extremely Low",
      "Very Low",
      "Low",
      "Moderately Low",
      "Moderate",
      "Moderately High",
      "High",
      "Very High",
      "Extreme",
    ],
  },
  { key: "stress", label: "Stress", kind: "select", unit: "", options: [...level7] },
  {
    key: "yesterdayTraining",
    label: "Yesterday's Training",
    kind: "select",
    unit: "",
    options: ["Worse than normal", "Normal", "Better than normal", "RestDay"],
  },
  {
    key: "overallFeeling",
    label: "Overall Feeling",
    kind: "select",
    unit: "",
    options: [
      "Horrible",
      "Extremely Poor",
      "Poor",
      "Bad",
      "Below Average",
      "Above Average",
      "Good",
      "Superior",
      "Extremely Superior",
      "Best",
    ],
  },
  {
    key: "restingHR",
    label: "Resting Heart Rate",
    kind: "number",
    unit: "bpm",
    min: 10,
    max: 200,
    step: 1,
  },
  {
    key: "muscleMass",
    label: "MuscleMass",
    kind: "number",
    unit: "lbs",
    min: 0,
    max: 1000,
    step: "any",
  },
  { key: "bodyFat", label: "Percent Fat", kind: "number", unit: "%", min: 0, max: 80, step: "any" },
  {
    key: "deepSleepHours",
    label: "Time in Deep Sleep",
    kind: "number",
    unit: "hrs",
    min: 0,
    max: 24,
    step: "any",
  },
  {
    key: "remSleepHours",
    label: "Time in REM Sleep",
    kind: "number",
    unit: "hrs",
    min: 0,
    max: 24,
    step: "any",
  },
  { key: "hrv", label: "HRV", kind: "number", unit: "", min: 0, max: 200, step: "any" },
];

export function isCalendarMetricsEntries(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== calendarMetricFields.length
  )
    return false;
  return calendarMetricFields.every((field) => {
    const entry = value[field.key];
    if (
      !entry ||
      typeof entry !== "object" ||
      Array.isArray(entry) ||
      Object.keys(entry).some((key) => !["value", "time", "source"].includes(key))
    )
      return false;
    if (!["manual", "intervals", "unavailable"].includes(entry.source)) return false;
    if (
      entry.time !== null &&
      (typeof entry.time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.time))
    )
      return false;
    return (
      entry.value === null ||
      (field.kind === "number"
        ? typeof entry.value === "number" && Number.isFinite(entry.value)
        : field.options.includes(entry.value))
    );
  });
}
