import {
  CatalogReportBody,
  periodLabel,
  type Catalog,
  type CatalogReport,
  type Filter,
} from "@/components/catalog-report-body"
import { filterCoachReports, groupOtherReportsByType, groupWeeklyReportsByMonth, groupWorkoutReportsByWeek, reportDisplayTitle, REPORT_FILTERS } from "../../../app-backend/lib/coach-report-display.mjs"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Sheet } from "framework7-react"
import { FileText } from "lucide-react"

import { Button } from "@/components/ui/button"
import { SettingsList, SettingsListItem } from "@/components/ui/settings-list"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { MobileFilterTabs } from "@/components/ui/mobile-filter-tabs"
import { useIsMobile } from "@/hooks/use-mobile"
import { useSheetDismiss } from "@/hooks/use-sheet-dismiss"
import { coachRequest } from "@/lib/coach-client"

export function CoachPage() {
  const mobile = useIsMobile()
  const reportTrigger = useRef<HTMLElement | null>(null)
  const sheetHistory = useRef(false)
  const [reportExpanded, setReportExpanded] = useState(false)
  const [openReportId, setOpenReportId] = useState<string | null>(null)
  const closeReport = useCallback(() => {
    setReportExpanded(false)
    if (sheetHistory.current) window.history.back()
    else setOpenReportId(null)
  }, [setOpenReportId, setReportExpanded])
  const expandReport = useCallback(() => setReportExpanded(true), [setReportExpanded])
  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      if (!sheetHistory.current) return
      event.stopImmediatePropagation()
      sheetHistory.current = false
      setOpenReportId(null)
    }
    window.addEventListener("popstate", pop, true)
    return () => window.removeEventListener("popstate", pop, true)
  }, [])
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [filter, setFilter] = useState<Filter>("pre_workout")
  const [query, setQuery] = useState("")
  const [displayedReportId, setDisplayedReportId] = useState<string | null>(
    null
  )
  useSheetDismiss("coach-report-layer", Boolean(openReportId), closeReport, {
    expanded: reportExpanded,
    onExpand: expandReport,
  })
  useEffect(() => {
    if (openReportId) setDisplayedReportId(openReportId)
  }, [openReportId])
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const response = await coachRequest(
          "reports/catalog",
          {},
          controller.signal
        )
        const value = (await response.json()) as Catalog
        if (!controller.signal.aborted) {
          setCatalog({ reports: value.reports || [] })
          setError("")
        }
      } catch (problem) {
        if (!controller.signal.aborted)
          setError(
            problem instanceof Error
              ? problem.message
              : "Unable to load saved reports."
          )
      }
    }
    void load()
    window.addEventListener("training-context-updated", load)
    return () => {
      controller.abort()
      window.removeEventListener("training-context-updated", load)
    }
  }, [revision])

  const reports = useMemo(
    () => filterCoachReports(catalog?.reports || [], filter, query),
    [catalog, filter, query]
  )
  const groupedWorkouts = filter === "pre_workout" || filter === "post_workout"
  const groupedWeekly = filter === "weekly"
  const groupedOthers = filter === "others"
  const reportGroups = useMemo(
    () => groupedWorkouts
      ? groupWorkoutReportsByWeek(reports)
      : groupedWeekly
        ? groupWeeklyReportsByMonth(reports)
      : groupedOthers
        ? groupOtherReportsByType(reports)
        : [{ startDate: "all", label: "", reports }],
    [groupedOthers, groupedWeekly, groupedWorkouts, reports]
  )
  const selectedReport = catalog?.reports.find(
    (report) => report.id === displayedReportId
  )
  const reportItem = (report: CatalogReport) => {
    const isOpen = openReportId === report.id
    return <div key={report.id}>
      <SettingsListItem
        icon={FileText}
        label={reportDisplayTitle(report)}
        description={periodLabel(report)}
        expanded={!mobile ? isOpen : undefined}
        onClick={(event) => {
          if (mobile) {
            setReportExpanded(false)
            reportTrigger.current = event.currentTarget
            window.history.pushState(
              { ...window.history.state, coachReport: report.id },
              ""
            )
            sheetHistory.current = true
            setOpenReportId(report.id)
          } else setOpenReportId(current => current === report.id ? null : report.id)
        }}
      />
      {!mobile && isOpen && <div className="border-t px-4 py-5 md:px-6"><CatalogReportBody report={report} /></div>}
    </div>
  }

  const filters = (
    <MobileFilterTabs
      label="Filter reports"
      items={REPORT_FILTERS.map(({ value, label }) => ({ value: value as Filter, label }))}
      value={filter}
      onChange={(value) => {
        setFilter(value)
        setOpenReportId(null)
      }}
    />
  )

  const reportSections = (
    <div className="coach-week-report-groups space-y-6 pt-2 md:pt-6">
      {reportGroups.map((group) => (
        <section key={group.startDate} aria-label={group.label}>
          {group.label && (
            <h2 className="mb-2 px-1 text-sm text-muted-foreground">
              {group.label}
            </h2>
          )}
          <SettingsList>
            {group.reports.map(reportItem)}
          </SettingsList>
        </section>
      ))}
    </div>
  )

  return (
    <div
      id="coach-report-layer"
      className="coach-report-page flex min-h-0 flex-1 flex-col bg-background"
    >
      <MobileSiteNavbar title="Coach" className="coach-report-navbar">
        {filters}
      </MobileSiteNavbar>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="coach-report-content mx-auto w-full max-w-4xl px-4 py-5 md:px-8 md:py-14">
          <header className="mb-8 hidden md:block">
            <h1 className="text-2xl font-medium tracking-tight">Coach</h1>
            <p className="mt-1 text-sm text-muted-foreground">Your training reports and weekly insights.</p>
          </header>
          <div
            role="group"
            aria-label="Filter reports"
            className="mb-8 hidden rounded-xl border bg-card p-4 ring-1 ring-foreground/10 md:block"
          >
            <div className="flex items-center justify-between gap-4">
              <Input
                className="max-w-sm"
                placeholder="Search reports"
                aria-label="Search reports"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="flex gap-2">
                {REPORT_FILTERS.map(({ value, label }) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={filter === value ? "default" : "outline"}
                    onClick={() => setFilter(value as Filter)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {error ? (
            <div
              role="alert"
              className="space-y-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
            >
              <p>{error}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRevision((value) => value + 1)}
              >
                Retry
              </Button>
            </div>
          ) : !catalog ? (
            <p className="text-sm text-muted-foreground">
              Loading saved reports…
            </p>
          ) : reports.length && (groupedWorkouts || groupedWeekly || groupedOthers) ? (
            reportSections
          ) : reports.length && !mobile ? (
            <div className="space-y-8">
              {reportGroups.map((group) => (
                <section key={group.startDate}>
                  {group.label && <h2 className="mb-4 text-sm font-medium">{group.label}</h2>}
                  <SettingsList>
                    {group.reports.map((report) => (
                      <SettingsListItem key={report.id} icon={FileText} label={reportDisplayTitle(report)} description={periodLabel(report)} onClick={() => setOpenReportId(report.id)} />
                    ))}
                  </SettingsList>
                </section>
              ))}
            </div>
          ) : reports.length ? (
            <SettingsList>
              {reports.map(reportItem)}
            </SettingsList>
          ) : (
            <div className="rounded-xl border bg-muted/20 p-5 text-sm text-muted-foreground">
              {catalog.reports.length
                ? `No ${REPORT_FILTERS.find(item => item.value === filter)?.label.toLowerCase() || "matching"} reports are available.`
                : "No Section 11 reports have been saved in the app yet."}
            </div>
          )}
        </div>
      </div>
      {!mobile && (
        <Dialog
          open={!groupedWorkouts && Boolean(openReportId)}
          onOpenChange={(open) => {
            if (!open) setOpenReportId(null)
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>
                {selectedReport && `${reportDisplayTitle(selectedReport)} · ${periodLabel(selectedReport)}`}
              </DialogTitle>
            </DialogHeader>
            <div className="pb-[45vh]">
              {selectedReport && <CatalogReportBody report={selectedReport} hideHeading />}
            </div>
          </DialogContent>
        </Dialog>
      )}
      {mobile && (
        <>
          <div
            className={
              "terms-metric-backdrop sheet-backdrop coach-report-backdrop" +
              (openReportId ? " backdrop-in" : "")
            }
            aria-hidden="true"
            onClick={closeReport}
          />
          <Sheet
            containerEl="#coach-report-layer"
            className={`terms-metric-sheet detail-sheet-expandable ${reportExpanded ? "detail-sheet-expanded" : ""}`}
            opened={Boolean(openReportId)}
            backdrop
            backdropEl=".coach-report-backdrop"
            closeByBackdropClick
            closeOnEscape
            onSheetClose={closeReport}
            onSheetClosed={() => {
              setReportExpanded(false)
              reportTrigger.current?.focus({ preventScroll: true })
            }}
            {...{
              role: "dialog",
              "aria-modal": true,
              "aria-label": selectedReport ? reportDisplayTitle(selectedReport) : "Report",
            }}
          >
            <div
              className="terms-metric-sheet-handle detail-sheet-handle coach-report-handle"
              aria-hidden="true"
            >
              <span />
            </div>
            <div className="terms-metric-sheet-heading">
              <h2>{selectedReport && `${reportDisplayTitle(selectedReport)} · ${periodLabel(selectedReport)}`}</h2>
            </div>
            <div className="terms-metric-sheet-scroll" data-sheet-scroll key={openReportId}>
              {selectedReport && <CatalogReportBody report={selectedReport} hideHeading />}
            </div>
          </Sheet>
        </>
      )}
    </div>
  )
}
