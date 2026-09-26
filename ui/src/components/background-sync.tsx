import { useEffect } from "react"
import { apiFetch } from "@/lib/api-client"
import {
  markSection11ExportPending,
  section11ExportPending,
  syncSection11Export,
  waitForSection11Export,
  type Section11Sync,
} from "@/lib/section11-export"
import {
  rememberTrainingContext,
  trainingMutationState,
  type TrainingContext,
} from "@/lib/training-context"

const NEXT_CHECK_KEY = "training-agent-next-background-sync"
const CHECK_INTERVAL_MS = 15 * 60_000
const FOLLOW_UP_INTERVAL_MS = 2 * 60_000
const RETRY_INTERVAL_MS = 5 * 60_000
const EXPORT_RETRY_INTERVAL_MS = 60_000
const RESUME_IDLE_MS = 2 * 60_000

function nextCheck() {
  try {
    return Number(localStorage.getItem(NEXT_CHECK_KEY)) || 0
  } catch {
    return 0
  }
}

function scheduleNext(delay: number) {
  try {
    localStorage.setItem(NEXT_CHECK_KEY, String(Date.now() + delay))
  } catch {
    // A private browsing session can still sync without persistent throttling.
  }
}

export function BackgroundSync() {
  useEffect(() => {
    let active = true
    let busy = false
    let pendingCheck = false
    let failures = 0
    let lastInteractionCheck = 0
    let lastActivityAt = Date.now()
    let initialCheckStarted = false
    let quickFollowUp = false
    let followUpTimer = 0
    const controller = new AbortController()

    const check = async () => {
      if (busy) {
        pendingCheck = true
        return
      }
      if (!active || trainingMutationState().busy || !navigator.onLine) return
      busy = true
      window.clearTimeout(followUpTimer)
      const revision = trainingMutationState().revision
      try {
        const response = await apiFetch("/api/sync?trainingOnly=1", {
          method: "POST",
          signal: controller.signal,
        })
        const result = (await response.json()) as {
          context?: TrainingContext
          error?: string
          sync_error?: string
          section11Pending?: boolean
          sourceChanged?: boolean
          section11Sync?: Section11Sync
          queue?: { failed: number }
        }
        if (!response.ok || !result.context)
          throw Error(result.error || "Background training sync failed.")
        if (result.sync_error) throw Error(result.sync_error)
        if (active && revision === trainingMutationState().revision && !trainingMutationState().busy)
          rememberTrainingContext(result.context)
        if (result.section11Sync?.status === "failed" || result.queue?.failed)
          console.warn(result.section11Sync?.error || "A saved edit needs a sync retry.")
        failures = 0
        const needsFollowUp = quickFollowUp && !result.sourceChanged
        scheduleNext(needsFollowUp ? FOLLOW_UP_INTERVAL_MS : CHECK_INTERVAL_MS)
        quickFollowUp = false
        if (result.section11Pending) {
          markSection11ExportPending()
        }
        if (result.section11Sync || section11ExportPending()) {
          try {
            if (result.section11Sync) await waitForSection11Export(result.section11Sync)
            else await syncSection11Export()
          } catch (error) {
            if (active && !controller.signal.aborted) {
              console.warn("Section 11 files could not be updated after the workout refresh.", error)
              scheduleNext(EXPORT_RETRY_INTERVAL_MS)
            }
          }
        }
        if (needsFollowUp || section11ExportPending()) {
          followUpTimer = window.setTimeout(() => {
            if (active && !busy) checkWhenDue()
          }, Math.max(0, nextCheck() - Date.now()) + 100)
        }
      } catch (error) {
        if (active && !controller.signal.aborted) {
          console.warn("Background training sync will retry later.", error)
          failures += 1
          scheduleNext(Math.min(60 * 60_000, RETRY_INTERVAL_MS * 2 ** Math.min(failures - 1, 4)))
        }
      } finally {
        busy = false
        if (active && pendingCheck) {
          pendingCheck = false
          window.setTimeout(() => void check(), 0)
        }
      }
    }

    const checkWhenDue = () => {
      if (document.visibilityState === "visible" && navigator.onLine && (!initialCheckStarted || Date.now() >= nextCheck())) {
        if (!initialCheckStarted) quickFollowUp = true
        initialCheckStarted = true
        scheduleNext(CHECK_INTERVAL_MS)
        void check()
      }
    }
    const checkOnResume = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return
      const now = Date.now()
      const wasIdle = now - lastActivityAt >= RESUME_IDLE_MS
      lastActivityAt = now
      if (wasIdle && !busy) {
        quickFollowUp = true
        initialCheckStarted = true
        scheduleNext(CHECK_INTERVAL_MS)
        void check()
      } else checkWhenDue()
    }
    // Opening or resuming checks once, then allows one short follow-up for
    // workouts that arrive in Intervals.icu shortly after the first check.
    // Only this one follow-up runs without interaction; idle tabs do not keep polling.
    const start = window.setTimeout(checkWhenDue, 2000)
    const interaction = () => {
      const now = Date.now()
      const wasIdle = now - lastActivityAt >= RESUME_IDLE_MS
      lastActivityAt = now
      if (wasIdle) {
        if (!busy) {
          quickFollowUp = true
          initialCheckStarted = true
          scheduleNext(CHECK_INTERVAL_MS)
          void check()
        }
        lastInteractionCheck = now
        return
      }
      if (now - lastInteractionCheck < 60_000) return
      lastInteractionCheck = now
      checkWhenDue()
    }
    const edit = () => window.setTimeout(() => void check(), 0)
    window.addEventListener("request-background-sync", edit)
    window.addEventListener("focus", checkOnResume)
    window.addEventListener("online", checkOnResume)
    window.addEventListener("pointerdown", interaction, { passive: true })
    window.addEventListener("keydown", interaction)
    window.addEventListener("wheel", interaction, { passive: true })
    document.addEventListener("visibilitychange", checkOnResume)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(start)
      window.clearTimeout(followUpTimer)
      window.removeEventListener("request-background-sync", edit)
      window.removeEventListener("focus", checkOnResume)
      window.removeEventListener("online", checkOnResume)
      window.removeEventListener("pointerdown", interaction)
      window.removeEventListener("keydown", interaction)
      window.removeEventListener("wheel", interaction)
      document.removeEventListener("visibilitychange", checkOnResume)
    }
  }, [])
  return null
}
