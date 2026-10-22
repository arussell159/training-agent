const reloadParameter = "__app_reload"
export const shellRecoveryPrepareEvent = "training-prepare-shell-recovery"

/** Recovery is an explicit action. Each mounted editor must retain its own
 * account-scoped draft synchronously, or veto the reload without losing it. */
export function requestAppShellRecovery(
  target: Pick<Window, "dispatchEvent" | "location"> = window
): boolean {
  const prepare = new Event(shellRecoveryPrepareEvent, { cancelable: true })
  if (!target.dispatchEvent(prepare)) return false
  target.location.replace(appShellRecoveryUrl(target.location.href))
  return true
}

/** Explicit user recovery preserves the route and tells the worker to fetch new HTML. */
export function appShellRecoveryUrl(href: string): string {
  const url = new URL(href)
  url.searchParams.set(reloadParameter, "1")
  return url.href
}

/** Remove the one-shot marker after boot without navigating or touching user drafts. */
export function cleanAppShellRecoveryUrl(href: string): string | null {
  const url = new URL(href)
  if (!url.searchParams.has(reloadParameter)) return null
  url.searchParams.delete(reloadParameter)
  return url.pathname + url.search + url.hash
}
