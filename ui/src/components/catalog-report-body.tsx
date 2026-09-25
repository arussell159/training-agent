import { reportPeriodLabel } from "../../../app-backend/lib/coach-report-display.mjs"
import { MessageResponse } from "@/components/ai-elements/message"

export type ReportKind = "pre_workout" | "post_workout" | "weekly" | "block" | "season" | "nutrition" | (string & {})
export type CatalogReport = {
  id: string
  kind: ReportKind
  title: string
  startDate: string
  endDate: string
  text: string
  sport?: string | null
  workoutId?: string | null
  eventId?: string | null
  activityId?: string | null
  planId?: string | null
  generatedAt?: string
  sourceKey?: string
  source: "app"
}
export type Catalog = { reports: CatalogReport[] }
export type Filter = "all" | "pre_workout" | "post_workout" | "weekly" | "others"

export function periodLabel(report: CatalogReport) {
  return reportPeriodLabel(report)
}

export function CatalogReportBody({ report }: { report: CatalogReport; hideHeading?: boolean }) {
  return (
    <MessageResponse className="min-w-0 space-y-3 text-left text-sm leading-relaxed">
      {report.text}
    </MessageResponse>
  )
}

// Keep the existing report entry points in workout and home views consistent.
export const WeeklyReportBody = CatalogReportBody
export const BlockReportBody = CatalogReportBody
