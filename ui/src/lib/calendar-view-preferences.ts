export type CalendarViewPreferences = {
  summaryOpen: boolean
  showProfiles: boolean
  showMetrics: boolean
}
const defaults: CalendarViewPreferences = {
  summaryOpen: true,
  showProfiles: true,
  showMetrics: true,
}
const key = (scope: string) => `calendar-view:v1:${scope}`

/** Display preferences are device-local: no server read or write on a toggle. */
export function readCalendarViewPreferences(
  scope: string
): CalendarViewPreferences {
  try {
    const value = JSON.parse(localStorage.getItem(key(scope)) || "null")
    return Object.fromEntries(
      Object.entries(defaults).map(([name, fallback]) => [
        name,
        typeof value?.[name] === "boolean" ? value[name] : fallback,
      ])
    ) as CalendarViewPreferences
  } catch {
    return { ...defaults }
  }
}
export function saveCalendarViewPreferences(
  scope: string,
  value: CalendarViewPreferences
) {
  try {
    localStorage.setItem(key(scope), JSON.stringify(value))
  } catch {
    // Display changes remain usable for this visit if browser storage is unavailable.
  }
}
