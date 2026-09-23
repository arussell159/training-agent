import {
  WeeklyReportBody,
  BlockReportBody,
} from "@/components/catalog-report-body"
import { useEffect, useRef, useState } from "react"
import { ChevronRight, FileText } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { openReportReader } from "@/lib/report-navigation"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { coachRequest, type CoachSource } from "@/lib/coach-client"

import { cachedTrainingContext } from "@/lib/training-context"
import { dateLabel } from "@/lib/annual-plan"
import { shiftReportDate } from "../../../app-backend/lib/report-blocks.mjs"

export type ReportTarget =
  | { kind: "weekly"; startDate: string }
  | { kind: "block"; planId: string; startDate: string }
type ReportResult = {
  status: "empty" | "running" | "complete" | "error"
  eligible: boolean
  reason?: string
  error?: string
  text?: string
  summary?: string
  needsCheckIn?: boolean
  target?: { title: string; startDate: string; endDate: string }
  generatedAt?: string
  source?: CoachSource
}
const labels = {
  weekly: "weekly",
  block: "block",
}

export function Section11WeeklyReport({ startDate }: { startDate: string }) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: cachedTrainingContext().athlete.time_zone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  if (shiftReportDate(startDate, 6) >= today) return null
  return <Section11Report target={{ kind: "weekly", startDate }} />
}

export function Section11Report({
  target,
  savedOnly = false,
  reader = false,
  unframed = false,
  compactControl = false,
  dateRange,
}: {
  target: ReportTarget
  savedOnly?: boolean
  reader?: boolean
  unframed?: boolean
  compactControl?: boolean
  dateRange?: { startDate: string; endDate: string }
}) {
  const [controlOpen, setControlOpen] = useState(false)
  const signature = JSON.stringify(target)
  if (compactControl)
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 shrink-0 gap-1 px-2 text-xs"
          onClick={() => setControlOpen(true)}
        >
          <FileText className="size-3.5" />
          Block report
        </Button>
        <Dialog open={controlOpen} onOpenChange={setControlOpen}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>
                {dateRange
                  ? `${dateRange.startDate} – ${dateRange.endDate}`
                  : target.kind === "block"
                    ? target.startDate
                    : ""}
              </DialogTitle>
            </DialogHeader>
            <div className="pb-[45vh]">
              <ReportPanel
                key={signature}
                signature={signature}
                savedOnly={savedOnly}
                reader
              />
            </div>
          </DialogContent>
        </Dialog>
      </>
    )
  return (
    <ReportPanel
      key={signature}
      signature={signature}
      savedOnly={savedOnly}
      reader={reader}
      unframed={unframed}
      dateRange={dateRange}
    />
  )
}

