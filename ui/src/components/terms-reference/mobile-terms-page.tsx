import { useEffect, useMemo, useRef, useState } from "react"
import {
  List,
  ListItem,
  NavLeft,
  NavRight,
  NavTitle,
  Navbar,
  Page,
  PageContent,
  Searchbar,
  Sheet,
} from "framework7-react"
import type { Searchbar as F7SearchbarModule } from "framework7/types"
import { ChevronLeft, X } from "lucide-react"

import { MetricDetail } from "@/components/terms-reference/metric-detail"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  SORTED_METRIC_DEFINITIONS,
  type MetricDefinition,
} from "@/lib/terms-reference-data"

type SearchbarHandle = {
  el: HTMLElement | null
  f7Searchbar: () => F7SearchbarModule.Searchbar
}

const termsHistoryState = "ar-performance-terms"

function metricSearchText(metric: MetricDefinition) {
  return [
    metric.name,
    metric.abbreviation,
    metric.definition,
    metric.phase,
    ...(metric.notes || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
}

export function MobileTermsPage({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const mobile = useIsMobile()
  const [query, setQuery] = useState("")
  const [selectedMetric, setSelectedMetric] = useState<MetricDefinition | null>(
    null
  )
  const [sheetOpen, setSheetOpen] = useState(false)
  const searchbar = useRef<SearchbarHandle>({
    el: null,
    f7Searchbar: () => null as unknown as F7SearchbarModule.Searchbar,
  })
  const historyMarker = useRef(false)

  const filteredMetrics = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return SORTED_METRIC_DEFINITIONS
    return SORTED_METRIC_DEFINITIONS.filter((metric) =>
      metricSearchText(metric).includes(normalizedQuery)
    )
  }, [query])

  useEffect(() => {
    if (!mobile || !open || historyMarker.current) return
    window.history.pushState(
      { ...(window.history.state || {}), [termsHistoryState]: true },
      "",
      window.location.href
    )
    historyMarker.current = true
  }, [mobile, open])

  useEffect(() => {
    if (!mobile || !open) return
    const expand = () => searchbar.current?.f7Searchbar()?.enable()
    const frame = window.requestAnimationFrame(expand)
    const retry = window.setTimeout(expand, 80)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(retry)
    }
  }, [mobile, open])

  useEffect(() => {
    if (!mobile || !open) return
    const handlePopState = () => {
      if (!historyMarker.current) return
      if (sheetOpen) {
        setSheetOpen(false)
        window.history.pushState(
          { ...(window.history.state || {}), [termsHistoryState]: true },
          "",
          window.location.href
        )
        return
      }
      historyMarker.current = false
      onClose()
    }
    window.addEventListener("popstate", handlePopState)
    return () => window.removeEventListener("popstate", handlePopState)
  }, [mobile, onClose, open, sheetOpen])

  useEffect(() => {
    if (open) return
    setSheetOpen(false)
    setSelectedMetric(null)
  }, [open])

  if (!mobile || !open) return null

  const closeTerms = () => {
    if (sheetOpen) {
      setSheetOpen(false)
      return
    }
    if (historyMarker.current) {
      window.history.back()
      return
    }
    onClose()
  }

  const openMetric = (metric: MetricDefinition) => {
    setSelectedMetric(metric)
    requestAnimationFrame(() => setSheetOpen(true))
  }

  return (
    <>
      <Page
        name="terms"
        noSwipeback
        className="terms-mobile-page"
        aria-label="Terms and definitions"
      >
        <Navbar className="terms-mobile-navbar">
          <NavLeft>
            <button
              type="button"
              className="terms-mobile-back mobile-navbar-action"
              aria-label={sheetOpen ? "Close metric details" : "Back"}
              onClick={closeTerms}
            >
              <ChevronLeft aria-hidden="true" />
            </button>
          </NavLeft>
          <NavTitle>
            <h1>Terms &amp; definitions</h1>
          </NavTitle>
          <NavRight>
            <span className="terms-mobile-count" aria-live="polite">
              {filteredMetrics.length}
            </span>
          </NavRight>
          <Searchbar
            ref={searchbar}
            expandable
            form={false}
            customSearch
            value={query}
            placeholder="Search metrics or abbreviations"
            aria-label="Search training metrics"
            clearButton
            onInput={(event) => setQuery(event?.target?.value || "")}
            onSearchbarClear={() => setQuery("")}
          />
        </Navbar>

        <PageContent className="terms-mobile-content">
          <div className="terms-mobile-intro">
            <p className="text-sm font-semibold">Training metrics</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Search by metric name or shorthand, then open a metric for its
              supported ranges and essential notes.
            </p>
          </div>
          {filteredMetrics.length ? (
            <List
              className="terms-mobile-metric-list"
              mediaList
              dividersIos
              strongIos
            >
              {filteredMetrics.map((metric) => (
                <ListItem
                  key={metric.id}
                  link
                  title={metric.name}
                  subtitle={metric.abbreviation || metric.category}
                  after="View"
                  onClick={() => openMetric(metric)}
                />
              ))}
            </List>
          ) : (
            <div className="terms-mobile-empty" role="status">
              No metrics match “{query}”. Try a full name or shorthand.
            </div>
          )}
        </PageContent>
      </Page>

      {selectedMetric && (
        <Sheet
          className="terms-metric-sheet"
          opened={sheetOpen}
          swipeToClose
          swipeHandler=".terms-metric-sheet-handle"
          backdrop
          closeByBackdropClick
          closeOnEscape
          onSheetClosed={() => {
            setSheetOpen(false)
            setSelectedMetric(null)
          }}
        >
          <div
            className="terms-metric-sheet-handle"
            aria-label="Drag to close"
            role="button"
            tabIndex={0}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                setSheetOpen(false)
              }
            }}
          >
            <span aria-hidden="true" />
          </div>
          <div className="terms-metric-sheet-heading">
            <div className="min-w-0">
              {selectedMetric.abbreviation && (
                <p className="terms-metric-sheet-abbreviation">
                  {selectedMetric.abbreviation}
                </p>
              )}
              <h2>{selectedMetric.name}</h2>
            </div>
            <button
              type="button"
              className="terms-metric-sheet-close"
              aria-label="Close metric details"
              onClick={() => setSheetOpen(false)}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <div className="terms-metric-sheet-scroll">
            <MetricDetail metric={selectedMetric} compact />
          </div>
        </Sheet>
      )}
    </>
  )
}
