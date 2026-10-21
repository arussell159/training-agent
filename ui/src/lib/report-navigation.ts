import type { ReportTarget } from "@/components/section11-report"
import {
  pushWorkoutNavigationState,
  replaceWorkoutNavigationState,
  runWithWorkoutNavigationGuard,
  traverseWorkoutNavigation,
} from "./workout-navigation-guard.ts"

export function restoreReportReader(): ReportTarget | null {
  try {
    const value = JSON.parse(
      new URLSearchParams(window.location.search).get("report") || "null"
    )
    if (
      !value ||
      typeof value.startDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.startDate)
    )
      return null
    const timestamp = Date.parse(`${value.startDate}T12:00:00Z`)
    if (
      !Number.isFinite(timestamp) ||
      new Date(timestamp).toISOString().slice(0, 10) !== value.startDate
    )
      return null
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
  runWithWorkoutNavigationGuard(() => {
    const url = new URL(window.location.href)
    url.searchParams.delete("workout")
    url.searchParams.set("report", JSON.stringify(target))
    pushWorkoutNavigationState(
      { section11Reader: true },
      `${url.pathname}${url.search}`
    )
    window.dispatchEvent(new Event("section11-report-open"))
  })
}
export function closeReportReader() {
  if (window.history.state?.section11Reader) traverseWorkoutNavigation(-1)
  else {
    runWithWorkoutNavigationGuard(() => {
      const url = new URL(window.location.href)
      url.searchParams.delete("report")
      replaceWorkoutNavigationState(
        window.history.state,
        `${url.pathname}${url.search}`
      )
      window.dispatchEvent(new PopStateEvent("popstate"))
    })
  }
}
