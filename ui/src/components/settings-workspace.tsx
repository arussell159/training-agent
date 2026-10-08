import { TableSkeleton } from "@/components/loading-layouts"
import { IntervalsConnection } from "@/components/intervals-connection"
import { apiFetch } from "@/lib/api-client"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { useEffect, useRef, useState, type ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { Utensils, Activity, Bike, BookOpen, ChevronDown, ChevronRight, Footprints, Gauge, LoaderCircle, SunMoon, TableProperties, Trophy, Waves } from "lucide-react"

import { displayRunThreshold, displaySwimCss, ThresholdHistory } from "@/components/training-zones-display"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SettingsList, SettingsListItem } from "@/components/ui/settings-list"
import { MobileFilterTabs } from "@/components/ui/mobile-filter-tabs"
import type { PerformanceRecord } from "@/lib/personal-statistics-preview"
import { BIKE_PERSONAL_BESTS, RUN_PERSONAL_BESTS, SWIM_PERSONAL_BESTS, bestCurveEffort, formatEffortPace, formatEffortTime, normalizedPersonalStatistics, personalBestWindow, samePersonalBestWindow, type PersonalBestEffort, type PersonalBestRange, type PersonalBestWindow, type PersonalStatisticsData, type PerformanceSport } from "@/lib/personal-statistics"
import { withRequestDeadline } from "@/lib/request-deadline"
import { useIsMobile } from "@/hooks/use-mobile"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTheme } from "@/components/theme-provider"
import { loadTrainingContext, rememberTrainingContext, fallbackTrainingContext, type PlannedWorkout, type TrainingContext } from "@/lib/training-context"
import { cn } from "@/lib/utils"
import { validatedTrainingContext } from "@/lib/training-context-validation"

type SettingsSection = "nutrition" | "zones" | "race" | "performance" | "library" | "appearance" | "intervals"
type SettingsItem = { id: SettingsSection; label: string; description: string; icon: LucideIcon }
type RaceEvent = { id: string; name: string; date: string; priority: string }
const performanceSports: Array<{ value: PerformanceSport; label: string; icon?: LucideIcon }> = [
  { value: "Run", label: "Run", icon: Footprints },
  { value: "Bike", label: "Bike", icon: Bike },
  { value: "Swim", label: "Swim", icon: Waves },
]

const groups: Array<{ label: string; items: SettingsItem[] }> = [
  { label: "Training", items: [
    { id: "zones", label: "Training zones", description: "Edit bike, run, swim, and heart-rate thresholds", icon: Gauge },
    { id: "race", label: "Race goal", description: "Current goal, upcoming races, and race history", icon: Trophy },
    { id: "performance", label: "Performance", description: "Training statistics and personal bests", icon: Activity },
  ] },
  { label: "Planning", items: [
    { id: "library", label: "Library", description: "Browse your training library", icon: BookOpen },
  ] },
  { label: "Nutrition", items: [{ id: "nutrition", label: "Food tracker", description: "Meals, calories, and daily macro targets", icon: Utensils }] },
  { label: "Preferences", items: [
    { id: "intervals", label: "Intervals.icu", description: "Connection and automatic updates", icon: Activity },
    { id: "appearance", label: "Appearance", description: "Light, dark, or system", icon: SunMoon },
  ] },
]
const allItems = groups.flatMap(group => group.items)
const getItem = (section: SettingsSection | null) => allItems.find(item => item.id === section)
const inputClock = (value?: string | null) => value?.match(/\d{1,2}:\d{2}/)?.[0] || ""
const compactDate = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
const settingsSubmitButtonClass = "h-12 w-full rounded-full bg-zinc-950 text-sm text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"

function SettingRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>
}

function PerformanceSection({ title, children }: {
  title: string
  children: ReactNode
}) {
  return <section className="space-y-2">
    <h2 className="mb-2 px-1 text-sm text-muted-foreground">{title}</h2>
    <SettingsList>{children}</SettingsList>
  </section>
}

function recordMatchesSport(record: PerformanceRecord, sport: PerformanceSport) {
  const type = record.sport.toLowerCase()
  return sport === "Run" ? type.includes("run") : sport === "Bike" ? /ride|bike|cycl/.test(type) : type.includes("swim")
}

