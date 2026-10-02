// Session-only display snapshots. Network refreshes keep the previous layout visible.
const snapshots = new Map<string, { value: unknown; time: number }>()
let revision = 0
export function pageSnapshotRevision() {
  return revision
}
export function readPageSnapshot<T>(key: string): T | null {
  return (snapshots.get(key)?.value as T) ?? null
}
export function pageSnapshotFresh(key: string) {
  const entry = snapshots.get(key)
  return Boolean(entry && Date.now() - entry.time < 30_000)
}
export function writePageSnapshot<T>(
  key: string,
  value: T,
  expectedRevision: number
) {
  if (expectedRevision !== revision) return
  snapshots.delete(key)
  snapshots.set(key, { value, time: Date.now() })
  if (snapshots.size > 64) snapshots.delete(snapshots.keys().next().value!)
}
export function clearPageSnapshots() {
  revision++
  snapshots.clear()
}
if (typeof window !== "undefined") {
  for (const event of [
    "training-cache-reset",
    "device-cache-cleared",
    "app-auth-required",
  ])
    window.addEventListener(event, clearPageSnapshots)
  window.addEventListener("training-context-updated", () => {
    for (const entry of snapshots.values()) entry.time = 0
  })
}
