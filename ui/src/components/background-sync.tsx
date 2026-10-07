import { useEffect } from "react"
import { apiFetch } from "@/lib/api-client"
import { withRequestDeadline } from "@/lib/request-deadline"
import {
  cachedTrainingContext,
  rememberLiveTrainingContext,
  trainingMutationState,
  type TrainingContext,
} from "@/lib/training-context"

export function BackgroundSync() {
  useEffect(() => {
    let busy = false,
      active = true,
      timer = 0,
      lastCheck = Date.now(),
      failures = 0,
      syncing = false
    const controller = new AbortController()
    const check = async (force = false) => {
      if (!active || busy) return
      if (
        document.visibilityState === "hidden" ||
        !navigator.onLine ||
        trainingMutationState().busy
      ) {
        window.clearTimeout(timer)
        timer = window.setTimeout(() => void check(), 30_000)
        return
      }
      if (!force && Date.now() - lastCheck < 30_000) return
      busy = true
      lastCheck = Date.now()
      const revision = trainingMutationState().revision
      try {
        const result = await withRequestDeadline(
          async (signal) => {
            const cached = cachedTrainingContext() as TrainingContext & { version?: string }
            // A week snapshot cannot stand in for the full archive on the first poll.
            const version = cached.context_scope === "full" ? cached.version : undefined
            const query = version ? `?${new URLSearchParams({ version })}` : ""
            const response = await apiFetch(`/api/training-updates${query}`, { signal })
            const body = (await response.json()) as {
              context?: TrainingContext
              error?: string
              unchanged?: boolean
              pending?: boolean
            }
            if (!response.ok || (!body.context && !body.unchanged))
              throw Error(body.error || "Training check failed")
            return body
          },
          20_000,
          controller.signal
        )
        if (
          active && result.context &&
          revision === trainingMutationState().revision &&
          !trainingMutationState().busy
        )
          rememberLiveTrainingContext(result.context)
        failures = 0
        window.dispatchEvent(new Event("github-sync-check"))
      } catch {
        failures++
      } finally {
        busy = false
        window.clearTimeout(timer)
        if (active)
          timer = window.setTimeout(
            () => void check(),
            Math.min(300_000, 30_000 * 2 ** Math.min(failures, 3))
          )
      }
    }
    const resume = () => void check()
    const edited = () => {
      if (!active || syncing || !navigator.onLine) return
      syncing = true
      void withRequestDeadline(
        (signal) =>
          apiFetch("/api/sync?trainingOnly=1", { method: "POST", signal }),
        90_000,
        controller.signal
      )
        .then((response) => {
          if (response.ok && active) return check(true)
        })
        .catch(() => {})
        .finally(() => {
          syncing = false
        })
    }
    // The active page owns the first data load. Polling begins after it settles.
    timer = window.setTimeout(() => void check(), 30_000)
    window.addEventListener("focus", resume)
    window.addEventListener("online", resume)
    document.addEventListener("visibilitychange", resume)
    window.addEventListener("request-background-sync", edited)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
      window.removeEventListener("focus", resume)
      window.removeEventListener("online", resume)
      document.removeEventListener("visibilitychange", resume)
      window.removeEventListener("request-background-sync", edited)
    }
  }, [])
  return null
}
