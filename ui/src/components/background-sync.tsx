import { useEffect } from "react"
import { apiFetch } from "@/lib/api-client"
import {
  rememberTrainingContext,
  trainingMutationState,
  type TrainingContext,
} from "@/lib/training-context"

const NEXT_CHECK_KEY = "training-agent-next-background-sync"
const CHECK_INTERVAL_MS = 15 * 60_000
const RETRY_INTERVAL_MS = 5 * 60_000

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
    let initialCheckStarted = false
    const controller = new AbortController()

    const check = async () => {
      if (busy) {
        pendingCheck = true
        return
      }
      if (!active || trainingMutationState().busy || !navigator.onLine) return
      busy = true
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
          section11Sync?: { status: string; error?: string }
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
        scheduleNext(CHECK_INTERVAL_MS)
        if (result.section11Pending) {
          try {
            const exportResponse = await apiFetch("/api/sync?section11Only=1", {
              method: "POST",
              signal: controller.signal,
            })
            const exportResult = (await exportResponse.json()) as {
              section11Sync?: { status: string; error?: string }
              error?: string
            }
            if (!exportResponse.ok || exportResult.section11Sync?.status !== "complete")
              throw Error(exportResult.section11Sync?.error || exportResult.error || "Section 11 export failed.")
          } catch (error) {
            if (active && !controller.signal.aborted)
              console.warn("Section 11 files could not be updated after the workout refresh.", error)
          }
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
        initialCheckStarted = true
        scheduleNext(CHECK_INTERVAL_MS)
        void check()
      }
    }
    // Opening the app always checks once; the 15-minute gate applies only
    // while the same page stays open and the user resumes interacting.
    const start = window.setTimeout(checkWhenDue, 2000)
    const interaction = () => {
      if (Date.now() - lastInteractionCheck < 60_000) return
      lastInteractionCheck = Date.now()
      checkWhenDue()
    }
    const edit = () => window.setTimeout(() => void check(), 0)
    window.addEventListener("request-background-sync", edit)
    window.addEventListener("focus", checkWhenDue)
    window.addEventListener("pointerdown", interaction, { passive: true })
    window.addEventListener("keydown", interaction)
    window.addEventListener("wheel", interaction, { passive: true })
    document.addEventListener("visibilitychange", checkWhenDue)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(start)
      window.removeEventListener("request-background-sync", edit)
      window.removeEventListener("focus", checkWhenDue)
      window.removeEventListener("pointerdown", interaction)
      window.removeEventListener("keydown", interaction)
      window.removeEventListener("wheel", interaction)
      document.removeEventListener("visibilitychange", checkWhenDue)
    }
  }, [])
  return null
}
