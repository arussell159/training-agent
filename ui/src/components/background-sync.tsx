import { useEffect, useRef, useState } from "react"
import { apiFetch } from "@/lib/api-client"
import {
  rememberTrainingContext,
  trainingMutationState,
  type TrainingContext,
} from "@/lib/training-context"
import {
  createBackgroundWorkoutSync,
  type BackgroundSyncResult,
} from "@/lib/background-workout-sync.mjs"

export function BackgroundSync() {
  const [error, setError] = useState("")
  const [startupError, setStartupError] = useState("")
  const startupRequested = useRef(false)
  const [retry, setRetry] = useState(0)
  const [pending, setPending] = useState(0)
  useEffect(() => {
    let active = true,
      lastCheck = 0,
      nextCheck = 0,
      failures = 0
    const controller = new AbortController()
    const request = async (
      path: string,
      payload?: object
    ): Promise<BackgroundSyncResult> => {
      const response = await apiFetch(path, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      })
      const result = (await response.json()) as BackgroundSyncResult & {
        startup_sync?: { status: string; error?: string }
      }
      if (active && result.startup_sync)
        setStartupError(result.startup_sync.error || "")
      if (!response.ok && !result.paused)
        throw Error(result.error || "The update could not be checked.")
      return result
    }
    let revision = trainingMutationState().revision
    const sync = createBackgroundWorkoutSync({
      issue: () => {
        // Claim before sending: rerenders, focus and ordinary retries must not
        // dispatch another workflow. A fresh page load gets a fresh claim.
        const startup = !startupRequested.current
        startupRequested.current = true
        return request(`/api/sync/probe-lease${startup ? "?startup=1" : ""}`)
      },
      probe: (token) => request("/api/workout-changes", { token }),
      importWorkouts: () => request("/api/sync?automatic=1"),
      flushEdits: (again) =>
        request(`/api/sync?mutations_only=1${again ? "&retry=1" : ""}`),
      onContext: (context) => {
        if (
          active &&
          revision === trainingMutationState().revision &&
          !trainingMutationState().busy
        )
          rememberTrainingContext(context)
      },
    })
    const showFailure = (e: unknown) => {
      if (active && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : "Sync needs attention.")
    }
    const eligible = () =>
      active &&
      document.visibilityState !== "hidden" &&
      navigator.onLine &&
      !trainingMutationState().busy
    const check = async () => {
      if (
        !eligible() ||
        sync.status().busy ||
        Date.now() < nextCheck ||
        Date.now() - lastCheck < 60000
      )
        return
      lastCheck = Date.now()
      revision = trainingMutationState().revision
      try {
        await sync.check()
        failures = 0
        if (active && !sync.status().paused) setError("")
      } catch (e) {
        // Source failures back off without falling back to Supabase reads.
        nextCheck =
          Date.now() + Math.min(900000, 120000 * 2 ** Math.min(failures++, 3))
        showFailure(e)
      }
    }
    const start = async () => {
      if (!eligible()) return
      revision = trainingMutationState().revision
      try {
        await sync.start()
        await check()
      } catch (e) {
        showFailure(e)
      }
    }
    const resume = () => {
      if (!sync.status().started) void start()
      else void check()
    }
    const edit = async () => {
      if (!active || !navigator.onLine) return
      revision = trainingMutationState().revision
      try {
        const result = await sync.edit(retry > 0)
        if (active) {
          setPending(result.queue?.pending || 0)
          setError(result.queue?.failed ? "An edit needs a sync retry." : "")
        }
      } catch (e) {
        showFailure(e)
      }
    }
    const contextUpdated = (event: Event) => {
      const context = (event as CustomEvent<TrainingContext>).detail
      const workouts = [
        ...new Map(
          [...context.history, ...context.planned].map((w) => [
            (w as { id?: string }).id,
            w as { sync_status?: string },
          ])
        ).values(),
      ]
      setPending(workouts.filter((w) => w.sync_status === "pending").length)
    }
    const restart = () => setRetry((value) => value + 1)
    const initial = window.setTimeout(() => {
      void (async () => {
        await start()
        if (retry > 0) await edit()
      })()
    }, 1500)
    const timer = window.setInterval(() => void check(), 120000)
    window.addEventListener("background-sync-restart", restart)
    window.addEventListener("focus", resume)
    window.addEventListener("online", resume)
    document.addEventListener("visibilitychange", resume)
    window.addEventListener("request-background-sync", edit)
    window.addEventListener("training-context-updated", contextUpdated)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(initial)
      window.clearInterval(timer)
      window.removeEventListener("background-sync-restart", restart)
      window.removeEventListener("focus", resume)
      window.removeEventListener("online", resume)
      document.removeEventListener("visibilitychange", resume)
      window.removeEventListener("request-background-sync", edit)
      window.removeEventListener("training-context-updated", contextUpdated)
    }
  }, [retry])
  const visibleError = error || startupError
  return visibleError || pending ? (
    <button
      type="button"
      role="status"
      onClick={() => {
        if (startupError) startupRequested.current = false
        setStartupError("")
        setRetry((v) => v + 1)
      }}
      className="fixed right-4 bottom-[calc(6.5rem+env(safe-area-inset-bottom))] z-30 max-w-64 rounded-xl border bg-background/95 px-3 py-2 text-left text-xs shadow-sm md:bottom-4"
    >
      {visibleError
        ? `${visibleError} Tap to retry.`
        : `${pending} saved edit${pending === 1 ? "" : "s"} syncing to Intervals.icu…`}
    </button>
  ) : null
}
