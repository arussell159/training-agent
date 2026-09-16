import { apiFetch } from "@/lib/api-client"
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
import { useEffect, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import {
  Activity,
  Bell,
  ChevronLeft,
  ChevronRight,
  Database,
  Gauge,
  LoaderCircle,
  Sparkles,
  SunMoon,
  Trophy,
} from "lucide-react"

import { TrainingSettings as NotificationSettings } from "@/components/training-settings"
import { displayRunThreshold, displaySwimCss, ThresholdHistory } from "@/components/training-zones-display"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useTheme } from "@/components/theme-provider"
import {
  fallbackTrainingContext,
  loadTrainingContext,
  type NotificationPreferences,
  type TrainingContext,
} from "@/lib/training-context"

type SettingsSection =
  | "intervals"
  | "openai"
  | "supabase"
  | "zones"
  | "race"
  | "appearance"
  | "notifications"

type ConfigStatus = {
  settingsError?: string | null
  intervalsConnected: boolean
  openAIConnected: boolean
  supabaseConnected: boolean
  supabaseNeedsUrl: boolean
}

type SettingsItem = {
  id: SettingsSection
  label: string
  description: string
  icon: LucideIcon
}

const groups: Array<{ label: string; items: SettingsItem[] }> = [
  {
    label: "Connections",
    items: [
      { id: "intervals", label: "Intervals.icu", description: "Workouts and recovery", icon: Activity },
      { id: "openai", label: "OpenAI", description: "AI coaching", icon: Sparkles },
      { id: "supabase", label: "Supabase", description: "Training context storage", icon: Database },
    ],
  },
  {
    label: "Athlete",
    items: [
      { id: "zones", label: "Training zones", description: "Bike, run, and swim thresholds", icon: Gauge },
      { id: "race", label: "Race goal", description: "Event and training phase", icon: Trophy },
    ],
  },
  {
    label: "Preferences",
    items: [
      { id: "appearance", label: "Appearance", description: "Light, dark, or system", icon: SunMoon },
      { id: "notifications", label: "Notifications", description: "Daily coaching review", icon: Bell },
    ],
  },
]

const allItems = groups.flatMap((group) => group.items)

function getItem(section: SettingsSection | null) {
  return allItems.find((item) => item.id === section)
}

function SettingValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  )
}

function MobileRow({ item, value, onClick }: { item: SettingsItem; value: string; onClick: () => void }) {
  const Icon = item.icon
  return (
    <Button type="button" variant="ghost" className="h-14 w-full justify-start rounded-none px-4 font-normal" onClick={onClick}>
      <Icon className="size-4 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
      <span className="max-w-28 truncate text-xs text-muted-foreground">{value}</span>
      <ChevronRight className="size-4 text-muted-foreground/70" />
    </Button>
  )
}

