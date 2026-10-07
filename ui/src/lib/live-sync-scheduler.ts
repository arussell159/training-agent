// Push handles changes. Timers only recover missed notifications or an outage.
export const LIVE_SAFETY_MS = 15 * 60_000
export const LIVE_FALLBACK_MS = 5 * 60_000
export function createLiveSyncScheduler(options: {
  check: () => Promise<boolean>
  canCheck: () => boolean
  currentVersion: () => string | undefined
  setTimer?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimer?: (id: ReturnType<typeof setTimeout>) => void
}) {
  const later = options.setTimer || setTimeout
  const clear = options.clearTimer || clearTimeout
  let timer: ReturnType<typeof setTimeout> | undefined
  let active = true, paused = false, busy = false, connected = false, requested = 0, completed = 0, failures = 0
  const schedule = (ms: number) => {
    if (timer !== undefined) clear(timer)
    if (active && !paused) timer = later(() => { requested++; void run() }, ms)
  }
  const run = async () => {
    if (!active || paused || busy) return
    if (!options.canCheck()) { schedule(1000); return }
    busy = true
    const revision = requested
    let ready = false
    try {
      ready = await options.check()
      if (ready) completed = revision
      failures = 0
    } catch { failures++ }
    finally {
      busy = false
      if (active) {
        if (failures) schedule(Math.min(LIVE_FALLBACK_MS, 5000 * 2 ** Math.min(failures - 1, 6)))
        else if (!ready) schedule(1000)
        else if (requested > completed) void run()
        else schedule(connected ? LIVE_SAFETY_MS : LIVE_FALLBACK_MS)
      }
    }
  }
  const invalidate = (version?: string) => {
    if (!active || (version && version === options.currentVersion())) return
    requested++
    if (timer !== undefined) clear(timer)
    void run()
  }
  schedule(LIVE_FALLBACK_MS)
  return {
    invalidate,
    pause() { paused = true; if (timer !== undefined) clear(timer) },
    resume() { if (paused) { paused = false; schedule(LIVE_FALLBACK_MS) } },
    connection(value: boolean) {
      if (!active || connected === value) return
      connected = value
      if (value) invalidate()
      else schedule(LIVE_FALLBACK_MS)
    },
    stop() { active = false; if (timer !== undefined) clear(timer) },
  }
}
