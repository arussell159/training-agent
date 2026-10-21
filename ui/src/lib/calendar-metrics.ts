import { apiFetch } from "./api-client.ts"
import { withRequestDeadline } from "./request-deadline.ts"
import { randomId } from "./random-id.ts"
import {
  calendarMetricFields,
  isCalendarMetricsEntries,
  type CalendarMetricChange,
  type CalendarMetricEntry,
  type CalendarMetricKey,
  type CalendarMetricRow,
} from "../../../app-backend/lib/calendar-metrics-model.mjs"
import type { TrainingContext } from "./training-context"

export { calendarMetricFields }
export type { CalendarMetricEntry, CalendarMetricKey, CalendarMetricRow }
export type CalendarMetricsResult = CalendarMetricRow & {
  context?: TrainingContext
}
export type MetricInput = { value: string; time: string }
export type MetricInputs = Record<CalendarMetricKey, MetricInput>
export type MetricsWrite = {
  date: string
  revision: string
  operationId: string
  changes: Partial<Record<CalendarMetricKey, CalendarMetricChange>>
  note?: string
}
export class CalendarMetricsError extends Error {
  status?: number
  code?: string
  uncertain: boolean
  constructor(
    message: string,
    options: { status?: number; code?: string; uncertain?: boolean } = {}
  ) {
    super(message)
    Object.assign(this, options)
    this.uncertain = options.uncertain ?? false
  }
}
const validDate = (date: unknown): date is string =>
  typeof date === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(date) &&
  Number.isFinite(Date.parse(`${date}T12:00:00Z`)) &&
  new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) === date
const validTime = (time: unknown) =>
  time === null ||
  (typeof time === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(time))