function formatStatTime(seconds: number) {
  const minutes = Math.round(Math.max(0, seconds) / 60)
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours.toLocaleString("en-US")}h ${minutes % 60}m` : `${minutes}m`
}

function formatStatDistance(meters: number, sport: PerformanceSport) {
  if (sport === "Swim") return `${Math.round(meters / 0.9144).toLocaleString("en-US")} yd`
  return `${(meters / 1609.344).toLocaleString("en-US", { maximumFractionDigits: 1 })} mi`
}

function formatStatDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
}

function activityWorkout(record: PerformanceRecord): PlannedWorkout {
  const id = record.id || `preview-${record.sport.toLowerCase()}-${record.date}`
  const seconds = Number(record.duration_seconds) || 0
  const distance = Number(record.distance_meters) || 0
  return {
    id: `activity:${id}`,
    activity_id: record.id?.startsWith("preview-") ? null : id,
    day: record.date,
    date: record.date,
    workout_date: record.date,
    sport: record.sport,
    title: record.name || `${record.sport} activity`,
    duration: formatStatTime(seconds),
    distance_meters: distance,
    goal: "Completed activity",
    status: "completed",
    actualDurationMinutes: seconds / 60,
    workout_summary: {
      planned: null,
      completed: {
        duration_seconds: seconds,
        distance_meters: distance,
        average_speed: seconds > 0 ? distance / seconds : null,
        elevation_gain: Number(record.elevation_meters) || 0,
      },
    },
  }
}

function curveWorkout(effort: PersonalBestEffort, records: PerformanceRecord[]): PlannedWorkout | null {
  if (!effort.activity_id) return null
  const record = records.find(record => record.id === effort.activity_id)
  if (record) return activityWorkout(record)
  // An effort is a slice of an activity; it cannot supply that activity's totals.
  return {
    id: `activity:${effort.activity_id}`, activity_id: effort.activity_id,
    day: effort.date || "", date: effort.date || "", ...(effort.date ? { workout_date: effort.date } : {}),
    sport: effort.sport, title: effort.name || `${effort.sport} activity`,
    duration: "—", goal: "Completed activity", status: "completed",
    workout_summary: { planned: null, completed: null },
  }
}

function PerformanceRideRecords({ records, onActivityOpen }: { records: PerformanceRecord[]; onActivityOpen?: (workout: PlannedWorkout) => void }) {
  const sportRecords = records.filter(record => recordMatchesSport(record, "Bike"))
  const longestRide = sportRecords.reduce<PerformanceRecord | null>((best, record) => !best || record.distance_meters > best.distance_meters ? record : best, null)
  const biggestClimb = sportRecords.reduce<PerformanceRecord | null>((best, record) => !best || record.elevation_meters > best.elevation_meters ? record : best, null)
  const totalElevation = sportRecords.reduce((total, record) => total + record.elevation_meters, 0)
  return <>
    {longestRide ? <SettingsListItem icon={Trophy} label="Longest ride" description={`${longestRide.name} · ${formatStatDate(longestRide.date)}`} value={formatStatDistance(longestRide.distance_meters, "Bike")} onClick={onActivityOpen && longestRide.id ? () => onActivityOpen(activityWorkout(longestRide)) : undefined} /> : <SettingRow label="Longest ride" value="—" />}
    {biggestClimb ? <SettingsListItem icon={Trophy} label="Biggest climb" description={`${biggestClimb.name} · ${formatStatDate(biggestClimb.date)}`} value={`${Math.round(biggestClimb.elevation_meters / 0.3048).toLocaleString("en-US")} ft`} onClick={onActivityOpen && biggestClimb.id ? () => onActivityOpen(activityWorkout(biggestClimb)) : undefined} /> : <SettingRow label="Biggest climb" value="—" />}
    <SettingRow label="All-time elevation gain" value={`${Math.round(totalElevation / 0.3048).toLocaleString("en-US")} ft`} />
  </>
}

function PerformanceEffortRows({ sport, efforts, records, onActivityOpen }: { sport: PerformanceSport; efforts: PersonalBestEffort[]; records: PerformanceRecord[]; onActivityOpen?: (workout: PlannedWorkout) => void }) {
  function row(key: number, label: string, effort: PersonalBestEffort | null) {
    if (!effort) return <SettingRow key={key} label={label} value="—" />
    const workout = curveWorkout(effort, records)
    const description = [effort.name || "Intervals.icu activity", effort.date ? formatStatDate(effort.date) : ""].filter(Boolean).join(" · ")
    const value = sport === "Bike"
      ? <span className="flex flex-col items-end"><span>{Math.round(effort.value).toLocaleString("en-US")} W</span>{effort.watts_per_kg != null && <span>{effort.watts_per_kg.toLocaleString("en-US", { maximumFractionDigits: 2 })} W/kg</span>}</span>
      : <span className="flex flex-col items-end"><span>{formatEffortTime(effort.duration_seconds!)}</span><span>{formatEffortPace(effort)}</span></span>
    return <SettingsListItem key={key} icon={Trophy} label={label} description={description} value={value} onClick={onActivityOpen && workout ? () => onActivityOpen(workout) : undefined} />
  }
  return <div>
    {sport === "Bike"
      ? BIKE_PERSONAL_BESTS.map(({ seconds, label }) => row(seconds, label, bestCurveEffort(efforts, sport, seconds)))
      : (sport === "Run" ? RUN_PERSONAL_BESTS : SWIM_PERSONAL_BESTS).map(({ meters, label }) => row(meters, label, bestCurveEffort(efforts, sport, meters)))}
  </div>
}

function PersonalBestDateControls({ today, range, window, onChange }: { today: string; range: PersonalBestRange; window: PersonalBestWindow | null; onChange: (range: PersonalBestRange, window: PersonalBestWindow | null) => void }) {
  const [oldest, setOldest] = useState(window?.oldest || `${today.slice(0, 4)}-01-01`)
  const [newest, setNewest] = useState(window?.newest || today)
  const custom = personalBestWindow("custom", today, { oldest, newest })
  return <div className="space-y-3">
    <SettingsSelectField id="personal-best-range" label="Personal best date range" value={range} options={[{ value: "all", label: "All time" }, { value: "recent", label: "Last 4 weeks" }, { value: "year", label: "Year to date" }, { value: "custom", label: "Custom dates" }]} onChange={value => {
      const next = value as PersonalBestRange
      onChange(next, next === "custom" ? window : personalBestWindow(next, today))
    }} />
    {range === "custom" && <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3"><SettingsInputField id="personal-best-oldest" label="From" type="date" value={oldest} onChange={setOldest} /><SettingsInputField id="personal-best-newest" label="Through" type="date" value={newest} onChange={setNewest} /></div>
      {!custom && <p className="text-xs text-muted-foreground">Choose valid dates through {formatStatDate(today)}, with the start before the end.</p>}
      <Button variant="outline" size="sm" disabled={!custom} onClick={() => onChange("custom", custom)}>Apply dates</Button>
    </div>}
  </div>
}

function PerformanceStatsPanel({ data, loading, error, sport, range, window, onRangeChange, onSportChange, onRetry, onActivityOpen }: {
  data: PersonalStatisticsData | null
  loading: boolean
  error: string
  sport: PerformanceSport
  range: PersonalBestRange
  window: PersonalBestWindow | null
  onRangeChange: (range: PersonalBestRange, window: PersonalBestWindow | null) => void
  onSportChange: (sport: PerformanceSport) => void
  onRetry: () => void
  onActivityOpen?: (workout: PlannedWorkout) => void
}) {
  const mobile = useIsMobile()
  if (!data && loading) return <TableSkeleton />
  if (!data && error) return <div role="alert" className="space-y-3 py-6"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={onRetry}>Try again</Button></div>
  if (!data) return null
  const requestedWindow = window || { oldest: null, newest: data.today }
  const currentCurves = samePersonalBestWindow(data.bestEffortsWindow, requestedWindow)
  const curveError = error || (currentCurves ? data.bestEffortsError : "")
  const records = data.records.filter(record => recordMatchesSport(record, sport))
  const recentStart = new Date(`${data.today}T12:00:00Z`)
  recentStart.setUTCDate(recentStart.getUTCDate() - 27)
  const recentStartKey = recentStart.toISOString().slice(0, 10)
  const recentRecords = records.filter(record => record.date >= recentStartKey && record.date <= data.today)
  const yearStart = `${data.today.slice(0, 4)}-01-01`
  const yearRecords = records.filter(record => record.date >= yearStart && record.date <= data.today)
  const totals = (items: PerformanceRecord[]) => items.reduce((sum, record) => ({
    activities: sum.activities + 1,
    distance: sum.distance + (Number(record.distance_meters) || 0),
    seconds: sum.seconds + (Number(record.duration_seconds) || 0),
    elevation: sum.elevation + (Number(record.elevation_meters) || 0),
  }), { activities: 0, distance: 0, seconds: 0, elevation: 0 })
  const recent = totals(recentRecords)
  const year = totals(yearRecords)
  const all = totals(records)
  const mean = (value: number) => (value / 4).toLocaleString("en-US", { maximumFractionDigits: 1 })
  const rowGroup = (items: Array<[string, string]>) => items.map(([label, value]) => <SettingRow key={label} label={label} value={value} />)
  return <div className="space-y-6">
    {data.source === "synthetic-local-preview" && <p role="status" className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground">Local preview · Synthetic activity and best-effort data.</p>}
    {!mobile && <MobileFilterTabs label="Filter performance by sport" items={performanceSports} value={sport} onChange={onSportChange} inline className="performance-sport-tabs mb-1" />}
    <PerformanceSection title="Activity">
      {rowGroup([
        ["Avg activities / week", mean(recent.activities)],
        ["Avg time / week", formatStatTime(recent.seconds / 4)],
        ["Avg distance / week", formatStatDistance(recent.distance / 4, sport)],
      ])}
    </PerformanceSection>
    <PerformanceSection title="Year to date">
      {rowGroup([
        ["Activities", year.activities.toLocaleString("en-US")],
        ["Time", formatStatTime(year.seconds)],
        ["Distance", formatStatDistance(year.distance, sport)],
        ["Elevation gain", `${Math.round(year.elevation / 0.3048).toLocaleString("en-US")} ft`],
      ])}
    </PerformanceSection>
    <PerformanceSection title="All time">
      {rowGroup([
        ["Activities", all.activities.toLocaleString("en-US")],
        ["Distance", formatStatDistance(all.distance, sport)],
        ["Elevation gain", `${Math.round(all.elevation / 0.3048).toLocaleString("en-US")} ft`],
      ])}
    </PerformanceSection>
    {sport === "Bike" && <PerformanceSection title="Ride records · All time"><PerformanceRideRecords records={data.records} onActivityOpen={onActivityOpen} /></PerformanceSection>}
    <section className="space-y-3" aria-busy={loading}>
      <h2 className="px-1 text-sm text-muted-foreground">Personal bests</h2>
      <PersonalBestDateControls today={data.today} range={range} window={window} onChange={onRangeChange} />
      <p className="px-1 text-xs text-muted-foreground">{requestedWindow.oldest ? `${formatStatDate(requestedWindow.oldest)} – ${formatStatDate(requestedWindow.newest)}` : "All time"} · {data.source === "synthetic-local-preview" ? "Synthetic local curve preview" : `Recorded ${sport === "Bike" ? "power" : "pace"} curves from Intervals.icu`}</p>
      {loading && <p role="status" className="flex items-center gap-2 px-1 text-xs text-muted-foreground"><LoaderCircle aria-hidden="true" className="size-3 animate-spin" />Loading personal bests…</p>}
      {curveError && <div role="alert" className="space-y-2 px-1"><p className="text-sm text-destructive">{curveError}</p><Button variant="outline" size="sm" disabled={loading} onClick={onRetry}>Try again</Button></div>}
      <SettingsList><PerformanceEffortRows sport={sport} efforts={currentCurves ? data.bestEfforts : []} records={data.records} onActivityOpen={onActivityOpen} /></SettingsList>
      {!loading && !curveError && <p className="px-1 text-xs text-muted-foreground">— means no recorded best for that effort in this date range.</p>}
    </section>
  </div>
}

function SettingsInputField({ id, label, value, placeholder, inputMode, type, onChange }: {
  id: string
  label: string
  value: string
  placeholder?: string
  inputMode?: "numeric" | "decimal"
  type?: "text" | "date"
  onChange: (value: string) => void
}) {
  return <div className="rounded-xl border border-input bg-card px-3 py-1.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
    <Label htmlFor={id} className="block text-[11px] leading-4 text-muted-foreground">{label}</Label>
    <Input id={id} type={type} inputMode={inputMode} value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className="h-6 rounded-none border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:border-0 focus-visible:ring-0 dark:bg-transparent" />
  </div>
}

function SettingsSelectField({ id, label, value, onChange, options }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly { value: string; label: string }[]
}) {
  return <div className="rounded-xl border border-input bg-card px-3 py-1.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30">
    <Label htmlFor={id} className="block text-[11px] leading-4 text-muted-foreground">{label}</Label>
    <div className="relative">
      <select id={id} value={value} onChange={event => onChange(event.target.value)} className="h-6 w-full appearance-none border-0 bg-transparent pr-6 text-sm outline-none">
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-0 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  </div>
}

export function SettingsWorkspace({ onWorkoutOpen }: { onWorkoutOpen?: (workout: PlannedWorkout) => void }) {
  const mobile = useIsMobile()
  const [context, setContext] = useState<TrainingContext>(fallbackTrainingContext)
  const [section, setSection] = useState<SettingsSection | null>(() => new URLSearchParams(window.location.search).has("intervals") ? "intervals" : null)
  const [dialogSection, setDialogSection] = useState<SettingsSection | null>(() => new URLSearchParams(window.location.search).has("intervals") && window.innerWidth >= 768 ? "intervals" : null)
  const [zones, setZones] = useState({ bike_ftp: "", run_threshold_pace: "", swim_css: "", threshold_hr: "" })
  const [zonesEdited, setZonesEdited] = useState(false)
  const [events, setEvents] = useState<RaceEvent[]>([])
  const [performanceData, setPerformanceData] = useState<PersonalStatisticsData | null>(null)
  const [performanceLoading, setPerformanceLoading] = useState(false)
  const [performanceError, setPerformanceError] = useState("")
  const [performanceSport, setPerformanceSport] = useState<PerformanceSport>("Run")
  const [performanceRange, setPerformanceRange] = useState<PersonalBestRange>("all")
  const [performanceWindow, setPerformanceWindow] = useState<PersonalBestWindow | null>(null)
  const [performanceRetry, setPerformanceRetry] = useState(0)
  const loadedPerformanceKey = useRef<string | null>(null)
  const performanceRequestRevision = useRef(0)
  const pendingPerformanceRequest = useRef<AbortController | null>(null)
  const [raceName, setRaceName] = useState("")
  const [raceDate, setRaceDate] = useState("")
  const [priority, setPriority] = useState("A")
  const [raceEdited, setRaceEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [loadError, setLoadError] = useState("")
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    let active = true
    void Promise.all([
      loadTrainingContext().then(value => { if (active) setContext(value) }),
      apiFetch("/api/race-events", { cache: "no-store" }).then(async response => {
        const value = await response.json() as { events?: RaceEvent[]; error?: string }
        if (!response.ok) throw new Error(value.error || "Race events could not be loaded.")
        if (active) setEvents(value.events || [])
      }).catch(error => { if (active) setLoadError(error instanceof Error ? error.message : "Race events could not be loaded.") }),
    ])
    return () => { active = false }
  }, [])

  const performanceActive = section === "performance" || dialogSection === "performance"
  const performanceOldest = performanceWindow?.oldest ?? null
  const performanceNewest = performanceOldest ? performanceWindow?.newest : null
  useEffect(() => {
    const key = JSON.stringify([performanceOldest, performanceNewest, performanceRetry])
    if (!performanceActive) return
    if (loadedPerformanceKey.current === key) {
      setPerformanceLoading(false)
      setPerformanceError("")
      return
    }
    const controller = new AbortController()
    const revision = ++performanceRequestRevision.current
    pendingPerformanceRequest.current = controller
    let active = true
    setPerformanceLoading(true)
    setPerformanceError("")
    const query = performanceOldest && performanceNewest ? `?${new URLSearchParams({ oldest: performanceOldest, newest: performanceNewest })}` : ""
    void withRequestDeadline(async signal => {
      const response = await apiFetch(`/api/personal-statistics${query}`, { signal, headers: { Accept: "application/json" } })
      const result = await response.json() as unknown
      if (!response.ok) {
        const message = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "Performance statistics could not be loaded."
        throw new Error(message)
      }
      const data = normalizedPersonalStatistics(result)
      const expected = { oldest: performanceOldest, newest: performanceNewest || data.today }
      if (!samePersonalBestWindow(data.bestEffortsWindow, expected)) throw new Error("Intervals.icu returned personal bests for a different date range. Please retry.")
      return data
    }, 60_000, controller.signal, "Performance statistics took too long to load. Please retry.")
      .then(value => { if (active && revision === performanceRequestRevision.current && !controller.signal.aborted) { loadedPerformanceKey.current = key; setPerformanceData(value) } })
      .catch(error => {
        if (active && revision === performanceRequestRevision.current && !controller.signal.aborted) {
          setPerformanceError(error instanceof Error ? error.message : "Intervals.icu statistics are unavailable.")
        }
      })
      .finally(() => {
        if (active && revision === performanceRequestRevision.current) setPerformanceLoading(false)
        if (pendingPerformanceRequest.current === controller) pendingPerformanceRequest.current = null
      })
    return () => { active = false; controller.abort() }
  }, [performanceActive, performanceOldest, performanceNewest, performanceRetry])

  useEffect(() => {
    const reset = () => {
      performanceRequestRevision.current++
      pendingPerformanceRequest.current?.abort()
      pendingPerformanceRequest.current = null
      loadedPerformanceKey.current = null
      setPerformanceData(null)
      setPerformanceRange("all")
      setPerformanceWindow(null)
      setPerformanceError("")
      setPerformanceRetry(value => value + 1)
    }
    window.addEventListener("training-cache-reset", reset)
    window.addEventListener("app-auth-required", reset)
    return () => {
      window.removeEventListener("training-cache-reset", reset)
      window.removeEventListener("app-auth-required", reset)
    }
  }, [])

  useEffect(() => {
    const values = context.athlete.zones
    setZones({ bike_ftp: values?.bike_ftp == null ? "" : String(values.bike_ftp), run_threshold_pace: inputClock(values?.run_threshold_pace), swim_css: inputClock(values?.swim_css), threshold_hr: values?.threshold_hr == null ? "" : String(values.threshold_hr) })
  }, [context.athlete.zones])

  const now = new Date()
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
  const upcoming = events.filter(event => event.date >= today)
  const past = events.filter(event => event.date < today).reverse()
  const currentGoal = upcoming.find(event => event.priority === "A") || upcoming[0] || (context.athlete.race && context.athlete.race_date ? { id: "athlete-current-goal", name: context.athlete.race, date: context.athlete.race_date, priority: "A" } : undefined)
  function summary(id: SettingsSection) {
    if (id === "intervals") return "API and live updates"
    if (id === "nutrition") return "Meals, calories and macros"
    if (id === "zones") return context.athlete.zones?.bike_ftp ? `FTP ${context.athlete.zones.bike_ftp} W` : "Edit thresholds"
    if (id === "race") return currentGoal ? `${currentGoal.name} · ${compactDate(currentGoal.date)}` : "No upcoming races"
    if (id === "performance") return performanceData ? `${performanceData.records.length.toLocaleString("en-US")} activities` : "Activity stats and personal bests"
    if (id === "library") return "Browse workouts"
    return theme[0].toUpperCase() + theme.slice(1)
  }

  function editZone(key: keyof typeof zones, value: string) {
    setZones(current => ({ ...current, [key]: value }))
    setZonesEdited(true)
    setFeedback("")
  }

  function editRace(field: "name" | "date" | "priority", value: string) {
    if (field === "name") setRaceName(value)
    if (field === "date") setRaceDate(value)
    if (field === "priority") setPriority(value)
    setRaceEdited(true)
    setFeedback("")
  }

  async function saveZones() {
    setSaving(true); setFeedback("")
    try {
      const response = await apiFetch("/api/training-zones", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(zones) })
      const result = await response.json() as { context?: TrainingContext; error?: string }
      if (!response.ok || !result.context) throw new Error(result.error || "Training zones could not be saved.")
      const nextContext=validatedTrainingContext(result.context)
      rememberTrainingContext(nextContext, "full");setContext(nextContext)
      setZonesEdited(false)
      setFeedback("Training zones saved to Intervals.icu. The previous values were added to history.")
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Training zones could not be saved.") }
    finally { setSaving(false) }
  }

  async function addRace() {
    if (!raceName.trim() || !raceDate) { setFeedback("Enter a race name and date."); return }
    setSaving(true); setFeedback("")
    try {
      const response = await apiFetch("/api/race-events", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ name: raceName, date: raceDate, priority }) })
      const result = await response.json() as { event?: RaceEvent; context?: TrainingContext; error?: string }
      if (!response.ok || !result.event) throw new Error(result.error || "Race could not be added.")
      setEvents(current => [...current.filter(event => event.id !== result.event!.id), result.event!].sort((a, b) => a.date.localeCompare(b.date)))
      if (result.context) { const nextContext=validatedTrainingContext(result.context);rememberTrainingContext(nextContext, "full");setContext(nextContext) }
      setRaceName(""); setRaceDate(""); setRaceEdited(false); setFeedback("Race added to Intervals.icu.")
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Race could not be added.") }
    finally { setSaving(false) }
  }

  async function saveAppearance(value: "light" | "dark" | "system") {
    setSaving(true); setFeedback("")
    try { await setTheme(value); setFeedback("Appearance saved.") }
    catch (error) { setFeedback(error instanceof Error ? error.message : "Appearance could not be saved.") }
    finally { setSaving(false) }
  }

  function openLibrary() { window.dispatchEvent(new CustomEvent("app-navigate", { detail: "Library" })) }

  function renderMobileItem(item: SettingsItem) {
    if (item.id === "appearance") {
      const Icon = item.icon
      return (
        <div key={item.id} className="relative">
          <div className="pointer-events-none flex h-14 w-full items-center gap-3 px-4 text-sm" aria-hidden="true">
            <Icon className="size-4 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
            <span className="max-w-32 truncate text-xs text-muted-foreground">
              {summary(item.id)}
            </span>
            <ChevronRight className="size-4 text-muted-foreground/70" />
          </div>
          <select
            aria-label="Appearance"
            value={theme === "dark" ? "dark" : "light"}
            disabled={saving}
            onChange={(event) => {
              if (event.target.value === "light" || event.target.value === "dark") {
                void saveAppearance(event.target.value)
              }
            }}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      )
    }
    return (
      <SettingsListItem
        key={item.id}
        icon={item.icon}
        label={item.label}
        value={summary(item.id)}
        onClick={() => {
          if (item.id === "nutrition") { window.dispatchEvent(new CustomEvent("app-navigate", {detail: "Nutrition"})); return }
          if (item.id === "library") {
            openLibrary()
            return
          }
          setSection(item.id)
          setFeedback("")
        }}
      />
    )
  }

  function renderPanel(id: SettingsSection) {
    if (id === "intervals") return <IntervalsConnection />
    const athlete = context.athlete
    if (id === "zones") return <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Update the thresholds used by Intervals.icu and the training zones in this app. Leave a field blank to keep its current value.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingsInputField id="zone-bike-ftp" label="Bike FTP (watts)" inputMode="numeric" value={zones.bike_ftp} onChange={value => editZone("bike_ftp", value)} placeholder={String(athlete.zones?.bike_ftp ?? "—")} />
        <SettingsInputField id="zone-run-pace" label="Run threshold pace (min/mi)" inputMode="decimal" value={zones.run_threshold_pace} onChange={value => editZone("run_threshold_pace", value)} placeholder={displayRunThreshold(athlete.zones?.run_threshold_pace) || "7:30"} />
        <SettingsInputField id="zone-swim-css" label="Swim CSS (min/100 yd)" inputMode="decimal" value={zones.swim_css} onChange={value => editZone("swim_css", value)} placeholder={displaySwimCss(athlete.zones?.swim_css) || "1:40"} />
        <SettingsInputField id="zone-threshold-hr" label="Threshold heart rate (bpm)" inputMode="numeric" value={zones.threshold_hr} onChange={value => editZone("threshold_hr", value)} placeholder={String(athlete.zones?.threshold_hr ?? "—")} />
      </div>
      {zonesEdited && <Button disabled={saving} onClick={() => void saveZones()} className={settingsSubmitButtonClass}>{saving && <LoaderCircle className="animate-spin" />}Save training zones</Button>}
      {feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}
      <Card className="gap-0 divide-y py-0 shadow-none"><SettingRow label="Current bike FTP" value={athlete.zones?.bike_ftp ? `${athlete.zones.bike_ftp} W` : "—"} /><SettingRow label="Current run threshold" value={displayRunThreshold(athlete.zones?.run_threshold_pace) || "—"} /><SettingRow label="Current swim CSS" value={displaySwimCss(athlete.zones?.swim_css) || "—"} /><SettingRow label="Threshold heart rate" value={athlete.zones?.threshold_hr ? `${athlete.zones.threshold_hr} bpm` : "—"} /></Card>
      <ThresholdHistory history={athlete.zone_history} />
    </div>
    if (id === "race") return <div className="space-y-6">
      <section className="space-y-2"><h3 className="text-sm font-semibold">Current race goal</h3>{currentGoal ? <Card className="gap-1 p-4 shadow-none"><p className="font-medium">{currentGoal.name}</p><p className="text-sm text-muted-foreground">{compactDate(currentGoal.date)}{currentGoal.priority ? ` · ${currentGoal.priority} race` : ""}</p></Card> : <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No future race is scheduled.</p>}</section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Add a race</h3><p className="text-sm text-muted-foreground">This creates the event in Intervals.icu and adds it to the current ATP when one exists.</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_8rem]">
          <SettingsInputField id="race-name" label="Race name" value={raceName} onChange={value => editRace("name", value)} placeholder="Race name" />
          <SettingsInputField id="race-date" label="Date" type="date" value={raceDate} onChange={value => editRace("date", value)} />
          <SettingsSelectField id="race-priority" label="Priority" value={priority} onChange={value => editRace("priority", value)} options={[{ value: "A", label: "A race" }, { value: "B", label: "B race" }, { value: "C", label: "C race" }]} />
        </div>
        {raceEdited && <Button disabled={saving} onClick={() => void addRace()} className={settingsSubmitButtonClass}>{saving && <LoaderCircle className="animate-spin" />}Add race to Intervals.icu</Button>}
        {feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Future events</h3>{upcoming.length ? <Card className="gap-0 divide-y py-0 shadow-none">{upcoming.map(event => <SettingRow key={event.id} label={`${event.priority ? `${event.priority} · ` : ""}${compactDate(event.date)}`} value={event.name} />)}</Card> : <p className="text-sm text-muted-foreground">No future events.</p>}</section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Race history</h3>{past.length ? <Card className="gap-0 divide-y py-0 shadow-none">{past.map(event => <SettingRow key={event.id} label={`${event.priority ? `${event.priority} · ` : ""}${compactDate(event.date)}`} value={event.name} />)}</Card> : <p className="text-sm text-muted-foreground">No past races in Intervals.icu.</p>}</section>
      {loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
    </div>
    if (id === "performance") return <PerformanceStatsPanel data={performanceData} loading={performanceLoading} error={performanceError} sport={performanceSport} range={performanceRange} window={performanceWindow} onRangeChange={(range, window) => { setPerformanceRange(range); setPerformanceWindow(window) }} onSportChange={setPerformanceSport} onRetry={() => { setPerformanceError(""); setPerformanceRetry(value => value + 1) }} onActivityOpen={onWorkoutOpen} />
    if (id === "library") return null
    if (id === "appearance") return <div className="space-y-3"><div className="grid grid-cols-3 gap-2">{(["light", "dark", "system"] as const).map(value => <Button key={value} disabled={saving} variant={theme === value ? "default" : "outline"} onClick={() => void saveAppearance(value)}>{value[0].toUpperCase() + value.slice(1)}</Button>)}</div>{feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}</div>
    return null
  }

  const mobileItem = getItem(section)
  const dialogItem = getItem(dialogSection)
  return <div className="flex min-h-0 w-full flex-1 flex-col bg-background">
    {loadError && section !== "race" && <div role="alert" className="border-b px-4 py-3 text-sm text-destructive">{loadError}</div>}
    <div className={cn("flex min-h-0 flex-1 flex-col md:hidden", section === "performance" && "coach-report-page")}><MobileSiteNavbar className={section === "performance" ? "coach-report-navbar" : "mobile-site-navbar-over-scroll"} title={mobileItem?.label || "Settings"} backLabel="Back to settings" onBack={section ? () => { setSection(null); setFeedback("") } : undefined}>{mobile && section === "performance" && <MobileFilterTabs label="Filter performance by sport" items={performanceSports} value={performanceSport} onChange={setPerformanceSport} className="performance-sport-filter" />}</MobileSiteNavbar>
      <div className={cn("min-h-0 flex-1 overflow-y-auto", section === "performance" ? "overscroll-contain" : "px-4 pt-5 pb-[calc(6rem+env(safe-area-inset-bottom))]")}>{section === "performance" ? <div className="coach-report-content mx-auto w-full max-w-4xl px-4 py-5">{renderPanel(section)}</div> : section ? renderPanel(section) : <div className="space-y-5">{groups.map(group => <section key={group.label}><h2 className="mb-2 px-1 text-sm text-muted-foreground">{group.label}</h2><SettingsList>{group.items.map(renderMobileItem)}{group.label === "Training" && <SettingsListItem icon={TableProperties} label="Workout Reports" value="Filter and compare completed workouts" onClick={() => window.dispatchEvent(new CustomEvent("app-navigate", { detail: "Workout Reports" }))} />}</SettingsList></section>)}</div>}</div>
    </div>
    <div className="hidden min-h-0 flex-1 overflow-y-auto md:block"><div className="mx-auto w-full max-w-4xl px-8 py-14 lg:py-16"><h1 className="text-2xl font-medium tracking-tight">Settings</h1><p className="mt-1 text-sm text-muted-foreground">Manage training, race goals, and app preferences.</p><div className="mt-10 space-y-12">{groups.map(group => <section key={group.label}><h2 className="mb-4 text-sm font-medium">{group.label}</h2><Card className="gap-0 divide-y py-0 shadow-none">{group.items.map(item => { const Icon = item.icon; return <div key={item.id} className="flex min-h-16 items-center gap-3 px-4 py-3"><Icon className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.description}</p></div><span className="mr-2 max-w-56 truncate text-xs text-muted-foreground">{summary(item.id)}</span><Button variant="outline" size="sm" onClick={() => { if (item.id === "nutrition") { window.dispatchEvent(new CustomEvent("app-navigate", {detail: "Nutrition"})); return } if (item.id === "library") { openLibrary(); return } setDialogSection(item.id); setFeedback("") }}> {item.id === "library" ? "Open" : "Manage"}</Button></div> })}</Card></section>)}</div></div></div>
    <Dialog open={Boolean(dialogSection)} onOpenChange={open => { if (!open) { setDialogSection(null); setFeedback("") } }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{dialogItem?.label}</DialogTitle><DialogDescription>{dialogItem?.description}</DialogDescription></DialogHeader>{dialogSection && renderPanel(dialogSection)}</DialogContent></Dialog>
  </div>
}
