const valid = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  Number.isFinite(Date.parse(`${value}T12:00:00Z`)) &&
  new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value
/** Stable month keys coalesce adjacent weeks, including requests across years. */
export function historyMonths(
  start: string,
  end: string
): { start: string; end: string }[] {
  if (!valid(start) || !valid(end) || end < start)
    throw Error("Choose a valid historical date range.")
  const result: { start: string; end: string }[] = []
  let month = `${start.slice(0, 7)}-01`
  while (month <= end) {
    const date = new Date(`${month}T12:00:00Z`)
    date.setUTCMonth(date.getUTCMonth() + 1)
    const next = date.toISOString().slice(0, 10)
    result.push({
      start: month,
      end: new Date(date.getTime() - 86400000).toISOString().slice(0, 10),
    })
    if (result.length > 1200)
      throw Error("Choose a date range of at most 100 years.")
    month = next
  }
  return result
}