export function metricInputValue(
  key: CalendarMetricKey,
  input: MetricInput
): CalendarMetricChange {
  const field = calendarMetricFields.find((item) => item.key === key)
  if (!field) throw new Error("Choose a supported metric.")
  const text = input.value.trim()
  if (!text) return null
  if (!validTime(input.time || null))
    throw new Error(`${field.label}: use a valid time.`)
  let value: string | number = text
  if (field.kind === "select") {
    if (!field.options?.includes(text))
      throw new Error(`${field.label}: choose one of the listed values.`)
  } else {
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text))
      throw new Error(`${field.label}: enter a number.`)
    value = Number(text)
    if (!Number.isFinite(value) || value < field.min! || value > field.max!)
      throw new Error(
        `${field.label}: use a value from ${field.min} to ${field.max}.`
      )
    if (field.step === 1 && !Number.isInteger(value))
      throw new Error(`${field.label}: enter a whole number.`)
  }
  return { value, time: input.time || null }
}
export function metricInputs(row: CalendarMetricRow): MetricInputs {
  return Object.fromEntries(
    calendarMetricFields.map((field) => [
      field.key,
      {
        value:
          row.entries[field.key].value == null
            ? ""
            : String(row.entries[field.key].value),
        time: row.entries[field.key].time || "",
      },
    ])
  ) as MetricInputs
}
export function currentMetricTime(timeZone?: string, now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: timeZone || "America/Chicago",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(now)
    return `${parts.find((part) => part.type === "hour")?.value || "00"}:00`
  } catch {
    return `${String(now.getUTCHours()).padStart(2, "0")}:00`
  }
}
/** Compact calendar projection; provider rating scales keep explicit source labels. */
export function calendarMetricSummary(row: Record<string, unknown>) {
  const values: { label: string; value: string; unit: string }[] = []
  const entries = row.calendar_metrics
  if (isCalendarMetricsEntries(entries)) {
    for (const field of calendarMetricFields) {
      const value = entries[field.key].value
      if (value == null) continue
      values.push({
        label: field.label,
        value:
          typeof value === "number"
            ? value.toLocaleString("en-US", { maximumFractionDigits: 2 })
            : value,
        unit: field.unit,
      })
    }
  }
  const native = [
    ["sleepSecs", "Sleep Hours", 3600, "hrs", "sleepHours"],
    ["restingHR", "Resting Heart Rate", 1, "bpm", "restingHR"],
    ["hrv", "HRV", 1, "ms", "hrv"],
    ["sleepScore", "Sleep Score", 1, "", ""],
    ["weight", "Weight", 1, "kg", "weight"],
    ["spO2", "Blood Oxygen", 1, "%", ""],
    ["stress", "Stress (Intervals.icu)", 1, "", ""],
  ] as const
  for (const [key, label, divisor, unit, mapped] of native) {
    if (typeof row[key] !== "number" || !Number.isFinite(row[key])) continue
    if (
      mapped &&
      isCalendarMetricsEntries(entries) &&
      entries[mapped].value != null
    )
      continue
    values.push({
      label,
      value: (Number(row[key]) / divisor).toLocaleString("en-US", {
        maximumFractionDigits: unit === "hrs" ? 2 : 0,
      }),
      unit,
    })
  }
  if (
    !values.length &&
    typeof row.calendar_metrics_note === "string" &&
    row.calendar_metrics_note.trim()
  )
    values.push({
      label: "Note",
      value: row.calendar_metrics_note.trim().slice(0, 100),
      unit: "",
    })
  return values
}
export function metricChanges(
  original: CalendarMetricRow,
  inputs: MetricInputs
) {
  const changes: MetricsWrite["changes"] = {}
  for (const field of calendarMetricFields) {
    const before = original.entries[field.key],
      input = inputs[field.key]
    if (
      input.value === (before.value == null ? "" : String(before.value)) &&
      input.time === (before.time || "")
    )
      continue
    const value = metricInputValue(field.key, input)
    if (
      (value?.value ?? null) !== before.value ||
      (value?.time ?? null) !== before.time
    )
      changes[field.key] = value
  }
  return changes
}
export function applyMetricChanges(
  row: CalendarMetricRow,
  changes: MetricsWrite["changes"],
  note = row.note
): CalendarMetricRow {
  const entries = { ...row.entries }
  for (const field of calendarMetricFields) {
    if (!Object.hasOwn(changes, field.key)) continue
    const change = changes[field.key]
    entries[field.key] = {
      value: change?.value ?? null,
      time: change?.time ?? null,
      source: change?.value == null ? "unavailable" : "manual",
    }
  }
  return { ...row, entries, note }
}
export function createMetricsWrite(
  row: CalendarMetricRow,
  inputs: MetricInputs,
  note: string,
  operationId = randomId()
): MetricsWrite {
  if (note !== row.note && note.length > 8000)
    throw new Error("Metrics note must be at most 8000 characters.")
  const changes = metricChanges(row, inputs)
  if (!Object.keys(changes).length && note === row.note)
    throw new Error("There are no changes to save.")
  return {
    date: row.date,
    revision: row.revision,
    operationId,
    changes,
    ...(note !== row.note ? { note } : {}),
  }
}
function validatedRow(value: unknown, date: string): CalendarMetricsResult {
  if (!value || typeof value !== "object")
    throw new Error("The metrics response is incomplete.")
  const row = value as CalendarMetricsResult
  if (
    row.date !== date ||
    !validDate(row.date) ||
    typeof row.revision !== "string" ||
    !row.revision ||
    typeof row.note !== "string" ||
    typeof row.locked !== "boolean" ||
    !row.entries ||
    typeof row.entries !== "object"
  )
    throw new Error("The metrics response is incomplete.")
  for (const field of calendarMetricFields) {
    const entry = row.entries[field.key]
    if (
      !entry ||
      !["manual", "intervals", "unavailable"].includes(entry.source) ||
      !validTime(entry.time) ||
      (entry.value !== null &&
        (field.kind === "number"
          ? typeof entry.value !== "number" || !Number.isFinite(entry.value)
          : typeof entry.value !== "string" ||
            !field.options?.includes(entry.value)))
    )
      throw new Error(`The ${field.label} response is invalid.`)
  }
  return row
}
export function createCalendarMetricsClient(
  fetcher: typeof apiFetch = apiFetch
) {
  const read = async (date: string, signal?: AbortSignal) => {
    if (!validDate(date)) throw new Error("Choose a valid metrics date.")
    return withRequestDeadline(
      async (requestSignal) => {
        const response = await fetcher(
          `/api/calendar/metrics?date=${encodeURIComponent(date)}`,
          {
            signal: requestSignal,
            cache: "no-store",
            headers: { Accept: "application/json" },
          }
        )
        const result = await response.json()
        if (!response.ok)
          throw new CalendarMetricsError(
            result.error || "Metrics could not be loaded.",
            { status: response.status, code: result.code }
          )
        return validatedRow(result, date)
      },
      60_000,
      signal,
      "Metrics took too long to load. Retry to load the current values."
    )
  }
  const write = async (input: MetricsWrite) => {
    try {
      return await withRequestDeadline(
        async (signal) => {
          const response = await fetcher("/api/calendar/metrics", {
            method: "POST",
            signal,
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify(input),
          })
          const result = await response.json()
          if (!response.ok)
            throw new CalendarMetricsError(
              result.error ||
                "Metrics could not be saved. Your draft is retained.",
              {
                status: response.status,
                code: result.code,
                uncertain:
                  response.status >= 500 ||
                  result.code === "METRICS_WRITE_UNCONFIRMED",
              }
            )
          const row = validatedRow(result, input.date)
          if (row.verified !== true)
            throw new CalendarMetricsError(
              "The save could not be confirmed. Recheck this same request before editing again.",
              { uncertain: true }
            )
          return row
        },
        60_000,
        undefined,
        "The metrics save needs confirmation. Recheck the retained request."
      )
    } catch (error) {
      if (error instanceof CalendarMetricsError) throw error
      throw new CalendarMetricsError(
        error instanceof Error
          ? error.message
          : "The metrics save needs confirmation.",
        { uncertain: true }
      )
    }
  }
  return { read, write }
}
export const calendarMetricsClient = createCalendarMetricsClient()
type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">
const pendingKey = (scope: string, date: string) =>
  `calendar-metrics-pending-v1:${JSON.stringify([scope, date])}`
