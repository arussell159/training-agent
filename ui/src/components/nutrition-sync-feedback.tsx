import { useEffect, useRef } from "react"
import { useToastManager } from "@/components/ui/toast"
import { deviceCacheScope } from "@/lib/device-cache"
import { apiSessionRevision } from "@/lib/api-client"
import {
  pendingNutritionWrite,
  recoverPendingNutritionWrite,
  nutritionWriteInFlight,
  type NutritionWriteResult,
} from "@/lib/pending-nutrition-write"

/** One app-level recovery owner; leaving Nutrition never cancels an accepted intent. */
export function NutritionSyncFeedback() {
  const toast = useToastManager()
  const toastRef = useRef(toast)
  useEffect(() => {
    toastRef.current = toast
  }, [toast])
  useEffect(() => {
    let mounted = true
    let active = false
    const update = (state: string) =>
      window.dispatchEvent(
        new CustomEvent("nutrition-write-recovery", { detail: { state } })
      )
    const recover = async () => {
      const scope = deviceCacheScope(),
        session = apiSessionRevision()
      if (
        active ||
        scope === "initial" ||
        session === null ||
        document.visibilityState === "hidden"
      )
        return
      const current = () =>
        mounted &&
        scope === deviceCacheScope() &&
        session === apiSessionRevision()
      let input
      try {
        input = pendingNutritionWrite(localStorage, scope)
      } catch (problem) {
        toastRef.current.add({
          id: "nutrition-save",
          type: "error",
          title: "Food save needs attention",
          description: (problem as Error).message,
          timeout: 0,
        })
        return
      }
      if (!input || nutritionWriteInFlight(scope, input.operationId)) return
      const retry = (
        <button
          className="min-h-11 font-semibold underline"
          onClick={() => void recover()}
        >
          Retry saved food entry
        </button>
      )
      if (!navigator.onLine) {
        toastRef.current.add({
          id: "nutrition-save",
          type: "info",
          title: "Offline — food entry retained",
          description: (
            <>
              Not yet confirmed saved. Reconnect to confirm your {input.date}{" "}
              food log. {retry}
            </>
          ),
          timeout: 0,
        })
        update("offline")
        return
      }
      active = true
      update("pending")
      toastRef.current.add({
        id: "nutrition-save",
        type: "loading",
        title: "Confirming retained food entry…",
        description: `Checking your ${input.date} food log.`,
        timeout: 0,
      })
      try {
        // Defer the nutrition route's dependency graph until recovery is needed.
        let confirmedResult: NutritionWriteResult | undefined
        const recovered = await recoverPendingNutritionWrite(
          localStorage,
          scope,
          current,
          async () => {
            const { nutritionRequest } = await import("@/lib/nutrition")
            return async (payload) => {
              const result = await nutritionRequest<NutritionWriteResult>(
                "/entries",
                payload
              )
              confirmedResult = result
              return result
            }
          }
        )
        if (!recovered || !current()) return
        const { nutritionChanged, recordRecentFoods, reconcileNutritionWrite } =
          await import("@/lib/nutrition")
        if (input.action === "add" && input.entries)
          recordRecentFoods(input.entries)
        if (
          !confirmedResult ||
          !reconcileNutritionWrite(input, confirmedResult)
        )
          nutritionChanged()
        update("success")
        toastRef.current.update("nutrition-save", {
          type: "success",
          title: "Food entry saved.",
          description: `Confirmed in your food log for ${input.date}.`,
          timeout: 5500,
        })
      } catch (problem) {
        if (current()) {
          update("error")
          toastRef.current.update("nutrition-save", {
            type: "error",
            title: "Food entry is not confirmed saved",
            description: (
              <>
                {(problem as Error).message} {retry}
              </>
            ),
            timeout: 0,
          })
        }
      } finally {
        active = false
      }
    }
    const check = () => {
      void recover()
    }
    const retained = () => {
      if (!mounted) return
      const scope = deviceCacheScope()
      if (scope === "initial" || apiSessionRevision() === null) return
      try {
        const input = pendingNutritionWrite(localStorage, scope)
        if (!input) return
        toastRef.current.add({
          id: "nutrition-save",
          type: navigator.onLine ? "error" : "info",
          title: navigator.onLine
            ? "Food entry needs confirmation"
            : "Offline — food entry retained",
          description: (
            <>
              Your {input.date} entry is retained on this device and has not
              been confirmed saved.{" "}
              <button
                className="min-h-11 font-semibold underline"
                onClick={check}
              >
                Retry saved food entry
              </button>
            </>
          ),
          timeout: 0,
        })
      } catch {
        /* Corrupt recovery is surfaced by the next explicit recovery attempt. */
      }
    }
    // Let the originating editor settle its error announcement first, then
    // retain one actionable app-level notice even after that editor closes.
    const retainedNotice = () => setTimeout(retained, 0)
    window.addEventListener("nutrition-write-retained", retainedNotice)
    check()
    for (const name of [
      "online",
      "offline",
      "pageshow",
      "training-context-updated",
      "device-cache-cleared",
      "nutrition-write-retry",
    ])
      window.addEventListener(name, check)
    document.addEventListener("visibilitychange", check)
    return () => {
      mounted = false
      window.removeEventListener("nutrition-write-retained", retainedNotice)
      for (const name of [
        "online",
        "offline",
        "pageshow",
        "training-context-updated",
        "device-cache-cleared",
        "nutrition-write-retry",
      ])
        window.removeEventListener(name, check)
      document.removeEventListener("visibilitychange", check)
    }
  }, [])
  return null
}
