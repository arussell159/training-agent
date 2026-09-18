import { useMemo, useRef, useState } from "react"
import { BookOpen, Search } from "lucide-react"

import { MetricDetail } from "@/components/terms-reference/metric-detail"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useIsMobile } from "@/hooks/use-mobile"
import { SORTED_METRIC_DEFINITIONS } from "@/lib/terms-reference-data"

const categoryOptions = [
  ...new Set(
    SORTED_METRIC_DEFINITIONS.map(
      (metric) => metric.category || "Other training metrics"
    )
  ),
]

function metricSearchText(metric: (typeof SORTED_METRIC_DEFINITIONS)[number]) {
  return [
    metric.name,
    metric.abbreviation,
    metric.definition,
    metric.category,
    metric.phase,
    ...(metric.notes || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}
export function TermsReferenceDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mobile = useIsMobile()
  const [query, setQuery] = useState("")
  const [category, setCategory] = useState("all")
  const popup = useRef<HTMLDivElement>(null)

  const filteredMetrics = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return SORTED_METRIC_DEFINITIONS.filter((metric) => {
      const matchesCategory =
        category === "all" || metric.category === category
      return (
        matchesCategory &&
        (!normalizedQuery || metricSearchText(metric).includes(normalizedQuery))
      )
    })
  }, [category, query])

  // The mobile version is a Framework7 Page rendered by MobileTermsPage. Do
  // not let the desktop dialog's portal cover it on narrow viewports.
  if (mobile) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={popup}
        initialFocus={popup}
        className="terms-reference-dialog flex min-h-0 w-[calc(100vw-1.5rem)] max-w-none min-w-0 flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl"
      >
        <div className="min-w-0 shrink-0 border-b bg-background px-4 py-3 sm:px-6">
          <DialogHeader className="pr-8">
            <DialogTitle className="flex items-center gap-2 text-base leading-snug sm:text-lg">
              <BookOpen className="size-5 shrink-0 text-primary" />
              Section 11 terms &amp; ranges
            </DialogTitle>
            <DialogDescription className="sr-only sm:not-sr-only">
              Search the shorthand, formulas, thresholds, and race-week ranges
              used in your reports. Your current page stays open underneath this
              lookup.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <label className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search e.g. ACWR, HRV, TSB, cardiac drift…"
                aria-label="Search Section 11 terms"
                className="h-9 pl-9 text-base md:text-sm"
              />
            </label>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              aria-label="Filter terms by category"
              className="h-9 max-w-full min-w-0 truncate rounded-lg border border-input bg-background px-2.5 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:max-w-80 md:text-sm"
            >
              <option value="all">All training metrics</option>
              {categoryOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {filteredMetrics.length}{" "}
            {filteredMetrics.length === 1 ? "metric" : "metrics"}
          </p>
        </div>

        <div
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
          aria-label="Terms definitions"
          tabIndex={0}
        >
          <div className="space-y-3 p-4 sm:p-6">
            {filteredMetrics.length ? (
              filteredMetrics.map((metric) => (
                <article
                  key={metric.id}
                  className="min-w-0 rounded-xl border bg-card p-4 break-words shadow-xs"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      {metric.abbreviation && (
                        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                          {metric.abbreviation}
                        </p>
                      )}
                      <h2 className="font-semibold tracking-tight">
                        {metric.name}
                      </h2>
                    </div>
                    <Badge
                      variant="secondary"
                      className="max-w-full font-normal whitespace-normal"
                    >
                      {metric.category}
                    </Badge>
                  </div>
                  <div className="mt-3">
                    <MetricDetail metric={metric} />
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                No metrics match “{query}”. Try a shorthand, metric, or race
                countdown day.
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
