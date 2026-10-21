import { useCallback, useEffect, useRef, useState } from "react"
import { apiSessionRevision } from "../lib/api-client"
import { deviceCacheScope } from "../lib/device-cache"

type OpenAccount = {
  session: number | null
  device: string
  deviceSealed: boolean
  revoked: boolean
}

function matchesOpenAccount(account: OpenAccount) {
  if (
    account.revoked ||
    account.session === null ||
    account.session !== apiSessionRevision()
  )
    return false
  const device = deviceCacheScope()
  // "initial" is the empty-cache bootstrap sentinel, not a provider identity.
  // Seal the first loaded scope within this exact authenticated session. Once
  // sealed, even a transition back to an empty cache revokes the selection.
  if (!account.deviceSealed) {
    account.device = device
    account.deviceSealed = device !== "initial"
  }
  return account.device === device
}

export type WorkoutAccountBoundary = {
  trusted: boolean
  /** Check again immediately before dispatch and after awaiting a response. */
  isCurrent: () => boolean
  /** Background saves may finish after normal navigation for this same owner. */
  ownsAccount: () => boolean
}

/** Keep this mounted outside Summary/Notes/Analyze for the entire selection. */
export function useWorkoutAccountBoundary(
  active: boolean
): WorkoutAccountBoundary {
  const open = useRef<OpenAccount | null>(null)
  const mounted = useRef(true)
  const [, refresh] = useState(0)

  if (!active) open.current = null
  else if (!open.current) {
    const session = apiSessionRevision()
    const device = deviceCacheScope()
    open.current = {
      session,
      device,
      deviceSealed: device !== "initial",
      // An already-open unauthenticated selection cannot adopt a later login.
      revoked: session === null,
    }
  }

  const selection = open.current
  const ownsAccount = useCallback(() => {
    if (!selection || open.current !== selection) return false
    if (!matchesOpenAccount(selection)) selection.revoked = true
    return !selection.revoked
  }, [selection])
  const isCurrent = useCallback(
    () => mounted.current && ownsAccount(),
    [ownsAccount]
  )

  useEffect(() => {
    mounted.current = true
    const changed = (event?: Event) => {
      const key =
        event?.type === "storage" ? (event as StorageEvent).key : undefined
      if (
        event?.type === "storage" &&
        key !== null &&
        key !== "training-agent-startup-v2" &&
        key !== "training-app-signed-out"
      )
        return
      const current = open.current
      if (!current) return
      if (
        event?.type === "app-auth-required" ||
        key === "training-app-signed-out" ||
        !matchesOpenAccount(current)
      )
        current.revoked = true
      refresh((value) => value + 1)
    }
    const events = [
      "training-cache-reset",
      "app-auth-required",
      "device-cache-cleared",
      "training-context-updated",
      "storage",
    ]
    if (typeof window !== "undefined")
      for (const event of events) window.addEventListener(event, changed)
    // Close the render-to-subscription gap without adopting another account.
    changed()
    return () => {
      mounted.current = false
      if (typeof window !== "undefined")
        for (const event of events) window.removeEventListener(event, changed)
    }
  }, [])

  return { trusted: isCurrent(), isCurrent, ownsAccount }
}
