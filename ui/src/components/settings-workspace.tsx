import { apiFetch } from "@/lib/api-client"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { useEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { CalendarRange, ChevronDown, ChevronRight, Gauge, LoaderCircle, SunMoon, Trophy } from "lucide-react"

import { displayRunThreshold, displaySwimCss, ThresholdHistory } from "@/components/training-zones-display"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { SettingsList, SettingsListItem } from "@/components/ui/settings-list"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTheme } from "@/components/theme-provider"
import { loadTrainingContext, rememberTrainingContext, fallbackTrainingContext, type TrainingContext } from "@/lib/training-context"

type SettingsSection = "zones" | "race" | "atp" | "appearance"
type SettingsItem = { id: SettingsSection; label: string; description: string; icon: LucideIcon }
type RaceEvent = { id: string; name: string; date: string; priority: string }
type PlanSummary = { id: string; name?: string; startDate?: string; endDate?: string; events?: RaceEvent[] }

const groups: Array<{ label: string; items: SettingsItem[] }> = [
  { label: "Training", items: [
    { id: "zones", label: "Training zones", description: "Edit bike, run, swim, and heart-rate thresholds", icon: Gauge },
    { id: "race", label: "Race goal", description: "Current goal, upcoming races, and race history", icon: Trophy },
  ] },
  { label: "Planning", items: [
    { id: "atp", label: "ATP", description: "Annual training plan and race schedule", icon: CalendarRange },
  ] },
  { label: "Preferences", items: [
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

export function SettingsWorkspace() {
  const [context, setContext] = useState<TrainingContext>(fallbackTrainingContext)
  const [section, setSection] = useState<SettingsSection | null>(null)
  const [dialogSection, setDialogSection] = useState<SettingsSection | null>(null)
  const [zones, setZones] = useState({ bike_ftp: "", run_threshold_pace: "", swim_css: "", threshold_hr: "" })
  const [zonesEdited, setZonesEdited] = useState(false)
  const [events, setEvents] = useState<RaceEvent[]>([])
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
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
      apiFetch("/api/annual-plans", { cache: "no-store" }).then(async response => {
        if (!response.ok) return
        const value = await response.json() as { plans?: PlanSummary[]; activeId?: string | null }
        if (active) { setPlans(value.plans || []); setActivePlanId(value.activeId || null) }
      }).catch(() => {}),
    ])
    return () => { active = false }
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
  const activePlan = plans.find(plan => plan.id === activePlanId) || plans[0]

  function summary(id: SettingsSection) {
    if (id === "zones") return context.athlete.zones?.bike_ftp ? `FTP ${context.athlete.zones.bike_ftp} W` : "Edit thresholds"
    if (id === "race") return currentGoal ? `${currentGoal.name} · ${compactDate(currentGoal.date)}` : "No upcoming races"
    if (id === "atp") return activePlan?.name || (activePlan ? "Plan available" : "No plan yet")
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
      setContext(result.context); rememberTrainingContext(result.context, "full")
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
      const result = await response.json() as { event?: RaceEvent; context?: TrainingContext; plan?: PlanSummary; error?: string }
      if (!response.ok || !result.event) throw new Error(result.error || "Race could not be added.")
      setEvents(current => [...current.filter(event => event.id !== result.event!.id), result.event!].sort((a, b) => a.date.localeCompare(b.date)))
      if (result.context) { setContext(result.context); rememberTrainingContext(result.context, "full") }
      if (result.plan) setPlans(current => [result.plan!, ...current.filter(plan => plan.id !== result.plan!.id)])
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

  function openAtp() { window.dispatchEvent(new CustomEvent("app-navigate", { detail: "Annual Plan" })) }

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
          if (item.id === "atp") {
            openAtp()
            return
          }
          setSection(item.id)
          setFeedback("")
        }}
      />
    )
  }

  function renderPanel(id: SettingsSection) {
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
    if (id === "atp") return <div className="space-y-5"><p className="text-sm text-muted-foreground">Your annual training plan and event calendar.</p>
      {activePlan ? <Card className="gap-3 p-4 shadow-none"><div><p className="font-medium">{activePlan.name || "Annual training plan"}</p><p className="text-sm text-muted-foreground">{activePlan.startDate || ""}{activePlan.endDate ? ` – ${activePlan.endDate}` : ""}</p></div><p className="text-sm text-muted-foreground">{activePlan.events?.length || 0} planned races</p></Card> : <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No annual training plan yet.</p>}
      <Button onClick={openAtp}>Open ATP</Button></div>
    if (id === "appearance") return <div className="space-y-3"><div className="grid grid-cols-3 gap-2">{(["light", "dark", "system"] as const).map(value => <Button key={value} disabled={saving} variant={theme === value ? "default" : "outline"} onClick={() => void saveAppearance(value)}>{value[0].toUpperCase() + value.slice(1)}</Button>)}</div>{feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}</div>
    return null
  }

  const mobileItem = getItem(section)
  const dialogItem = getItem(dialogSection)
  return <div className="flex min-h-0 w-full flex-1 flex-col bg-background">
    {loadError && section !== "race" && <div role="alert" className="border-b px-4 py-3 text-sm text-destructive">{loadError}</div>}
    <div className="flex min-h-0 flex-1 flex-col md:hidden"><MobileSiteNavbar title={mobileItem?.label || "Settings"} backLabel="Back to settings" onBack={section ? () => { setSection(null); setFeedback("") } : undefined} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">{section ? renderPanel(section) : <div className="space-y-5">{groups.map(group => <section key={group.label}><h2 className="mb-2 px-1 text-sm text-muted-foreground">{group.label}</h2><SettingsList>{group.items.map(renderMobileItem)}</SettingsList></section>)}</div>}</div>
    </div>
    <div className="hidden min-h-0 flex-1 overflow-y-auto md:block"><div className="mx-auto w-full max-w-4xl px-8 py-14 lg:py-16"><h1 className="text-2xl font-medium tracking-tight">Settings</h1><p className="mt-1 text-sm text-muted-foreground">Manage training, race goals, and app preferences.</p><div className="mt-10 space-y-12">{groups.map(group => <section key={group.label}><h2 className="mb-4 text-sm font-medium">{group.label}</h2><Card className="gap-0 divide-y py-0 shadow-none">{group.items.map(item => { const Icon = item.icon; return <div key={item.id} className="flex min-h-16 items-center gap-3 px-4 py-3"><Icon className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.description}</p></div><span className="mr-2 max-w-56 truncate text-xs text-muted-foreground">{summary(item.id)}</span><Button variant="outline" size="sm" onClick={() => { setDialogSection(item.id); setFeedback("") }}>Manage</Button></div> })}</Card></section>)}</div></div></div>
    <Dialog open={Boolean(dialogSection)} onOpenChange={open => { if (!open) { setDialogSection(null); setFeedback("") } }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{dialogItem?.label}</DialogTitle><DialogDescription>{dialogItem?.description}</DialogDescription></DialogHeader>{dialogSection && renderPanel(dialogSection)}</DialogContent></Dialog>
  </div>
}
