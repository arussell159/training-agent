import { useEffect, useState } from "react"
import { Check } from "lucide-react"
import { apiFetch } from "@/lib/api-client"
import { withRequestDeadline } from "@/lib/request-deadline"
import { cachedTrainingContext } from "@/lib/training-context"

export function GithubSyncIndicator() {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let active = true,
      busy = false,
      timer = 0,
      lastCheckedAt = 0,
      failures = 0
    const controller = new AbortController()
    const check = async () => {
      if (
        !active ||
        busy ||
        document.visibilityState === "hidden" ||
        !navigator.onLine
      )
        return
      if (Date.now() - lastCheckedAt < 5000) return
      const version = (cachedTrainingContext() as { version?: string }).version
      if (!version) return
      busy = true
      window.clearTimeout(timer)
      lastCheckedAt = Date.now()
      try {
        const result = await withRequestDeadline(
          async (signal) => {
            const response = await apiFetch("/api/section11-sync", { signal })
            if (!response.ok) throw Error()
            return (await response.json()) as {
              status: string
              version?: string
            }
          },
          20_000,
          controller.signal
        )
        if (active)
          setAvailable(
            result.status === "complete" &&
              Boolean(version) &&
              result.version === version &&
              result.version ===
                (cachedTrainingContext() as { version?: string }).version
          )
        failures = 0
        if (
          active &&
          (result.status === "running" || result.status === "queued")
        )
          timer = window.setTimeout(() => void check(), 10_000)
      } catch {
        if (active) {
          setAvailable(false)
          failures++
          timer = window.setTimeout(
            () => void check(),
            Math.min(300_000, 30_000 * 2 ** Math.min(failures, 3))
          )
        }
      } finally {
        busy = false
      }
    }
    const changed = () => {
      setAvailable(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(
        () => void check(),
        Math.max(0, 5000 - (Date.now() - lastCheckedAt))
      )
    }
    void check()
    window.addEventListener("github-sync-check", check)
    window.addEventListener("training-context-updated", changed)
    document.addEventListener("visibilitychange", check)
    return () => {
      active = false
      controller.abort()
      window.clearTimeout(timer)
      window.removeEventListener("github-sync-check", check)
      window.removeEventListener("training-context-updated", changed)
      document.removeEventListener("visibilitychange", check)
    }
  }, [])
  return available ? (
    <span
      role="img"
      aria-label="Available in GitHub"
      title="Available in GitHub"
      className="pointer-events-none fixed right-3 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-30 grid size-5 place-items-center rounded-full bg-emerald-500/10 text-emerald-600 md:bottom-3"
    >
      <Check className="size-3.5" strokeWidth={3} />
    </span>
  ) : null
}