const pendingMemory = new Map<string, MetricsWrite | null>()
export const metricsRecoveryStorage: DraftStorage = {
  getItem(key) {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key, value) {
    localStorage.setItem(key, value)
  },
  removeItem(key) {
    localStorage.removeItem(key)
  },
}
export function readPendingMetrics(
  storage: DraftStorage,
  scope: string,
  date: string
): MetricsWrite | null {
  const name = pendingKey(scope, date)
  if (pendingMemory.has(name)) return pendingMemory.get(name) || null
  try {
    const input = JSON.parse(
      storage.getItem(name) || "null"
    ) as MetricsWrite | null
    if (
      !input ||
      input.date !== date ||
      !validDate(input.date) ||
      !/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(
        input.operationId
      ) ||
      typeof input.revision !== "string" ||
      !input.revision ||
      !input.changes ||
      typeof input.changes !== "object" ||
      Array.isArray(input.changes) ||
      (input.note != null &&
        (typeof input.note !== "string" || input.note.length > 8000))
    )
      return null
    for (const [key, value] of Object.entries(input.changes)) {
      const field = calendarMetricFields.find((item) => item.key === key)
      if (!field) return null
      if (value == null) continue
      if (
        typeof value !== "object" ||
        !validTime(value.time) ||
        value.value == null
      )
        return null
      const parsed = metricInputValue(field.key, {
        value: String(value.value),
        time: value.time || "",
      })
      if (parsed?.value !== value.value) return null
    }
    return input
  } catch {
    return null
  }
}
export function rememberPendingMetrics(
  storage: DraftStorage,
  scope: string,
  input: MetricsWrite
) {
  pendingMemory.set(
    pendingKey(scope, input.date),
    JSON.parse(JSON.stringify(input))
  )
  try {
    storage.setItem(pendingKey(scope, input.date), JSON.stringify(input))
  } catch {
    /* The live editor still retains the immutable request in memory. */
  }
}
export function clearPendingMetrics(
  storage: DraftStorage,
  scope: string,
  date: string
) {
  pendingMemory.set(pendingKey(scope, date), null)
  try {
    storage.removeItem(pendingKey(scope, date))
  } catch {
    /* Optional local recovery storage. */
  }
}
