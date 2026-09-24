import {
  WeeklyReportBody,
  BlockReportBody,
  periodLabel,
  type Catalog,
  type Filter,
  type ReportKind,
} from "@/components/catalog-report-body"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  AccordionContent,
  Button as F7Button,
  List,
  ListItem,
  Segmented,
  Subnavbar,
  Sheet,
} from "framework7-react"
import { ChevronDown, ChevronRight, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { MobilePullToRefresh } from "@/components/ui/mobile-pull-to-refresh"
import { useIsMobile } from "@/hooks/use-mobile"
import { coachRequest } from "@/lib/coach-client"

export function CoachPage() {
  const mobile = useIsMobile()
  const reportTrigger = useRef<HTMLElement | null>(null)
  const reportClose = useRef<HTMLButtonElement>(null)
  const sheetHistory = useRef(false)
  const closeReport = () => {
    if (sheetHistory.current) window.history.back()
    else setOpenReportId(null)
  }
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
  const [filter, setFilter] = useState<Filter>("all")
  const [query, setQuery] = useState("")
  const [openReportId, setOpenReportId] = useState<string | null>(null)
  const [displayedReportId, setDisplayedReportId] = useState<string | null>(
    null
  )
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
              : "Unable to load reports from Intervals.icu."
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
    () =>
      catalog?.reports.filter(
        (report) =>
          (filter === "all" || report.kind === filter) &&
          `${report.title} ${report.startDate} ${report.endDate}`
            .toLowerCase()
            .includes(query.toLowerCase())
      ) || [],
    [catalog, filter, query]
  )
  const selectedReport = catalog?.reports.find(
    (report) => report.id === displayedReportId
  )
  const count = (kind: ReportKind) =>
    catalog?.reports.filter((report) => report.kind === kind).length || 0

  const filters = (
    <Segmented strong round className="coach-report-filters w-full">
      {(
        [
          ["all", "All", catalog?.reports.length || 0],
          ["weekly", "Weekly", count("weekly")],
          ["block", "Blocks", count("block")],
        ] as const
      ).map(([value, label, total]) => (
        <F7Button
          key={value}
          active={filter === value}
          smallMd
          onClick={(event) => {
            event.preventDefault()
            setFilter(value)
            setOpenReportId(null)
          }}
          aria-pressed={filter === value}
        >
          {label}{" "}
          <span className="ml-1 hidden opacity-70 md:inline">{total}</span>
        </F7Button>
      ))}
    </Segmented>
  )

  return (
    <div
      id="coach-report-layer"
      className="coach-report-page flex min-h-0 flex-1 flex-col"
    >
      <MobileSiteNavbar title="Coach" className="coach-report-navbar">
        <Subnavbar
          className="coach-report-subnavbar"
          {...{ role: "group", "aria-label": "Filter reports" }}
        >
          {filters}
        </Subnavbar>
      </MobileSiteNavbar>
      <MobilePullToRefresh className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
        <div className="coach-report-content mx-auto w-full px-4 py-5 md:px-6 md:py-6">
          <div
            role="group"
            aria-label="Filter reports"
            className="mb-4 hidden md:block"
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
                {(["all", "weekly", "block"] as const).map((kind) => (
                  <Button
                    key={kind}
                    size="sm"
                    variant={filter === kind ? "default" : "outline"}
                    onClick={() => setFilter(kind)}
                  >
                    {kind === "all"
                      ? "All"
                      : kind === "weekly"
                        ? "Weekly"
                        : "Blocks"}
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
              Loading reports from Intervals.icu…
            </p>
          ) : reports.length && !mobile ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {reports.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => setOpenReportId(report.id)}
                  className="rounded-xl border bg-card p-4 text-left shadow-sm hover:bg-muted/30"
                >
                  <h2 className="font-semibold">
                    {report.kind === "weekly"
                      ? "Weekly Report"
                      : "Block Report"}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {periodLabel(report)}
                  </p>
                </button>
              ))}
            </div>
          ) : reports.length ? (
            <List
              accordionList={!mobile}
              mediaList
              inset
              strong
              dividers
              className="coach-report-list m-0"
            >
              {reports.map((report) => (
                <ListItem
                  key={report.id}
                  accordionItem={!mobile}
                  link={mobile ? "#" : undefined}
                  noChevron
                  accordionItemOpened={openReportId === report.id}
                  onClick={(event) => {
                    event.preventDefault()
                    if (mobile) {
                      reportTrigger.current = event.currentTarget
                      window.history.pushState(
                        { ...window.history.state, coachReport: report.id },
                        ""
                      )
                      sheetHistory.current = true
                      setOpenReportId(report.id)
                    } else
                      setOpenReportId((current) =>
                        current === report.id ? null : report.id
                      )
                  }}
                  onAccordionOpen={() => setOpenReportId(report.id)}
                  onAccordionClose={() =>
                    setOpenReportId((current) =>
                      current === report.id ? null : current
                    )
                  }
                  title={
                    report.kind === "weekly" ? "Weekly Report" : "Block Report"
                  }
                  subtitle={periodLabel(report)}
                >
                  <ChevronDown
                    slot="after"
                    aria-hidden="true"
                    className={`hidden size-5 text-muted-foreground transition-transform md:block ${
                      openReportId === report.id ? "rotate-180" : ""
                    }`}
                  />
                  <ChevronRight
                    slot="after"
                    aria-hidden="true"
                    className={
                      "coach-report-chevron md:hidden " +
                      (openReportId === report.id ? "rotate-90" : "")
                    }
                  />
                  {!mobile && (
                    <AccordionContent>
                      <div className="border-t px-4 py-5 md:px-6">
                        {report.kind === "weekly" ? (
                          <WeeklyReportBody report={report} />
                        ) : (
                          <BlockReportBody report={report} />
                        )}
                        <p className="mt-5 border-t pt-3 text-xs text-muted-foreground">
                          Read from Intervals.icu
                        </p>
                      </div>
                    </AccordionContent>
                  )}
                </ListItem>
              ))}
            </List>
          ) : (
            <div className="rounded-xl border bg-muted/20 p-5 text-sm text-muted-foreground">
              {catalog.reports.length
                ? `No ${filter === "weekly" ? "weekly" : "block"} reports are available.`
                : "No Section 11 report notes were found in Intervals.icu."}
            </div>
          )}
        </div>
      </MobilePullToRefresh>
      {!mobile && (
        <Dialog
          open={Boolean(openReportId)}
          onOpenChange={(open) => {
            if (!open) setOpenReportId(null)
          }}
        >
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>
                {selectedReport && periodLabel(selectedReport)}
              </DialogTitle>
            </DialogHeader>
            <div className="pb-[45vh]">
              {selectedReport &&
                (selectedReport.kind === "weekly" ? (
                  <WeeklyReportBody report={selectedReport} hideHeading />
                ) : (
                  <BlockReportBody report={selectedReport} />
                ))}
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
            className="terms-metric-sheet"
            opened={Boolean(openReportId)}
            swipeToClose
            swipeHandler=".coach-report-handle"
            backdrop
            backdropEl=".coach-report-backdrop"
            closeByBackdropClick
            closeOnEscape
            onSheetClose={closeReport}
            onSheetOpened={() =>
              reportClose.current?.focus({ preventScroll: true })
            }
            onSheetClosed={() =>
              reportTrigger.current?.focus({ preventScroll: true })
            }
            {...{
              role: "dialog",
              "aria-modal": true,
              "aria-label":
                selectedReport?.kind === "weekly"
                  ? "Weekly report"
                  : "Block report",
            }}
          >
            <div
              className="terms-metric-sheet-handle coach-report-handle"
              aria-hidden="true"
            >
              <span />
            </div>
            <div className="terms-metric-sheet-heading">
              <h2>{selectedReport && periodLabel(selectedReport)}</h2>
              <button
                ref={reportClose}
                type="button"
                className="terms-metric-sheet-close"
                aria-label="Close report"
                onClick={closeReport}
              >
                <X />
              </button>
            </div>
            <div className="terms-metric-sheet-scroll" key={openReportId}>
              {selectedReport &&
                (selectedReport.kind === "weekly" ? (
                  <WeeklyReportBody report={selectedReport} hideHeading />
                ) : (
                  <BlockReportBody report={selectedReport} />
                ))}
            </div>
          </Sheet>
        </>
      )}
    </div>
  )
}