function ReportPanel({
  signature,
  savedOnly,
  reader,
  unframed = false,
  dateRange,
}: {
  signature: string
  savedOnly: boolean
  reader: boolean
  unframed?: boolean
  dateRange?: { startDate: string; endDate: string }
}) {
  const isMobile = useIsMobile()
  const target = JSON.parse(signature) as ReportTarget
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const last = useRef<ReportResult | null>(null)
  const alive = useRef(true)
  const active = useRef(false)
  const requests = useRef(new Set<AbortController>())
  const update = (value: ReportResult) => {
    last.current = value
    setResult(value)
  }

  async function request() {
    const controller = new AbortController()
    requests.current.add(controller)
    try {
      const response = await coachRequest(
        "reports/status",
        {
          ...JSON.parse(signature),
        },
        controller.signal
      )
      const value = (await response.json()) as ReportResult
      if (alive.current) {
        update(value)
        setError("")
      }
    } catch (problem) {
      if (alive.current && !controller.signal.aborted)
        setError(
          problem instanceof Error
            ? problem.message
            : "Unable to check this report."
        )
    } finally {
      requests.current.delete(controller)
    }
  }
  useEffect(() => {
    alive.current = true
    let checking = false
    async function check() {
      if (!active.current || checking || last.current?.status === "complete")
        return
      checking = true
      await request()
      checking = false
    }
    const observer = new IntersectionObserver(
      (entries) => {
        active.current = entries.some((entry) => entry.isIntersecting)
        if (active.current) void check()
      },
      { rootMargin: "100px" }
    )
    if (root.current) observer.observe(root.current)
    const timer = window.setInterval(() => {
      if (!document.hidden) void check()
    }, 15000)
    const refresh = () => void check()
    window.addEventListener("training-context-updated", refresh)
    const pending = requests.current
    return () => {
      alive.current = false
      observer.disconnect()
      clearInterval(timer)
      window.removeEventListener("training-context-updated", refresh)
      pending.forEach((controller) => controller.abort())
    }
    // A new target remounts this component and cancels the old requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const complete = result?.status === "complete"
  const compact =
    !reader && (target.kind === "weekly" || target.kind === "block")
  const period =
    result?.target ||
    dateRange ||
    (target.kind === "weekly"
      ? {
          startDate: target.startDate,
          endDate: shiftReportDate(target.startDate, 6),
        }
      : null)
  if (savedOnly && !complete)
    return (
      <div
        ref={root}
        className={reader ? "text-sm text-muted-foreground" : "h-px"}
      >
        {reader
          ? error ||
            result?.error ||
            (!result
              ? "Checking for a saved report…"
              : "No saved report is available for this workout.")
          : null}
      </div>
    )
  return (
    <div
      ref={root}
      className={
        reader || unframed
          ? "min-w-0 space-y-3 text-left"
          : "min-w-0 space-y-3 rounded-lg border bg-card p-3 text-left"
      }
      aria-label={`Section 11 ${labels[target.kind]} report`}
    >
      {!(reader && complete) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {compact ? (
            <div className="space-y-1">
              <h3 className="text-sm font-semibold">
                {target.kind === "weekly" ? "Weekly report" : "Block report"}
              </h3>
              {period && (
                <p className="text-xs text-muted-foreground">
                  {dateLabel(period.startDate, {
                    month: "short",
                    day: "numeric",
                    ...(period.startDate.slice(0, 4) !==
                    period.endDate.slice(0, 4)
                      ? { year: "numeric" as const }
                      : {}),
                  })}{" "}
                  –{" "}
                  {dateLabel(period.endDate, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </p>
              )}
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm font-medium">
              <FileText className="size-4 shrink-0" />
              Section 11 · {labels[target.kind]} report
            </p>
          )}
        </div>
      )}
      {!complete && (
        <p
          className="text-xs leading-relaxed text-muted-foreground"
          role="status"
        >
          {result?.reason ||
            (!result
              ? "Checking report availability…"
              : "Waiting for the saved report from Intervals.icu.")}
        </p>
      )}
      {(error || result?.error) && !complete && (
        <p role="alert" className="text-xs text-destructive">
          {error || result?.error}
        </p>
      )}
      {complete && (
        <>
          {compact ? (
            <>
              <button
                type="button"
                onClick={() =>
                  isMobile ? openReportReader(target) : setOpen(true)
                }
                className="flex w-full items-center justify-between gap-3 rounded-md p-1 text-left text-sm leading-relaxed hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Open full ${labels[target.kind]} report`}
              >
                <span>{result.summary || "View saved report."}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="no-scrollbar max-h-[94vh] gap-0 overflow-y-auto p-0 sm:max-w-5xl">
                  <DialogHeader className="border-b px-5 py-5 pr-12 sm:px-8 sm:pr-12">
                    <DialogTitle>
                      {result.target?.startDate} – {result.target?.endDate}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="min-w-0 px-5 pt-6 pb-[45vh] sm:px-8">
                    <ReportBody
                      text={result.text}
                      kind={target.kind}
                      period={period}
                    />
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <ReportBody text={result.text} kind={target.kind} period={period} />
          )}
        </>
      )}
    </div>
  )
}

function ReportBody({
  text,
  kind,
  period,
}: {
  text?: string
  kind: ReportTarget["kind"]
  period?: { startDate: string; endDate: string } | null
}) {
  if (kind === "weekly" || kind === "block") {
    const report = {
      id: "saved",
      kind,
      title: "",
      text: text || "",
      startDate: period?.startDate || "",
      endDate: period?.endDate || "",
      source: "intervals" as const,
    }
    return kind === "weekly" ? (
      <WeeklyReportBody report={report} hideHeading />
    ) : (
      <BlockReportBody report={report} />
    )
  }
}
