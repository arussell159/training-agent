import { apiFetch } from "@/lib/api-client"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { useEffect, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { CalendarRange, Gauge, LoaderCircle, SunMoon, Trophy } from "lucide-react"

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

function SettingRow({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm"><span className="text-muted-foreground">{label}</span><span className="text-right font-medium">{value}</span></div>
}

export function SettingsWorkspace() {
  const [context, setContext] = useState<TrainingContext>(fallbackTrainingContext)
  const [section, setSection] = useState<SettingsSection | null>(null)
  const [dialogSection, setDialogSection] = useState<SettingsSection | null>(null)
  const [zones, setZones] = useState({ bike_ftp: "", run_threshold_pace: "", swim_css: "", threshold_hr: "" })
  const [events, setEvents] = useState<RaceEvent[]>([])
  const [plans, setPlans] = useState<PlanSummary[]>([])
  const [activePlanId, setActivePlanId] = useState<string | null>(null)
  const [raceName, setRaceName] = useState("")
  const [raceDate, setRaceDate] = useState("")
  const [priority, setPriority] = useState("A")
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

  async function saveZones() {
    setSaving(true); setFeedback("")
    try {
      const response = await apiFetch("/api/training-zones", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(zones) })
      const result = await response.json() as { context?: TrainingContext; error?: string }
      if (!response.ok || !result.context) throw new Error(result.error || "Training zones could not be saved.")
      setContext(result.context); rememberTrainingContext(result.context, "full")
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
      setRaceName(""); setRaceDate(""); setFeedback("Race added to Intervals.icu.")
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

  function renderPanel(id: SettingsSection) {
    const athlete = context.athlete
    if (id === "zones") return <div className="space-y-5">
      <p className="text-sm text-muted-foreground">Update the thresholds used by Intervals.icu and the training zones in this app. Leave a field blank to keep its current value.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="zone-bike-ftp">Bike FTP (watts)</Label><Input id="zone-bike-ftp" inputMode="numeric" value={zones.bike_ftp} onChange={event => setZones(current => ({ ...current, bike_ftp: event.target.value }))} placeholder={String(athlete.zones?.bike_ftp ?? "—")} /></div>
        <div className="space-y-2"><Label htmlFor="zone-run-pace">Run threshold pace (min/mi)</Label><Input id="zone-run-pace" inputMode="decimal" value={zones.run_threshold_pace} onChange={event => setZones(current => ({ ...current, run_threshold_pace: event.target.value }))} placeholder={displayRunThreshold(athlete.zones?.run_threshold_pace) || "7:30"} /></div>
        <div className="space-y-2"><Label htmlFor="zone-swim-css">Swim CSS (min/100 yd)</Label><Input id="zone-swim-css" inputMode="decimal" value={zones.swim_css} onChange={event => setZones(current => ({ ...current, swim_css: event.target.value }))} placeholder={displaySwimCss(athlete.zones?.swim_css) || "1:40"} /></div>
        <div className="space-y-2"><Label htmlFor="zone-threshold-hr">Threshold heart rate (bpm)</Label><Input id="zone-threshold-hr" inputMode="numeric" value={zones.threshold_hr} onChange={event => setZones(current => ({ ...current, threshold_hr: event.target.value }))} placeholder={String(athlete.zones?.threshold_hr ?? "—")} /></div>
      </div>
      <Card className="gap-0 divide-y py-0 shadow-none"><SettingRow label="Current bike FTP" value={athlete.zones?.bike_ftp ? `${athlete.zones.bike_ftp} W` : "—"} /><SettingRow label="Current run threshold" value={displayRunThreshold(athlete.zones?.run_threshold_pace) || "—"} /><SettingRow label="Current swim CSS" value={displaySwimCss(athlete.zones?.swim_css) || "—"} /><SettingRow label="Threshold heart rate" value={athlete.zones?.threshold_hr ? `${athlete.zones.threshold_hr} bpm` : "—"} /></Card>
      <ThresholdHistory history={athlete.zone_history} />
      {feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}
      <Button disabled={saving} onClick={() => void saveZones()}>{saving && <LoaderCircle className="animate-spin" />}Save training zones</Button>
    </div>
    if (id === "race") return <div className="space-y-6">
      <section className="space-y-2"><h3 className="text-sm font-semibold">Current race goal</h3>{currentGoal ? <Card className="gap-1 p-4 shadow-none"><p className="font-medium">{currentGoal.name}</p><p className="text-sm text-muted-foreground">{compactDate(currentGoal.date)}{currentGoal.priority ? ` · ${currentGoal.priority} race` : ""}</p></Card> : <p className="rounded-lg border border-dashed px-4 py-5 text-sm text-muted-foreground">No future race is scheduled.</p>}</section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Add a race</h3><p className="text-sm text-muted-foreground">This creates the event in Intervals.icu and adds it to the current ATP when one exists.</p>
        <div className="grid gap-3 sm:grid-cols-[1fr_10rem_8rem]"><div className="space-y-2"><Label htmlFor="race-name">Race name</Label><Input id="race-name" value={raceName} onChange={event => setRaceName(event.target.value)} placeholder="Race name" /></div><div className="space-y-2"><Label htmlFor="race-date">Date</Label><Input id="race-date" type="date" value={raceDate} onChange={event => setRaceDate(event.target.value)} /></div><div className="space-y-2"><Label htmlFor="race-priority">Priority</Label><select id="race-priority" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm" value={priority} onChange={event => setPriority(event.target.value)}><option value="A">A race</option><option value="B">B race</option><option value="C">C race</option></select></div></div>
        <Button disabled={saving} onClick={() => void addRace()}>{saving && <LoaderCircle className="animate-spin" />}Add race to Intervals.icu</Button>
      </section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Future events</h3>{upcoming.length ? <Card className="gap-0 divide-y py-0 shadow-none">{upcoming.map(event => <SettingRow key={event.id} label={`${event.priority ? `${event.priority} · ` : ""}${compactDate(event.date)}`} value={event.name} />)}</Card> : <p className="text-sm text-muted-foreground">No future events.</p>}</section>
      <section className="space-y-3"><h3 className="text-sm font-semibold">Race history</h3>{past.length ? <Card className="gap-0 divide-y py-0 shadow-none">{past.map(event => <SettingRow key={event.id} label={`${event.priority ? `${event.priority} · ` : ""}${compactDate(event.date)}`} value={event.name} />)}</Card> : <p className="text-sm text-muted-foreground">No past races in Intervals.icu.</p>}</section>
      {feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}{loadError && <p role="alert" className="text-sm text-destructive">{loadError}</p>}
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
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">{section ? renderPanel(section) : <div className="space-y-5">{groups.map(group => <section key={group.label}><h2 className="mb-2 px-1 text-sm text-muted-foreground">{group.label}</h2><SettingsList>{group.items.map(item => <SettingsListItem key={item.id} icon={item.icon} label={item.label} value={summary(item.id)} onClick={() => { setSection(item.id); setFeedback("") }} />)}</SettingsList></section>)}</div>}</div>
    </div>
    <div className="hidden min-h-0 flex-1 overflow-y-auto md:block"><div className="mx-auto w-full max-w-4xl px-8 py-14 lg:py-16"><h1 className="text-2xl font-medium tracking-tight">Settings</h1><p className="mt-1 text-sm text-muted-foreground">Manage training, race goals, and app preferences.</p><div className="mt-10 space-y-12">{groups.map(group => <section key={group.label}><h2 className="mb-4 text-sm font-medium">{group.label}</h2><Card className="gap-0 divide-y py-0 shadow-none">{group.items.map(item => { const Icon = item.icon; return <div key={item.id} className="flex min-h-16 items-center gap-3 px-4 py-3"><Icon className="size-4 text-muted-foreground" /><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.label}</p><p className="text-xs text-muted-foreground">{item.description}</p></div><span className="mr-2 max-w-56 truncate text-xs text-muted-foreground">{summary(item.id)}</span><Button variant="outline" size="sm" onClick={() => { setDialogSection(item.id); setFeedback("") }}>Manage</Button></div> })}</Card></section>)}</div></div></div>
    <Dialog open={Boolean(dialogSection)} onOpenChange={open => { if (!open) { setDialogSection(null); setFeedback("") } }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>{dialogItem?.label}</DialogTitle><DialogDescription>{dialogItem?.description}</DialogDescription></DialogHeader>{dialogSection && renderPanel(dialogSection)}</DialogContent></Dialog>
  </div>
}
