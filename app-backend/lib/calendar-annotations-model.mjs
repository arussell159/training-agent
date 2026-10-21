export const calendarAvailabilityReasons = [
  "None",
  "Appointment",
  "Injury",
  "Sick",
  "Vacation",
  "Work",
  "Other",
];
export const calendarAvailabilitySports = [
  "Run",
  "Bike",
  "Swim",
  "Brick",
  "Crosstrain",
  "Mtn Bike",
  "Strength",
  "Custom",
  "XC-Ski",
  "Rowing",
  "Walk",
  "Other",
];
export const calendarAnnotationKey = (value) =>
  /^training-agent:annotation:(?:(?:goals|availability):)?([a-zA-Z0-9_-]{16,80})$/.exec(
    String(value || "")
  )?.[1] || null;
export const calendarAnnotationKind = (value) =>
  /^training-agent:annotation:(goals|availability):[a-zA-Z0-9_-]{16,80}$/.exec(
    String(value || "")
  )?.[1] || null;
export const annotationOverlapsRange = (row, start, end) =>
  String(row.workout_date || "") <= end &&
  String(row.workout_end_date || row.workout_date || "") >= start;
export function annotationNativeProjection(value) {
  const names = [
    "id",
    "name",
    "description",
    "category",
    "start_date_local",
    "end_date_local",
    "external_id",
    "training_availability",
    "can_train_sports",
    "updated",
    "read_only",
    "readonly",
    "editable",
    "athlete_cannot_edit",
    "paired_activity_id",
  ];
  return Object.fromEntries(
    names.filter((name) => Object.hasOwn(value, name)).map((name) => [name, value[name]])
  );
}
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const invalid = (message) => {
  throw Object.assign(Error(message), { status: 400, code: "INVALID_ANNOTATION" });
};
export function annotationDate(value) {
  if (typeof value !== "string" || !/^[1-9]\d{3}-\d{2}-\d{2}$/.test(value))
    invalid("Choose a valid calendar date.");
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value)
    invalid("Choose a valid calendar date.");
  return value;
}
export function shiftAnnotationDate(date, days) {
  annotationDate(date);
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  const result = value.toISOString().slice(0, 10);
  annotationDate(result);
  return result;
}
export const annotationIsAllDay = (value) =>
  [value.start_date_local, value.end_date_local]
    .filter(Boolean)
    .every((date) => /^(?:T00:00(?::00(?:\.0+)?)?(?:Z)?)?$/.test(String(date).slice(10)));
export function annotationInclusiveEnd(value) {
  const date = annotationDate(String(value.start_date_local || "").slice(0, 10));
  if (!value.end_date_local) return date;
  const end = annotationDate(String(value.end_date_local).slice(0, 10));
  return /^(?:T00:00(?::00(?:\.0+)?)?(?:Z)?)?$/.test(String(value.end_date_local).slice(10))
    ? shiftAnnotationDate(end, -1)
    : end;
}
const text = (value, max, label) => {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    invalid(`${label} must be ${max.toLocaleString("en-US")} characters or fewer.`);
  return value;
};
export function validateCalendarAnnotationEntry(value) {
  if (!object(value) || !["goals", "availability"].includes(value.kind))
    invalid("Choose Goals or Availability.");
  const keys =
    value.kind === "goals"
      ? ["kind", "date", "endDate", "title", "goals"]
      : ["kind", "date", "endDate", "mode", "sports", "reason", "description"];
  if (Object.keys(value).some((key) => !keys.includes(key)))
    invalid("Unsupported calendar entry field.");
  const date = annotationDate(value.date),
    endDate = annotationDate(value.endDate || value.date);
  if (endDate < date) invalid("The end date must be on or after the start date.");
  // The native all-day end is exclusive and must itself be a supported date.
  shiftAnnotationDate(endDate, 1);
  if (value.kind === "goals") {
    if (endDate !== date) invalid("Goals belong to one calendar date.");
    const title = text(value.title ?? "Goals", 150, "Goal title").trim() || "Goals";
    if (!Array.isArray(value.goals) || value.goals.length > 100)
      invalid("Keep at most 100 goals in one entry.");
    const seen = new Set();
    const goals = value.goals
      .map((goal) => {
        if (
          !object(goal) ||
          Object.keys(goal).some((key) => !["id", "text", "completed"].includes(key)) ||
          typeof goal.id !== "string" ||
          !/^[a-zA-Z0-9_-]{1,80}$/.test(goal.id) ||
          seen.has(goal.id) ||
          typeof goal.completed !== "boolean"
        )
          invalid("Each goal needs a unique identity, text and completion state.");
        seen.add(goal.id);
        return { id: goal.id, text: text(goal.text, 8000, "Goal text"), completed: goal.completed };
      })
      .filter((goal) => goal.text.trim());
    if (!goals.length) invalid("Enter at least one goal before saving.");
    if (goals.reduce((sum, goal) => sum + goal.text.length + 10, 0) > 28000)
      invalid("The combined goals exceed the provider text limit.");
    return { kind: "goals", date, endDate, title, goals };
  }
  if (!["unavailable", "limited"].includes(value.mode))
    invalid("Choose unavailable or limited availability.");
  if (
    !Array.isArray(value.sports) ||
    value.sports.some((sport) => !calendarAvailabilitySports.includes(sport)) ||
    new Set(value.sports).size !== value.sports.length
  )
    invalid("Choose valid available sports.");
  if (value.mode === "limited" && !value.sports.length)
    invalid("Choose at least one available sport.");
  if (value.mode === "unavailable" && value.sports.length)
    invalid("Unavailable dates cannot include available sports.");
  if (!calendarAvailabilityReasons.includes(value.reason))
    invalid("Choose a valid availability reason.");
  return {
    kind: "availability",
    date,
    endDate,
    mode: value.mode,
    sports: calendarAvailabilitySports.filter((sport) => value.sports.includes(sport)),
    reason: value.reason,
    description: text(value.description ?? "", 12000, "Availability description"),
  };
}
export function isCalendarAnnotation(value) {
  if (
    !object(value) ||
    !/^event:[1-9]\d*$/.test(value.id || "") ||
    !/^[a-f0-9]{64}$/.test(value.revision || "") ||
    typeof value.title !== "string" ||
    typeof value.editable !== "boolean" ||
    typeof value.metadataCurrent !== "boolean" ||
    typeof value.nativeSportsComplete !== "boolean"
  )
    return false;
  try {
    const entry =
      value.kind === "goals"
        ? {
            kind: value.kind,
            date: value.date,
            endDate: value.endDate,
            title: value.title,
            goals: value.goals,
          }
        : {
            kind: value.kind,
            date: value.date,
            endDate: value.endDate,
            mode: value.mode,
            sports: value.sports,
            reason: value.reason,
            description: value.description,
          };
    validateCalendarAnnotationEntry(
      value.kind === "goals" && !value.editable ? { ...entry, title: "Goals" } : entry
    );
    return (
      (!Object.hasOwn(value, "creationId") ||
        /^[a-zA-Z0-9_-]{16,80}$/.test(value.creationId || "")) &&
      (!Object.hasOwn(value, "nativeWarning") || typeof value.nativeWarning === "string") &&
      (!Object.hasOwn(value, "providerDescription") ||
        typeof value.providerDescription === "string")
    );
  } catch {
    return false;
  }
}
