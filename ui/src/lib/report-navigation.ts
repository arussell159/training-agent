import type { ReportTarget } from "@/components/section11-report"

export function restoreReportReader(): ReportTarget | null {
  try {
    const value = JSON.parse(
      new URLSearchParams(window.location.search).get("report") || "null"
    )
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.startDate)) return null
    if (value.kind === "weekly")
      return { kind: "weekly", startDate: value.startDate }
    if (value.kind === "block" && typeof value.planId === "string")
      return { kind: "block", startDate: value.startDate, planId: value.planId }
  } catch {
    /* Invalid or missing reader link. */
  }
  return null
}
export function openReportReader(target: ReportTarget) {
  const url = new URL(window.location.href)
  url.searchParams.delete("workout")
  url.searchParams.set("report", JSON.stringify(target))
  window.history.pushState(
    { section11Reader: true },
    "",
    `${url.pathname}${url.search}`
  )
  window.dispatchEvent(new Event("section11-report-open"))
}
export function closeReportReader() {
  if (window.history.state?.section11Reader) window.history.back()
  else {
    const url = new URL(window.location.href)
    url.searchParams.delete("report")
    window.history.replaceState({}, "", `${url.pathname}${url.search}`)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }
}