export function SettingsWorkspace() {
  const [config, setConfig] = useState<ConfigStatus>({
    intervalsConnected: false,
    openAIConnected: false,
    supabaseConnected: false,
    supabaseNeedsUrl: false,
  })
  const [context, setContext] = useState<TrainingContext>(fallbackTrainingContext)
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences | null>(null)
  const [mobileSection, setMobileSection] = useState<SettingsSection | null>(null)
  const [dialogSection, setDialogSection] = useState<SettingsSection | null>(null)
  const [intervalsKey, setIntervalsKey] = useState("")
  const [openAIKey, setOpenAIKey] = useState("")
  const [supabaseUrl, setSupabaseUrl] = useState("")
  const [supabaseKey, setSupabaseKey] = useState("")
  const [saving, setSaving] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [loadError, setLoadError] = useState("")
  const [checkingConnection, setCheckingConnection] = useState(false)
  const settingsRevision = useRef(0)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    let active = true
    const revision = settingsRevision.current
    void Promise.all([
      apiFetch("/api/config", { cache: "no-store", headers: { Accept: "application/json" } })
        .then(async response => {
          const value = await response.json() as ConfigStatus & { error?: string }
          if (!response.ok) throw new Error(value.error || "Saved Settings could not be loaded.")
          if (active && revision === settingsRevision.current) {
            setConfig(value)
            setLoadError(value.settingsError || "")
          }
        }).catch(error => { if (active && revision === settingsRevision.current) setLoadError(error instanceof Error ? error.message : "Saved Settings could not be loaded.") }),
      loadTrainingContext().then(setContext),
      apiFetch("/api/notification-settings", { headers: { Accept: "application/json" } })
        .then((response) => response.json())
        .then((value) => setNotificationPreferences(value as NotificationPreferences))
        .catch(() => undefined),
    ])
    return () => { active = false }
  }, [])

  async function retrySettingsConnection() {
    const revision = ++settingsRevision.current
    setCheckingConnection(true)
    try {
      const response = await apiFetch("/api/config", { cache: "no-store", headers: { Accept: "application/json" } })
      const value = await response.json() as ConfigStatus & { error?: string }
      if (!response.ok || value.settingsError) throw new Error(value.settingsError || value.error || "Saved Settings could not be loaded.")
      if (revision === settingsRevision.current) { setConfig(value); setLoadError("") }
    } catch (error) {
      if (revision === settingsRevision.current) setLoadError(error instanceof Error ? error.message : "Saved Settings could not be loaded.")
    } finally { setCheckingConnection(false) }
  }

  function connectionStatus(section: SettingsSection) {
    if (loadError && ["intervals", "openai", "supabase"].includes(section)) return "Unavailable"
    if (section === "intervals") return config.intervalsConnected ? "Connected" : "Not connected"
    if (section === "openai") return config.openAIConnected ? "Connected" : "Not connected"
    if (section === "supabase") return config.supabaseConnected ? "Connected" : config.supabaseNeedsUrl ? "URL needed" : "Not connected"
    return ""
  }

  function summary(section: SettingsSection) {
    if (["intervals", "openai", "supabase"].includes(section)) return connectionStatus(section)
    if (section === "zones") return "Configured"
    if (section === "race") return context.athlete.race ?? "Not set"
    if (section === "appearance") return theme[0].toUpperCase() + theme.slice(1)
    if (section === "notifications") return notificationPreferences?.enabled ? "On" : "Off"
    return ""
  }

  async function saveConnection(section: SettingsSection) {
    const payload: Record<string, string> = {}
    if (section === "intervals" && intervalsKey.trim()) payload.INTERVALS_API_KEY = intervalsKey.trim()
    if (section === "openai" && openAIKey.trim()) payload.OPENAI_API_KEY = openAIKey.trim()
    if (section === "supabase") {
      if (supabaseUrl.trim()) payload.SUPABASE_URL = supabaseUrl.trim()
      if (supabaseKey.trim()) payload.SUPABASE_SECRET_KEY = supabaseKey.trim()
    }
    if (!Object.keys(payload).length) {
      setFeedback("Enter the updated credential first.")
      return
    }

    setSaving(true)
    settingsRevision.current += 1
    setFeedback("")
    try {
      const response = await apiFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      })
      const result = (await response.json()) as ConfigStatus & { error?: string }
      if (!response.ok) throw new Error(result.error || "Could not save the connection.")
      setConfig(result)
      setLoadError("")
      setIntervalsKey("")
      setOpenAIKey("")
      setSupabaseUrl("")
      setSupabaseKey("")
      if (section === "intervals") setContext(await loadTrainingContext(true, "full"))
      setFeedback(section === "intervals" ? "Intervals.icu connection verified and saved to Supabase." : "Settings saved to Supabase.")
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not save the connection.")
    } finally {
      setSaving(false)
    }
  }

  async function saveAppearance(value: "light" | "dark" | "system") {
    setSaving(true)
    setFeedback("")
    try {
      await setTheme(value)
      setFeedback("Appearance saved to Supabase.")
    } catch (error) { setFeedback(error instanceof Error ? error.message : "Appearance could not be saved.") }
    finally { setSaving(false) }
  }

  function renderPanel(section: SettingsSection) {
    const athlete = context.athlete
    const zones = athlete.zones
    if (["intervals", "openai", "supabase"].includes(section)) {
      const connected = connectionStatus(section) === "Connected"
      return (
        <div className="space-y-5">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Settings are saved in Supabase. Credentials are encrypted and only accessed by the backend; stored keys are never returned to this page.</p>
            <Badge variant={connected ? "secondary" : "outline"}>{connectionStatus(section)}</Badge>
          </div>
          {section === "intervals" && (
            <div className="space-y-2">
              <Label htmlFor="intervals-key">Intervals.icu API key</Label>
              <Input id="intervals-key" type="password" value={intervalsKey} onChange={(event) => setIntervalsKey(event.target.value)} placeholder="Paste your personal API key" />
            </div>
          )}
          {section === "openai" && (
            <div className="space-y-2">
              <Label htmlFor="openai-key">OpenAI API key</Label>
              <Input id="openai-key" type="password" value={openAIKey} onChange={(event) => setOpenAIKey(event.target.value)} placeholder="sk-..." />
            </div>
          )}
          {section === "supabase" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">The database connection bootstraps Settings storage. On a deployment, configure SUPABASE_URL and SUPABASE_SECRET_KEY in the server environment; these cannot be saved inside the database they unlock.</p>
              <div className="space-y-2">
                <Label htmlFor="supabase-url">Project URL</Label>
                <Input id="supabase-url" value={supabaseUrl} onChange={(event) => setSupabaseUrl(event.target.value)} placeholder="https://project.supabase.co" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supabase-key">Secret key</Label>
                <Input id="supabase-key" type="password" value={supabaseKey} onChange={(event) => setSupabaseKey(event.target.value)} placeholder="Paste the project secret" />
              </div>
            </div>
          )}
          {feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}
          <Button className="w-full sm:w-auto" disabled={saving} onClick={() => void saveConnection(section)}>
            {saving && <LoaderCircle className="animate-spin" />}
            Save connection
          </Button>
        </div>
      )
    }
    if (section === "zones") {
      return (
        <div className="space-y-6">
          <Card className="gap-0 divide-y py-0 shadow-none">
            <SettingValue label="Bike FTP" value={zones?.bike_ftp ? `${zones.bike_ftp} W` : "—"} />
            <SettingValue label="Run threshold pace" value={displayRunThreshold(zones?.run_threshold_pace) ?? "—"} />
            <SettingValue label="Swim CSS" value={displaySwimCss(zones?.swim_css) ?? "—"} />
            <SettingValue label="Threshold heart rate" value={zones?.threshold_hr ? `${zones.threshold_hr} bpm` : "—"} />
          </Card>
          <ThresholdHistory history={athlete.zone_history}/>
        </div>
      )
    }
    if (section === "race") {
      return (
        <Card className="gap-0 divide-y py-0 shadow-none">
          <SettingValue label="Event" value={athlete.race ?? "—"} />
          <SettingValue label="Race date" value={athlete.race_date ?? "—"} />
          <SettingValue label="Current phase" value={athlete.phase ?? "—"} />
        </Card>
      )
    }
    if (section === "appearance") {
      return (
        <div className="space-y-3"><div className="grid grid-cols-3 gap-2">
          {(["light", "dark", "system"] as const).map((value) => (
            <Button key={value} disabled={saving} variant={theme === value ? "default" : "outline"} onClick={() => void saveAppearance(value)}>
              {value[0].toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>{feedback && <p role="status" className="text-sm text-muted-foreground">{feedback}</p>}</div>
      )
    }
    return <NotificationSettings embedded />
  }

  const mobileItem = getItem(mobileSection)
  const dialogItem = getItem(dialogSection)

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col bg-background">
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm text-destructive"><p>{loadError}</p><Button variant="outline" size="sm" disabled={checkingConnection || saving} onClick={() => void retrySettingsConnection()}>{checkingConnection ? <LoaderCircle className="size-4 animate-spin"/> : null}Retry connection</Button></div>}
      <div className="flex min-h-0 flex-1 flex-col md:hidden">
        <header className="mobile-site-header z-50 flex h-14 shrink-0 items-center border-b px-4">
          {mobileSection ? (
            <Button variant="ghost" size="icon-sm" aria-label="Back to settings menu" onClick={() => { setMobileSection(null); setFeedback("") }}><ChevronLeft /></Button>
          ) : (
            <h1 className="mobile-header-title text-sm font-semibold">Menu</h1>
          )}
          {mobileItem && <h1 className="mobile-header-title ml-2 truncate text-sm font-semibold">{mobileItem.label}</h1>}
        <MobileHeaderMenu /></header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
          {mobileSection ? renderPanel(mobileSection) : (
            <div className="space-y-5">
              {groups.map((group) => (
                <section key={group.label}>
                  <h2 className="mb-2 px-1 text-sm text-muted-foreground">{group.label}</h2>
                  <Card className="gap-0 divide-y overflow-hidden rounded-2xl py-0 shadow-none">
                    {group.items.map((item) => (
                      <MobileRow key={item.id} item={item} value={summary(item.id)} onClick={() => { setMobileSection(item.id); setFeedback("") }} />
                    ))}
                  </Card>
                </section>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="hidden min-h-0 flex-1 overflow-y-auto md:block">
        <div className="mx-auto w-full max-w-4xl px-8 py-14 lg:py-16">
          <h1 className="text-2xl font-medium tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage coaching connections, athlete context, and app preferences.</p>
          <div className="mt-10 space-y-12">
            {groups.map((group) => (
              <section key={group.label}>
                <h2 className="mb-4 text-sm font-medium">{group.label}</h2>
                <Card className="gap-0 divide-y py-0 shadow-none">
                  {group.items.map((item) => {
                    const Icon = item.icon
                    return (
                      <div key={item.id} className="flex min-h-16 items-center gap-3 px-4 py-3">
                        <Icon className="size-4 text-muted-foreground" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{item.label}</p>
                          <p className="text-xs text-muted-foreground">{item.description}</p>
                        </div>
                        <span className="mr-2 text-xs text-muted-foreground">{summary(item.id)}</span>
                        <Button variant="outline" size="sm" onClick={() => { setDialogSection(item.id); setFeedback("") }}>Manage</Button>
                      </div>
                    )
                  })}
                </Card>
              </section>
            ))}
          </div>
        </div>
      </div>

      <Dialog open={Boolean(dialogSection)} onOpenChange={(open) => { if (!open) { setDialogSection(null); setFeedback("") } }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{dialogItem?.label}</DialogTitle>
            <DialogDescription>{dialogItem?.description}</DialogDescription>
          </DialogHeader>
          {dialogSection && renderPanel(dialogSection)}
        </DialogContent>
      </Dialog>
    </div>
  )
}
