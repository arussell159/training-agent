import { TableSkeleton } from "@/components/loading-layouts"
import { Skeleton } from "@/components/ui/skeleton"
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  ArrowDown,
  ArrowUp,
  Bike,
  CalendarDays,
  Check,
  ChevronDown,
  Columns3,
  Dumbbell,
  Footprints,
  ListFilter,
  Search,
  Waves,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { WorkoutReportCompare } from "@/components/workout-report-compare"
import { useIsMobile } from "@/hooks/use-mobile"
import "./workout-reports.css"
import { apiFetch } from "@/lib/api-client"
import {
  cachedTrainingContext,
  type PlannedWorkout,
  type TrainingContext,
} from "@/lib/training-context"
import {
  availability,
  changeDistanceUnit,
  columnById,
  completedActivities,
  dateBounds,
  emptyFilters,
  filterActivities,
  filterErrors,
  knownColumnIds,
  reportColumns,
  resolveColumns,
  sortActivities,
  totals,
  type DistanceUnit,
  type ReportFilters,
  type ReportWorkout,
} from "@/lib/workout-reports-model"

type Sort = { id: string; direction: "asc" | "desc" }
type View = {
  filters: ReportFilters
  manual: Record<string, string[]>
  sort: Sort
  scrollY: number
  scrollX: number
}
const viewKey = "workout-reports-view-v1"
const preferenceKey = "workout_report_columns_v1"
const desktopColumnDropPriority = [
  "elevation_gain",
  "elevation_loss",
  "humidity_percent",
  "temperature_c",
  "calories",
  "work_kj",
  "min_speed",
  "min_hr",
  "min_cadence",
  "min_power",
  "max_speed",
  "max_hr",
  "max_cadence",
  "max_power",
  "average_speed",
  "normalized_power",
  "elapsed_pace",
  "elapsed_time_seconds",
  "intensity_factor",
  "tss",
]
const initialView = (): View => {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(viewKey) || "null"
    ) as Partial<View> | null
    return {
      filters: { ...emptyFilters, ...saved?.filters },
      manual: saved?.manual || {},
      sort: saved?.sort || { id: "date", direction: "desc" },
      scrollY: saved?.scrollY || 0,
      scrollX: saved?.scrollX || 0,
    }
  } catch {
    return {
      filters: emptyFilters,
      manual: {},
      sort: { id: "date", direction: "desc" },
      scrollY: 0,
      scrollX: 0,
    }
  }
}
const rangeOptions = [
  ["all", "All time"],
  ["7", "Last 7 days"],
  ["30", "Last 30 days"],
  ["90", "Last 90 days"],
  ["year", "This year"],
  ["custom", "Custom dates"],
] as const
const inputClass =
  "h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
const selectClass = `${inputClass} cursor-pointer`
const filterFieldClass =
  "min-w-0 rounded-xl border border-input bg-card px-3 py-1.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30"
const filterControlClass =
  "h-6 w-full min-w-0 border-0 bg-transparent p-0 text-sm outline-none"
