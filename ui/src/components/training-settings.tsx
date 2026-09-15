import { apiFetch } from "@/lib/api-client"
import { useEffect, useState } from "react"
import { Bell, BellOff, Clock3, LoaderCircle } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import type { NotificationPreferences } from "@/lib/training-context"

function decodeApplicationKey(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

async function getPreferences() {
  const response = await apiFetch("/api/notification-settings", { headers:{ Accept:"application/json" } })
  if (!response.ok) throw new Error(`Notification settings ${response.status}`)
  return (await response.json()) as NotificationPreferences
}

async function patchPreferences(patch: Partial<Pick<NotificationPreferences,"enabled" | "reviewTime" | "timeZone">>) {
  const response = await apiFetch("/api/notification-settings", {
    method:"PATCH",
    headers:{ "Content-Type":"application/json", Accept:"application/json" },
    body:JSON.stringify(patch),
  })
  if (!response.ok) throw new Error(`Notification settings ${response.status}`)
  return (await response.json()) as NotificationPreferences
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: string; message?: string }
    return payload.error || payload.message || fallback
  } catch {
    return fallback
  }
}

function notificationSupportMessage() {
  if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
    return "Push delivery is unavailable in this browser. Daily reviews will still appear in Coach."
  }
  if (Notification.permission === "denied") {
    return "Notifications are blocked for this site. Allow them in browser or device settings, then enable this switch again. Daily reviews remain available in Coach."
  }
  return null
}

export function TrainingSettings({ embedded = false }: { embedded?: boolean }) {
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Chicago"

  useEffect(() => {
    void getPreferences().then(setPreferences).catch((error) => setMessage(error instanceof Error ? error.message : "Could not load notification settings."))
  }, [])

  async function enableNotifications() {
    const unavailable = notificationSupportMessage()
    if (unavailable) {
      setMessage(unavailable)
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const permission = await Notification.requestPermission()
      if (permission !== "granted") {
        setMessage(notificationSupportMessage() || "Notification permission was not granted. Daily reviews remain available in Coach.")
        return
      }
      const current = preferences || await getPreferences()
      if (!current.publicKey) throw new Error("Push delivery is not configured on the coaching server.")
      await navigator.serviceWorker.register("/sw.js")
      const ready = await navigator.serviceWorker.ready
      const existing = await ready.pushManager.getSubscription()
      const subscription = existing || await ready.pushManager.subscribe({
        userVisibleOnly:true,
        applicationServerKey:decodeApplicationKey(current.publicKey),
      })
      const subscriptionResponse = await apiFetch("/api/push-subscriptions", {
        method:"POST",
        headers:{ "Content-Type":"application/json", Accept:"application/json" },
        body:JSON.stringify(subscription.toJSON()),
      })
      if (!subscriptionResponse.ok) {
        throw new Error(await responseError(subscriptionResponse, "The device could not be registered for push delivery."))
      }
      setPreferences(await patchPreferences({ enabled:true, timeZone:browserTimeZone }))
      setMessage("Workout notifications are on. You’ll receive one combined review on scheduled workout days.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notifications could not be enabled.")
    } finally {
      setBusy(false)
    }
  }

  async function disableNotifications() {
    setBusy(true)
    setMessage(null)
    try {
      const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : undefined
      const subscription = await registration?.pushManager.getSubscription()
      if (subscription) {
        await apiFetch("/api/push-subscriptions", {
          method:"DELETE",
          headers:{ "Content-Type":"application/json" },
          body:JSON.stringify({ endpoint:subscription.endpoint }),
        })
        await subscription.unsubscribe()
      }
      setPreferences(await patchPreferences({ enabled:false }))
      setMessage("Push messages are off. Daily reviews will still be saved in Coach.")
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notifications could not be disabled.")
    } finally {
      setBusy(false)
    }
  }

  async function updateReviewTime(value: string) {
    if (!preferences || value === preferences.reviewTime) return
    setBusy(true)
    try {
      setPreferences(await patchPreferences({ reviewTime:value, timeZone:browserTimeZone }))
      setMessage(`Daily reviews are scheduled for ${value} ${browserTimeZone}, or one hour before an earlier scheduled workout.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The review time could not be saved.")
    } finally {
      setBusy(false)
    }
  }

  const unavailable = typeof window !== "undefined" ? notificationSupportMessage() : null

  return (
    <div className={embedded ? "w-full" : "w-full overflow-y-auto"}>
      <div className={embedded ? "space-y-6" : "mx-auto max-w-3xl space-y-6 p-4 sm:p-6 md:p-8"}>
        {!embedded && <div>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted-foreground">Manage coaching delivery and review timing.</p>
        </div>}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {preferences?.enabled ? <Bell className="size-4" /> : <BellOff className="size-4" />}
              Workout notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <Label htmlFor="workout-notifications">Workout notifications: {preferences?.enabled ? "On" : "Off"}</Label>
                <p className="mt-1 text-sm text-muted-foreground">One combined notification on days with scheduled workouts.</p>
              </div>
              {busy && !preferences ? <LoaderCircle className="size-5 animate-spin" /> : (
                <Switch
                  id="workout-notifications"
                  aria-label="Workout notifications"
                  checked={Boolean(preferences?.enabled)}
                  disabled={busy || !preferences}
                  onCheckedChange={(checked) => void (checked ? enableNotifications() : disableNotifications())}
                />
              )}
            </div>

            <div className="grid gap-2 sm:max-w-xs">
              <Label htmlFor="review-time" className="flex items-center gap-2"><Clock3 className="size-4" /> Review time</Label>
              <Input
                id="review-time"
                type="time"
                value={preferences?.reviewTime || "06:00"}
                disabled={busy || !preferences}
                onChange={(event) => setPreferences((current) => current ? { ...current, reviewTime:event.target.value } : current)}
                onBlur={(event) => void updateReviewTime(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">{preferences?.timeZone || browserTimeZone}. If the first scheduled workout is earlier, the review is moved to one hour before it where possible.</p>
            </div>

            {(unavailable || message || preferences?.lastDeliveryError) && (
              <p role="status" className={`text-sm ${unavailable || preferences?.lastDeliveryError ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}>
                {unavailable || message || preferences?.lastDeliveryError}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
