import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  f7ready,
  List,
  ListItem,
  Page,
  PageContent,
  Searchbar,
  Sheet,
} from "framework7-react"
import type {
  Searchbar as SearchbarModule,
  Sheet as SheetModule,
} from "framework7/types"
import { ChevronRight, Search, X } from "lucide-react"
import { MetricDetail } from "@/components/terms-reference/metric-detail"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { useIsMobile } from "@/hooks/use-mobile"
import { useSheetDismiss } from "@/hooks/use-sheet-dismiss"
import {
  formatTermsAbbreviation,
  formatTermsHeading,
  SORTED_METRIC_DEFINITIONS,
  searchMetricDefinitions,
} from "@/lib/terms-reference-data"
import { createTermsNavigation, type TermsView } from "@/lib/terms-navigation"

type SearchbarHandle = {
  el: HTMLElement | null
  f7Searchbar: () => SearchbarModule.Searchbar
}

export function MobileTermsPage({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const mobile = useIsMobile()
  const [query, setQuery] = useState("")
  const [view, setView] = useState<TermsView>({ open: false, metricId: null })
  const [displayedMetricId, setDisplayedMetricId] = useState<string | null>(
    null
  )
  const searchbar = useRef<SearchbarHandle>({
    el: null,
    f7Searchbar: () => null!,
  })
  const sheet = useRef<{
    el: HTMLElement | null
    f7Sheet: () => SheetModule.Sheet
  }>({ el: null, f7Sheet: () => null! })
  const closeButton = useRef<HTMLButtonElement>(null)
  const metricTrigger = useRef<HTMLElement | null>(null)
  const changed = useRef(onOpenChange)
  changed.current = onOpenChange
  const [navigation] = useState(() =>
    createTermsNavigation(
      window.history,
      (next) => {
        if (!next.open) sheet.current?.f7Sheet()?.close(false)
        setView(next)
        if (next.metricId || !next.open) setDisplayedMetricId(next.metricId)
        changed.current(next.open)
      },
      crypto.randomUUID()
    )
  )
  const filteredMetrics = useMemo(() => searchMetricDefinitions(query), [query])
  const metric = SORTED_METRIC_DEFINITIONS.find(
    (item) => item.id === displayedMetricId
  )

  useEffect(() => {
    const pop = (event: PopStateEvent) => {
      // This overlay does not navigate the underlying workout, calendar or tab.
      // Handle its history before the application's route restoration listeners.
      if (navigation.pop(event.state)) event.stopImmediatePropagation()
    }
    const keydown = (event: KeyboardEvent) => {
      const current = navigation.current()
      if (!current.open) return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopImmediatePropagation()
        navigation.back()
        return
      }
      if (event.key !== "Tab") return
      const root = document.querySelector(
        current.metricId
          ? "#terms-mobile-layer .terms-metric-sheet"
          : "#terms-mobile-layer .terms-mobile-page"
      )
      const targets = [
        ...(root?.querySelectorAll<HTMLElement>(
          'button, input, a[href], [tabindex="0"]'
        ) || []),
      ].filter(
        (element) =>
          element.getClientRects().length &&
          getComputedStyle(element).visibility !== "hidden"
      )
      const first = targets[0],
        last = targets.at(-1)
      if (
        first &&
        last &&
        ((event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last))
      ) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus({ preventScroll: true })
      }
    }
    window.addEventListener("popstate", pop, true)
    window.addEventListener("keydown", keydown, true)
    return () => {
      window.removeEventListener("popstate", pop, true)
      window.removeEventListener("keydown", keydown, true)
    }
  }, [navigation])

  useLayoutEffect(() => {
    if (mobile && open) navigation.open()
    if (!mobile && navigation.current().open) navigation.dismiss()
  }, [mobile, open, navigation])

  useLayoutEffect(() => {
    if (!mobile || !open) return
    const body = document.body
    const originalStyle = body.getAttribute("style")
    const originalRestoration = history.scrollRestoration
    const x = window.scrollX,
      y = window.scrollY
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    history.scrollRestoration = "manual"
    Object.assign(body.style, {
      position: "fixed",
      top: `-${y}px`,
      left: `-${x}px`,
      width: "100%",
      overflow: "hidden",
    })
    let cancelled = false
    f7ready(() => {
      if (cancelled) return
      const instance = searchbar.current?.f7Searchbar()
      instance?.inputEl.setAttribute("aria-label", "Search training metrics")
      instance?.disable()
      setQuery("")
    })
    return () => {
      cancelled = true
      if (originalStyle === null) body.removeAttribute("style")
      else body.setAttribute("style", originalStyle)
      window.scrollTo({ left: x, top: y, behavior: "instant" })
      history.scrollRestoration = originalRestoration
      focused?.focus({ preventScroll: true })
    }
  }, [mobile, open])

  const closeMetric = useCallback(() => {
    if (navigation.current().metricId) navigation.back()
  }, [navigation])
  useSheetDismiss("terms-mobile-layer", Boolean(view.metricId), closeMetric)
  const openMetric = (id: string, trigger: HTMLElement) => {
    metricTrigger.current = trigger
    searchbar.current?.f7Searchbar()?.inputEl.blur()
    navigation.metric(id)
  }
  if (!open || (!mobile && !view.open)) return null
  const activateSearch = () => {
    const instance = searchbar.current?.f7Searchbar()
    if (!instance) return
    // Make the expandable input visible before focusing within the tap gesture.
    searchbar.current.el?.classList.add("searchbar-enabled")
    instance.enable()
    // Commit the visibility change before requesting focus on the same gesture.
    const input = searchbar.current.el?.querySelector<HTMLInputElement>(
      'input[type="search"]'
    )
    input?.getBoundingClientRect()
    input?.focus({ preventScroll: true })
  }

  return (
    <div id="terms-mobile-layer" className="contents" hidden={!mobile}>
      <div className="terms-page-backing" aria-hidden="true" />
      <Page
        name="terms"
        noSwipeback
        pageContent={false}
        className="terms-mobile-page"
        {...{
          role: "dialog",
          "aria-modal": true,
          "aria-label": "Terms and definitions",
          inert: Boolean(metric),
        }}
      >
        <MobileSiteNavbar
          className="terms-mobile-navbar"
          title="Terms"
          onBack={() => navigation.back()}
          backLabel="Back from terms"
          showMenu={false}
          right={
            <button
              type="button"
              className="mobile-navbar-action"
              aria-label="Expand metric search"
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                activateSearch()
              }}
            >
              <Search aria-hidden="true" />
            </button>
          }
        >
          <Searchbar
            ref={searchbar}
            expandable
            form={false}
            customSearch
            backdrop={false}
            disableButton={false}
            clearButton={false}
            value={query}
            placeholder="Search metrics"
            onInput={(event) => setQuery(event.target.value)}
            onSearchbarClear={() => setQuery("")}
            onSearchbarDisable={() => setQuery("")}
          >
            <Search
              slot="input-wrap-start"
              className="terms-search-icon"
              aria-hidden="true"
            />
            {query && (
              <button
                slot="input-wrap-end"
                type="button"
                className="mobile-navbar-action terms-search-clear"
                aria-label="Clear metric search"
                onClick={() => {
                  searchbar.current?.f7Searchbar()?.clear()
                  setQuery("")
                }}
              >
                <X aria-hidden="true" />
              </button>
            )}
            <button
              slot="inner-end"
              type="button"
              className="mobile-navbar-action terms-search-collapse"
              aria-label="Collapse metric search"
              onClick={() => searchbar.current?.f7Searchbar()?.disable()}
            >
              <X aria-hidden="true" />
            </button>
          </Searchbar>
        </MobileSiteNavbar>
        <PageContent className="terms-mobile-content">
          {filteredMetrics.length ? (
            <List
              className="terms-mobile-metric-list"
              mediaList
              insetIos
              dividersIos
              strongIos
            >
              {filteredMetrics.map((item) => (
                <ListItem
                  key={item.id}
                  link="#"
                  noChevron
                  onClick={(event) => {
                    event.preventDefault()
                    openMetric(item.id, event.currentTarget)
                  }}
                  title={
                    item.abbreviation
                      ? formatTermsAbbreviation(item.abbreviation)
                      : formatTermsHeading(item.name)
                  }
                  subtitle={formatTermsHeading(
                    item.abbreviation
                      ? item.name
                      : item.category || "Other Training Metrics"
                  )}
                >
                  <ChevronRight
                    slot="after"
                    className="terms-metric-chevron"
                    aria-hidden="true"
                  />
                </ListItem>
              ))}
            </List>
          ) : (
            <p className="terms-mobile-empty" role="status">
              No metrics match “{query}”.
            </p>
          )}
        </PageContent>
      </Page>
      <div
        className={
          "terms-metric-backdrop sheet-backdrop" +
          (view.metricId ? " backdrop-in" : "")
        }
        aria-hidden="true"
        onClick={closeMetric}
      />
      <Sheet
        ref={sheet}
        containerEl="#terms-mobile-layer"
        className="terms-metric-sheet"
        opened={Boolean(view.metricId)}
        backdrop
        backdropEl="#terms-mobile-layer .terms-metric-backdrop"
        closeByBackdropClick
        closeOnEscape
        {...{
          role: "dialog",
          "aria-modal": true,
          "aria-labelledby": "terms-metric-title",
        }}
        onSheetOpened={() =>
          closeButton.current?.focus({ preventScroll: true })
        }
        onSheetClose={closeMetric}
        onSheetClosed={() => {
          if (!navigation.current().metricId) {
            setDisplayedMetricId(null)
            requestAnimationFrame(() =>
              metricTrigger.current?.focus({ preventScroll: true })
            )
          }
        }}
      >
        {metric && (
          <>
            <div className="terms-metric-sheet-handle" aria-hidden="true">
              <span />
            </div>
            <div className="terms-metric-sheet-heading">
              <div className="min-w-0">
                {metric.abbreviation && (
                  <p className="terms-metric-sheet-abbreviation">
                    {formatTermsAbbreviation(metric.abbreviation)}
                  </p>
                )}
                <h2 id="terms-metric-title">
                  {formatTermsHeading(metric.name)}
                </h2>
              </div>
              <button
                ref={closeButton}
                type="button"
                className="terms-metric-sheet-close"
                aria-label="Close metric details"
                onClick={closeMetric}
              >
                <X aria-hidden="true" />
              </button>
            </div>
            <div
              className="terms-metric-sheet-scroll"
              data-sheet-scroll
              tabIndex={0}
              aria-label="Metric details"
            >
              <MetricDetail metric={metric} compact />
            </div>
          </>
        )}
      </Sheet>
    </div>
  )
}