function SportIcon({ sport }: { sport: string }) {
  const base = "size-4 shrink-0"
  if (/swim/i.test(sport))
    return <Waves aria-hidden="true" className={`${base} text-cyan-600`} />
  if (/bike|ride|brick/i.test(sport))
    return <Bike aria-hidden="true" className={`${base} text-violet-600`} />
  if (/run/i.test(sport))
    return <Footprints aria-hidden="true" className={`${base} text-lime-600`} />
  if (/strength/i.test(sport))
    return <Dumbbell aria-hidden="true" className={`${base} text-orange-600`} />
  return (
    <CalendarDays aria-hidden="true" className={`${base} text-slate-500`} />
  )
}
function Editor({
  mobile,
  title,
  open,
  onClose,
  children,
}: {
  mobile: boolean
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  if (mobile)
    return (
      <Drawer
        open={open}
        swipeDirection="down"
        showSwipeHandle
        onOpenChange={(value) => {
          if (!value) onClose()
        }}
      >
        <DrawerContent
          className="workout-report-editor z-[1001] !max-h-[min(88dvh,800px)] !w-full min-w-0 overflow-hidden rounded-t-2xl"
        >
          <DrawerTitle className="sr-only">{title}</DrawerTitle>
          {children}
        </DrawerContent>
      </Drawer>
    )
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="workout-report-editor flex max-h-[min(85dvh,800px)] flex-col gap-0 p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  )
}
function EditorHeader({
  title,
  onCancel,
  onApply,
  disabled = false,
}: {
  title: string
  onCancel: () => void
  onApply: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex min-w-0 shrink-0 items-center justify-between border-b px-3 py-2">
      <Button
        type="button"
        variant="ghost"
        className="!size-11 !max-w-11 !min-w-11 !flex-none"
        aria-label={`Cancel ${title}`}
        onClick={onCancel}
      >
        <X />
      </Button>
      <h2 className="min-w-0 flex-1 text-center font-semibold">{title}</h2>
      <Button
        type="button"
        variant="ghost"
        className="!size-11 !max-w-11 !min-w-11 !flex-none"
        aria-label={`Apply ${title}`}
        disabled={disabled}
        onClick={onApply}
      >
        <Check />
      </Button>
    </div>
  )
}
function FilterField({
  label,
  error,
  children,
}: {
  label: string
  error?: string
  children: ReactNode
}) {
  return (
    <label className="min-w-0 text-sm">
      <span className={`block ${filterFieldClass}`}>
        <span className="block text-[11px] leading-4 text-muted-foreground">
          {label}
        </span>
        {children}
      </span>
      {error && <span className="mt-1 block text-xs text-destructive">{error}</span>}
    </label>
  )
}
function FilterFields({
  value,
  onChange,
  errors,
  timeZone,
}: {
  value: ReportFilters
  onChange: (v: ReportFilters) => void
  errors: Record<string, string>
  timeZone: string
}) {
  const set = (key: keyof ReportFilters, text: string) =>
    onChange({ ...value, [key]: text })
  const bounds = dateBounds(value, new Date(), timeZone)
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <FilterField label="Date range">
        <span className="relative block">
          <select
            className={`${filterControlClass} appearance-none pr-6`}
            value={value.range}
            onChange={(e) => set("range", e.target.value)}
          >
            {rangeOptions.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-0 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </span>
      </FilterField>
      <FilterField label="Distance unit">
        <span className="relative block">
          <select
            className={`${filterControlClass} appearance-none pr-6`}
            value={value.distanceUnit}
            onChange={(e) =>
              onChange(changeDistanceUnit(value, e.target.value as DistanceUnit))
            }
          >
            <option value="mi">Miles</option>
            <option value="km">Kilometers</option>
            <option value="yd">Yards</option>
            <option value="m">Meters</option>
          </select>
          <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-0 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        </span>
      </FilterField>
      {value.range === "custom" && (
        <>
          <FilterField label="Start date" error={errors.start}>
            <input
              type="date"
              className={filterControlClass}
              value={value.start}
              onChange={(e) => set("start", e.target.value)}
            />
          </FilterField>
          <FilterField label="End date" error={errors.end}>
            <input
              type="date"
              className={filterControlClass}
              value={value.end}
              onChange={(e) => set("end", e.target.value)}
            />
          </FilterField>
        </>
      )}
      {value.range !== "all" && value.range !== "custom" && (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          {bounds.start} to {bounds.end}, inclusive in your athlete time zone.
        </p>
      )}
      {(["minDistance", "maxDistance"] as const).map((key, index) => (
        <FilterField key={key} label={`${index ? "Maximum" : "Minimum"} distance (${value.distanceUnit})`} error={errors[key]}>
          <input
            type="text"
            inputMode="decimal"
            className={filterControlClass}
            value={value[key]}
            onChange={(e) => set(key, e.target.value)}
            placeholder="No limit"
          />
        </FilterField>
      ))}
      {(["minDuration", "maxDuration"] as const).map((key, index) => (
        <FilterField key={key} label={`${index ? "Maximum" : "Minimum"} moving time`} error={errors[key]}>
          <input
            type="text"
            inputMode="numeric"
            className={filterControlClass}
            value={value[key]}
            onChange={(e) => set(key, e.target.value)}
            placeholder="h:mm:ss, m:ss, or minutes"
          />
        </FilterField>
      ))}
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Duration filters and totals use moving time. Leave a boundary blank for
        no limit.
      </p>
    </div>
  )
}

export function WorkoutReportsPage({
  onWorkoutOpen,
}: {
  onWorkoutOpen: (workout: PlannedWorkout) => void
}) {
  const mobile = useIsMobile()
  const [view, setView] = useState<View>(initialView)
  const [context, setContext] = useState<TrainingContext | null>(() => {
    const cached = cachedTrainingContext()
    return cached.context_scope === "full" ? cached : null
  })
  const [loading, setLoading] = useState(true),
    [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(""),
    [preferenceError, setPreferenceError] = useState("")
  const [saved, setSaved] = useState<Record<string, string[]>>({}),
    [preferencesLoaded, setPreferencesLoaded] = useState(false),
    [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<"filters" | "columns" | null>(null)
  const [draftFilters, setDraftFilters] = useState<ReportFilters>(emptyFilters)
  const [draftColumns, setDraftColumns] = useState<string[]>([]),
    [search, setSearch] = useState("")
  const [comparedWorkoutIds, setComparedWorkoutIds] = useState<string[]>([])
  const [comparing, setComparing] = useState(false)
  const [reportTableWidth, setReportTableWidth] = useState(0)
  const tableRef = useRef<HTMLDivElement>(null),
    latestRequest = useRef(0),
    restored = useRef(false),
    lastQuery = useRef({ filters: view.filters, sort: view.sort })
  const timeZone = context?.athlete.time_zone || "America/Chicago"
  const patchView = (patch: Partial<View>) =>
    setView((current) => ({ ...current, ...patch }))
  const load = useCallback((refresh = false) => {
    const request = ++latestRequest.current
    if (refresh) setRefreshing(true)
    else setLoading(true)
    setLoadError("")
    const controller = new AbortController()
    void apiFetch("/api/training-context?scope=full", {
      signal: controller.signal,
      cache: refresh ? "no-store" : "default",
    })
      .then(async (response) => {
        const result = (await response.json()) as TrainingContext & {
          error?: string
        }
        if (!response.ok)
          throw Error(
            result.error || `History request failed (${response.status}).`
          )
        if (result.context_scope !== "full")
          throw Error("Complete retained history is unavailable.")
        return result
      })
      .then((result) => {
        if (request === latestRequest.current) setContext(result)
      })
      .catch((error) => {
        if (request === latestRequest.current && error.name !== "AbortError")
          setLoadError(
            error instanceof Error ? error.message : "History is unavailable."
          )
      })
      .finally(() => {
        if (request === latestRequest.current) {
          setLoading(false)
          setRefreshing(false)
        }
      })
    return controller
  }, [])
  useEffect(() => {
    const controller = load()
    return () => {
      ++latestRequest.current
      controller.abort()
    }
  }, [load])
  useEffect(() => {
    if (lastQuery.current.filters === view.filters && lastQuery.current.sort === view.sort) return
    lastQuery.current = { filters: view.filters, sort: view.sort }
    const controller = load(true)
    return () => {
      ++latestRequest.current
      controller.abort()
    }
  }, [view.filters, view.sort, load])
  useEffect(() => {
    const controller = new AbortController()
    void apiFetch("/api/training-preferences", { signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as {
          training_preferences?: Record<string, unknown>
          error?: string
        }
        if (!response.ok)
          throw Error(result.error || "Could not load saved columns.")
        return result
      })
      .then((result) => {
        if (controller.signal.aborted) return
        const stored = result.training_preferences?.[preferenceKey]
        if (stored && typeof stored === "object" && !Array.isArray(stored))
          setSaved(
            Object.fromEntries(
              Object.entries(stored).map(([sport, ids]) => [
                sport,
                knownColumnIds(ids),
              ])
            )
          )
        setPreferencesLoaded(true)
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setPreferenceError(
            error instanceof Error
              ? error.message
              : "Could not load saved columns."
          )
          setPreferencesLoaded(true)
        }
      })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    try {
      sessionStorage.setItem(viewKey, JSON.stringify(view))
    } catch {
      /* view state is optional */
    }
  }, [view])
  useEffect(() => {
    if (!loading && preferencesLoaded && context && !restored.current) {
      restored.current = true
      requestAnimationFrame(() => {
        window.scrollTo({ top: view.scrollY, behavior: "instant" })
        if (tableRef.current) tableRef.current.scrollLeft = view.scrollX
      })
    }
  }, [loading, preferencesLoaded, context, view.scrollY, view.scrollX])
  useEffect(() => {
    const table = tableRef.current
    const remember = () => {
      const y = window.scrollY,
        x = table?.scrollLeft || 0
      setView((current) => ({ ...current, scrollY: y, scrollX: x }))
    }
    window.addEventListener("pagehide", remember)
    return () => {
      window.removeEventListener("pagehide", remember)
      try {
        const current = JSON.parse(sessionStorage.getItem(viewKey) || "{}")
        sessionStorage.setItem(
          viewKey,
          JSON.stringify({
            ...current,
            scrollY: window.scrollY,
            scrollX: table?.scrollLeft || 0,
          })
        )
      } catch {
        /* optional */
      }
    }
  }, [])
  const workouts = useMemo(
    () => completedActivities((context?.history || []) as ReportWorkout[]),
    [context]
  )
  const comparisonWorkouts = useMemo(
    () => comparedWorkoutIds.flatMap((id) => {
      const workout = workouts.find((entry) => entry.id === id)
      return workout ? [workout] : []
    }),
    [comparedWorkoutIds, workouts]
  )
  const sports = useMemo(
    () => [...new Set(workouts.map((w) => w.sport))].sort(),
    [workouts]
  )
  const errors = filterErrors(view.filters, new Date(), timeZone)
  const matching = useMemo(
    () => filterActivities(workouts, view.filters, new Date(), timeZone),
    [workouts, view.filters, timeZone]
  )
  const counts = useMemo(() => availability(matching), [matching])
  const sportKey = view.filters.sport
  const { ids: selectedIds } = resolveColumns(
    view.manual,
    saved,
    sportKey,
    matching,
    counts
  )
  const visibleIds = useMemo(() => {
    if (mobile || !selectedIds.length) return selectedIds
    const capacity = Math.max(
      1,
      Math.floor(((reportTableWidth || 1280) - 220) / 112)
    )
    const visible = [...selectedIds]
    while (visible.length > capacity) {
      const removable = desktopColumnDropPriority.find(
        (id) => visible.includes(id) && id !== view.sort.id
      )
      if (removable) {
        visible.splice(visible.indexOf(removable), 1)
        continue
      }
      let lastRemovable = visible.length - 1
      while (lastRemovable >= 0 && visible[lastRemovable] === view.sort.id)
        lastRemovable -= 1
      if (lastRemovable < 0) break
      visible.splice(lastRemovable, 1)
    }
    return visible
  }, [mobile, reportTableWidth, selectedIds, view.sort.id])
  const ordered = useMemo(
    () => sortActivities(matching, view.sort.id, view.sort.direction),
    [matching, view.sort]
  )
  const sum = useMemo(() => totals(matching), [matching])
  useEffect(() => {
    const table = tableRef.current
    if (mobile || !table) return
    const observer = new ResizeObserver(([entry]) => {
      setReportTableWidth(Math.floor(entry.contentRect.width))
    })
    observer.observe(table)
    return () => observer.disconnect()
  }, [mobile, loading, matching.length])
  const filterChips: { key: string; label: string; remove: () => void }[] = []
  if (view.filters.sport !== "all")
    filterChips.push({
      key: "sport",
      label: view.filters.sport,
      remove: () => changeSport("all"),
    })
  if (view.filters.range !== "all")
    filterChips.push({
      key: "date",
      label:
        rangeOptions.find(([id]) => id === view.filters.range)?.[1] || "Dates",
      remove: () =>
        patchView({
          filters: { ...view.filters, range: "all", start: "", end: "" },
        }),
    })
  for (const [key, label] of [
    ["minDistance", "Distance ≥"],
    ["maxDistance", "Distance ≤"],
    ["minDuration", "Moving ≥"],
    ["maxDuration", "Moving ≤"],
  ] as const)
    if (view.filters[key])
      filterChips.push({
        key,
        label: `${label} ${view.filters[key]}${key.includes("Distance") ? ` ${view.filters.distanceUnit}` : ""}`,
        remove: () =>
          patchView({ filters: { ...view.filters, [key]: "" } }),
      })
  const openEditor = (kind: "filters" | "columns") => {
    if (kind === "filters") setDraftFilters({ ...view.filters })
    else {
      setDraftColumns([...selectedIds])
      setSearch("")
    }
    setEditor(kind)
  }
  const saveDefaults = async (next: Record<string, string[]>) => {
    setSaving(true)
    setPreferenceError("")
    try {
      const response = await apiFetch("/api/training-preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          training_preferences: { [preferenceKey]: next },
        }),
      })
      const result = (await response.json()) as { error?: string }
      if (!response.ok) throw Error(result.error || "Could not save columns.")
      setSaved(next)
      setView((current) => {
        const manual = { ...current.manual }
        delete manual[sportKey]
        return { ...current, manual }
      })
      setEditor(null)
    } catch (error) {
      setPreferenceError(
        error instanceof Error ? error.message : "Could not save columns."
      )
    } finally {
      setSaving(false)
    }
  }
  const changeSport = (sport: string) =>
    patchView({
      filters: {
        ...changeDistanceUnit(view.filters, /swim/i.test(sport) ? "yd" : "mi"),
        sport,
      },
    })
  const toggleSort = (id: string) =>
    patchView({
      sort: {
        id,
        direction:
          view.sort.id === id && view.sort.direction === "asc" ? "desc" : "asc",
      },
    })
  if (comparing && comparisonWorkouts.length >= 2 && !mobile) {
    return (
      <WorkoutReportCompare
        workouts={comparisonWorkouts}
        onBack={() => setComparing(false)}
        onWorkoutOpen={onWorkoutOpen}
      />
    )
  }
  return (
    <section className="flex min-w-0 flex-1 flex-col bg-background">
      <MobileSiteNavbar
        title="Workout Reports"
        backLabel="Back to More"
        onBack={() =>
          window.history.length > 1
            ? window.history.back()
            : window.dispatchEvent(
                new CustomEvent("app-navigate", { detail: "Settings" })
              )
        }
      />
      <div className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">
        <div className="mb-5 hidden md:block">
          <h2 className="text-2xl font-semibold tracking-tight">
            Workout Reports
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Completed workouts in your available training history.
          </p>
        </div>
        <div className="mb-4 grid min-w-0 grid-cols-2 items-end gap-2 sm:flex sm:flex-wrap">
          <div className="col-span-2 grid min-w-0 gap-1 sm:min-w-[135px] sm:flex-none">
            <Label htmlFor="workout-report-sport" className="text-xs font-medium">Sport</Label>
            {mobile ? (
              <select
                id="workout-report-sport"
                className={`${selectClass} w-full`}
                value={view.filters.sport}
                onChange={(e) => changeSport(e.target.value)}
              >
                <option value="all">All sports</option>
                {sports.map((sport) => (
                  <option key={sport} value={sport}>{sport}</option>
                ))}
              </select>
            ) : (
              <Select value={view.filters.sport} onValueChange={(sport) => { if (sport) changeSport(sport) }}>
                <SelectTrigger
                  id="workout-report-sport"
                  className="!h-11 w-full min-w-[135px] border-border bg-background font-medium dark:border-input dark:bg-input/30"
                >
                  <SelectValue>{view.filters.sport === "all" ? "All sports" : view.filters.sport}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All sports</SelectItem>
                  {sports.map((sport) => (
                    <SelectItem key={sport} value={sport}>{sport}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <Button
            variant="outline"
            className="!h-11 !w-full gap-2 sm:!w-auto"
            onClick={() => openEditor("filters")}
          >
            <ListFilter /> Filters
          </Button>
          <Button
            variant="outline"
            className="!h-11 !w-full gap-2 sm:!w-auto"
            onClick={() => openEditor("columns")}
            disabled={!preferencesLoaded || loading}
          >
            <Columns3 /> Columns
          </Button>
          {!mobile && !!filterChips.length && (
            <div
              className="col-span-2 flex min-w-0 flex-wrap items-center gap-1.5 border-l pl-3 sm:h-11"
              aria-label="Active filters"
            >
              {filterChips.map((chip) => (
                <Button
                  key={chip.key}
                  variant="secondary"
                  className="h-9 gap-1 rounded-full px-3 text-xs"
                  onClick={chip.remove}
                  aria-label={`Remove ${chip.label} filter`}
                >
                  {chip.label}
                  <X className="size-3" />
                </Button>
              ))}
              <Button
                variant="ghost"
                className="h-9 px-2 text-xs"
                onClick={() => patchView({ filters: { ...emptyFilters } })}
              >
                Clear filters
              </Button>
            </div>
          )}
          {!mobile && comparedWorkoutIds.length > 0 && (
            <div className="col-span-2 flex min-w-0 items-center gap-2 sm:h-11" aria-label="Workout comparison selection">
              <p className="whitespace-nowrap text-sm font-medium">
                {comparedWorkoutIds.length} workout{comparedWorkoutIds.length === 1 ? "" : "s"} selected
                <span className="ml-2 hidden font-normal text-muted-foreground xl:inline">Select up to 6</span>
              </p>
              <Button variant="ghost" className="!h-11" onClick={() => setComparedWorkoutIds([])}>Clear selection</Button>
              <Button className="!h-11" disabled={comparisonWorkouts.length < 2} onClick={() => setComparing(true)}>
                Compare {comparisonWorkouts.length >= 2 ? `${comparisonWorkouts.length} workouts` : "workouts"}
              </Button>
            </div>
          )}
        </div>
        {Object.values(errors).length > 0 && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {Object.values(errors)[0]} Open Filters to correct it.
          </p>
        )}
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-sm">
          <div aria-live="polite" className="font-medium">
            {loading
              ? <Skeleton className="h-5 w-40" />
              : `${matching.length.toLocaleString()} matching workout${matching.length === 1 ? "" : "s"}`}
            {refreshing && <span className="ml-2 text-xs font-normal text-muted-foreground">Updating…</span>}
            {!mobile && visibleIds.length < selectedIds.length && (
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Showing {visibleIds.length} of {selectedIds.length} columns to fit this screen
              </span>
            )}
          </div>
          <p className="text-muted-foreground">
            {sum.durationCount
              ? `${(sum.duration / 3600).toFixed(1)} h moving`
              : "Moving time unavailable"}{" "}
            ·{" "}
            {sum.distanceCount
              ? `${(sum.distance / 1609.344).toFixed(1)} mi`
              : "Distance unavailable"}
          </p>
        </div>
        {loadError && (
          <div
            role="alert"
            className="mb-4 flex items-center gap-3 rounded-lg border border-destructive/40 p-3 text-sm text-destructive"
          >
            {loadError}
            <Button variant="outline" onClick={() => load(true)}>
              Retry
            </Button>
          </div>
        )}
        {preferenceError && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {preferenceError}
          </p>
        )}
        {loading && !context ? <TableSkeleton columns={visibleIds.length || 5} /> : !loading && !matching.length ? (
          <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            {loadError && !context
              ? "Workout history is unavailable."
              : "No completed workouts match these filters."}
          </div>
        ) : (
          <div
            ref={tableRef}
            className={`max-w-full ${mobile ? "overflow-x-auto overscroll-x-contain" : "overflow-hidden"} rounded-xl border bg-card shadow-sm`}
            tabIndex={0}
            aria-label="Workout report table"
          >
            <table
              className={`${mobile ? "w-max min-w-full" : "w-full table-fixed"} border-separate border-spacing-0 text-sm`}
            >
              {!mobile && (
                <colgroup>
                  <col style={{ width: 220 }} />
                  {visibleIds.map((id) => (
                    <col
                      key={id}
                      style={{
                        width: Math.max(
                          64,
                          (reportTableWidth - 220) / Math.max(visibleIds.length, 1)
                        ),
                      }}
                    />
                  ))}
                </colgroup>
              )}
              <thead>
                <tr className="bg-muted/60">
                  <th
                    scope="col"
                    aria-sort={view.sort.id === "date" ? (view.sort.direction === "asc" ? "ascending" : "descending") : "none"}
                    className="sticky left-0 z-20 max-w-[220px] min-w-[180px] border-r border-b bg-muted px-3 py-3 text-left font-semibold"
                  >
                    <button
                      className="rounded focus-visible:outline-2 focus-visible:outline-ring"
                      aria-label="Sort by workout date"
                      onClick={() => toggleSort("date")}
                    >
                      Workout
                      {view.sort.id === "date" ? view.sort.direction === "asc" ? " ↑" : " ↓" : ""}
                    </button>
                  </th>
                  {visibleIds.map((id) => {
                    const c = columnById.get(id)
                    return (
                      c && (
                        <th
                          key={id}
                          scope="col"
                          aria-sort={view.sort.id === id ? (view.sort.direction === "asc" ? "ascending" : "descending") : "none"}
                          className={`sticky top-0 z-10 border-b px-3 py-3 text-right font-semibold ${mobile ? "min-w-[112px] whitespace-nowrap" : "min-w-0 whitespace-normal break-words"}`}
                        >
                          <button
                            className="rounded focus-visible:outline-2 focus-visible:outline-ring"
                            onClick={() => toggleSort(id)}
                          >
                            {c.label}
                            {view.sort.id === id
                              ? view.sort.direction === "asc"
                                ? " ↑"
                                : " ↓"
                              : ""}
                          </button>
                          <span className="block text-[10px] font-normal text-muted-foreground">
                            {c.unit}
                          </span>
                        </th>
                      )
                    )
                  })}
                </tr>
              </thead>
              <tbody>
                {ordered.map((w) => (
                  <tr key={w.id} className="group hover:bg-muted/40">
                    <th
                      scope="row"
                      className="sticky left-0 z-10 max-w-[220px] border-r border-b bg-card p-0 text-left font-normal group-hover:bg-muted"
                    >
                      <div className="flex min-w-0 items-center">
                      {!mobile && (
                        <input
                          type="checkbox"
                          className="ml-3 size-4 shrink-0 cursor-pointer accent-primary"
                          aria-label={`Select ${w.title || "Workout"} on ${w.workout_date} for comparison`}
                          checked={comparedWorkoutIds.includes(w.id)}
                          disabled={!comparedWorkoutIds.includes(w.id) && comparedWorkoutIds.length >= 6}
                          onChange={(event) => setComparedWorkoutIds((current) => event.target.checked
                            ? [...current, w.id]
                            : current.filter((id) => id !== w.id)
                          )}
                        />
                      )}
                      <a
                        href={`/workout-reports?workout=${encodeURIComponent(w.id)}`}
                        className="block min-h-14 min-w-0 flex-1 px-3 py-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                        onClick={(event) => {
                          if (
                            event.button !== 0 ||
                            event.metaKey ||
                            event.ctrlKey ||
                            event.shiftKey ||
                            event.altKey
                          )
                            return
                          event.preventDefault()
                          const next = {
                            ...view,
                            scrollY: window.scrollY,
                            scrollX: tableRef.current?.scrollLeft || 0,
                          }
                          try {
                            sessionStorage.setItem(
                              viewKey,
                              JSON.stringify(next)
                            )
                          } catch {
                            /* optional */
                          }
                          onWorkoutOpen(w)
                        }}
                      >
                        <span className="flex max-w-[190px] items-center gap-2">
                          <SportIcon sport={w.sport} />
                          <span className="min-w-0 truncate font-medium">
                            {w.title || "Workout"}
                          </span>
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {w.workout_date} · {w.sport}
                        </span>
                      </a>
                      </div>
                    </th>
                    {visibleIds.map((id) => {
                      const c = columnById.get(id),
                        value = c?.value(w)
                      return (
                        <td
                          key={id}
                          className={`border-b px-3 py-3 text-right tabular-nums ${mobile ? "whitespace-nowrap" : "overflow-hidden whitespace-nowrap"}`}
                        >
                          {value == null || !Number.isFinite(value)
                            ? "—"
                            : c?.format(value, w)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <Editor
        mobile={mobile}
        title="Filters"
        open={editor === "filters"}
        onClose={() => setEditor(null)}
      >
        <EditorHeader
          title="Filters"
          onCancel={() => setEditor(null)}
          disabled={
            Object.keys(filterErrors(draftFilters, new Date(), timeZone))
              .length > 0
          }
          onApply={() => {
            patchView({ filters: draftFilters })
            setEditor(null)
          }}
        />
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
          <FilterFields
            value={draftFilters}
            onChange={setDraftFilters}
            errors={filterErrors(draftFilters, new Date(), timeZone)}
            timeZone={timeZone}
          />
        </div>
        <div className="shrink-0 border-t bg-popover px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:pb-4">
          <Button variant="outline" className="h-11 w-full rounded-full" onClick={() => setDraftFilters({ ...emptyFilters })}>
            Clear filters
          </Button>
        </div>
      </Editor>
      <Editor
        mobile={mobile}
        title="Columns"
        open={editor === "columns"}
        onClose={() => setEditor(null)}
      >
        <EditorHeader
          title="Columns"
          onCancel={() => setEditor(null)}
          onApply={() => {
            patchView({
              manual: {
                ...view.manual,
                [sportKey]: knownColumnIds(draftColumns),
              },
            })
            setEditor(null)
          }}
        />
        <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
          <p className="mb-3 text-sm text-muted-foreground">
            {sportKey === "all" ? "All sports" : sportKey} · {matching.length}{" "}
            matching workouts. Use arrows to change display order.
          </p>
          <label className="relative block">
            <Search className="absolute top-3.5 left-3 size-4 text-muted-foreground" />
            <input
              type="search"
              aria-label="Search columns"
              placeholder="Search fields"
              className={`${inputClass} w-full pl-9`}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <div className="mt-3 divide-y rounded-lg border">
            {[...reportColumns]
              .sort(
                (a, b) =>
                  (draftColumns.indexOf(a.id) < 0
                    ? 999
                    : draftColumns.indexOf(a.id)) -
                  (draftColumns.indexOf(b.id) < 0
                    ? 999
                    : draftColumns.indexOf(b.id))
              )
              .filter((c) =>
                c.label.toLowerCase().includes(search.toLowerCase())
              )
              .map((c) => {
                const index = draftColumns.indexOf(c.id)
                return (
                  <div
                    key={c.id}
                    className="flex min-h-14 items-center gap-2 px-3"
                  >
                    <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                      <input
                        type="checkbox"
                        className="size-5 accent-primary"
                        checked={index >= 0}
                        onChange={(e) =>
                          setDraftColumns((current) =>
                            e.target.checked
                              ? [...current, c.id]
                              : current.filter((id) => id !== c.id)
                          )
                        }
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">
                          {c.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {counts[c.id]}/{matching.length} workouts
                        </span>
                      </span>
                    </label>
                    <Button
                      variant="ghost"
                      className="size-11"
                      aria-label={`Move ${c.label} up`}
                      disabled={index <= 0}
                      onClick={() =>
                        setDraftColumns((current) => {
                          const next = [...current]
                          ;[next[index - 1], next[index]] = [
                            next[index],
                            next[index - 1],
                          ]
                          return next
                        })
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      className="size-11"
                      aria-label={`Move ${c.label} down`}
                      disabled={index < 0 || index >= draftColumns.length - 1}
                      onClick={() =>
                        setDraftColumns((current) => {
                          const next = [...current]
                          ;[next[index + 1], next[index]] = [
                            next[index],
                            next[index + 1],
                          ]
                          return next
                        })
                      }
                    >
                      <ArrowDown />
                    </Button>
                  </div>
                )
              })}
          </div>
        </div>
        <div className="shrink-0 space-y-2 border-t bg-popover px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+6rem)] md:pb-4">
          <Button
            className="h-12 w-full rounded-full bg-zinc-950 text-sm text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"
            disabled={saving}
            onClick={() =>
              void saveDefaults({
                ...saved,
                [sportKey]: knownColumnIds(draftColumns),
              })
            }
          >
            {saving
              ? "Saving…"
              : `Save as ${sportKey === "all" ? "All sports" : sportKey} default`}
          </Button>
          <Button
            variant="ghost"
            className="h-9 w-full rounded-full text-sm text-muted-foreground hover:text-foreground"
            aria-label={`Use automatic columns for ${sportKey === "all" ? "All sports" : sportKey} and remove its saved default`}
            disabled={saving}
            onClick={() =>
              void saveDefaults(
                Object.fromEntries(
                  Object.entries(saved).filter(([key]) => key !== sportKey)
                )
              )
            }
          >
            Use automatic columns
          </Button>
          {preferenceError && (
            <p role="alert" className="text-xs text-destructive">
              {preferenceError}
            </p>
          )}
        </div>
      </Editor>
    </section>
  )
}

