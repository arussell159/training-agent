import { useEffect, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import { Button } from "@/components/ui/button"

type Status = {
  apiConnected: boolean
  oauthConfigured: boolean
  oauthConnected: boolean
  scopesComplete: boolean
  webhookConfigured: boolean
  lastDeliveryAt: string | null
  lastSyncedAt: string | null
  lastError: string | null
  pending: boolean
}

export function IntervalsConnection() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState("")
  const load = async () => {
    const response = await apiFetch("/api/intervals/status")
    const body = await response.json()
    if (!response.ok) throw Error(body.error || "Connection status unavailable")
    setStatus(body)
  }
  useEffect(() => { void load().catch(error => setMessage(error.message)) }, [])
  const run = async (operation: () => Promise<void>) => {
    setBusy(true)
    setMessage("")
    try { await operation() }
    catch (error) { setMessage(error instanceof Error ? error.message : "Please try again.") }
    finally { setBusy(false) }
  }
  const connect = () => run(async () => {
    const response = await apiFetch("/api/intervals/oauth/start", { method: "POST" })
    const body = await response.json()
    if (!response.ok) throw Error(body.error || "Could not start authorization")
    window.location.assign(body.url)
  })
  const date = (value: string | null) => value ? new Date(value).toLocaleString() : "Awaiting first update"
  const connected = status?.oauthConnected && status.scopesComplete && status.webhookConfigured
  return <div className="space-y-5">
    <p className="text-sm text-muted-foreground">Your activities, wellness, and calendar update automatically. Saved training data stays available while updates arrive.</p>
    {status && <dl className="space-y-2 text-sm">
      {[
        ["Intervals.icu", status.apiConnected ? "Connected" : "Connection setup in progress"],
        ["Automatic updates", connected ? "Connected" : "Connection setup in progress"],
        ["Last delivery", date(status.lastDeliveryAt)],
        ["Last background sync", date(status.lastSyncedAt)],
      ].map(([label, value]) => <div key={label} className="flex justify-between gap-4"><dt>{label}</dt><dd className="text-right text-muted-foreground">{value}</dd></div>)}
    </dl>}
    {status?.pending && <p className="text-sm">An update is queued.</p>}
    {status?.lastError && <p role="alert" className="text-sm">{status.lastError}</p>}
    {status?.oauthConfigured && status.apiConnected && !connected && <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Authorize your athlete once to enable automatic updates.</p>
      <Button disabled={busy} onClick={() => void connect()}>Authorize athlete</Button>
    </div>}
    <Button variant="outline" disabled={busy} onClick={() => void run(load)}>Refresh status</Button>
    {message && <p role="status" className="text-sm">{message}</p>}
  </div>
}
