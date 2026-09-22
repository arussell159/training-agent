// No timer in this module: React owns visibility/throttling; this coordinator
// makes the database boundary explicit and is tested without a browser.
export function createBackgroundWorkoutSync({
  issue,
  probe,
  importWorkouts,
  flushEdits,
  onContext = () => {},
}) {
  let lease = null,
    started = false,
    paused = false,
    operation = null,
    failures = 0
  const accept = (result) => {
    if (result.sync_error) throw Error(result.sync_error)
    if (result.context) onContext(result.context)
    if (result.probe?.token) lease = result.probe
    else {
      paused = true
      lease = null
    }
    if (!lease)
      throw Error(
        result.probe_error || "Use Refresh to restart automatic imports."
      )
    return result
  }
  const single = (work) => {
    if (operation) return operation
    operation = Promise.resolve()
      .then(work)
      .finally(() => {
        operation = null
      })
    return operation
  }
  return {
    async start() {
      if (started) return
      started = true
      return single(async () => {
        try {
          const initial = await issue()
          if (initial.needs_import) accept(await importWorkouts())
          else if (initial.probe?.token) lease = initial.probe
          else
            throw Error(
              initial.error ||
                "Automatic workout detection is unavailable. Use manual Refresh."
            )
        } catch (error) {
          paused = true
          throw error
        }
      })
    },
    async check() {
      if (!started || paused || !lease) return { paused }
      return single(async () => {
        const change = await probe(lease.token)
        if (change.paused) {
          paused = true
          throw Error(
            change.error || "Use Refresh to resume automatic imports."
          )
        }
        if (change.error) throw Error(change.error)
        if (!change.changed) return { changed: false }
        try {
          const baseline = lease.baseline
          const imported = await importWorkouts()
          const result = accept(imported)
          if (baseline && result.probe?.baseline === baseline) {
            paused = true
            throw Error(
              "A new workout is in the mirror but its app import is not confirmed. Use Refresh to retry."
            )
          }
          failures = 0
          return { ...result, changed: true }
        } catch (error) {
          if (++failures >= 3) paused = true
          throw error
        }
      })
    },
    async edit(retry = false) {
      if (operation) await operation.catch(() => {})
      // Explicit local edits are real work, not an idle provider check.
      return single(async () => {
        const result = await flushEdits(retry)
        if (result.context) onContext(result.context)
        if (result.probe?.token) lease = result.probe
        return result
      })
    },
    reset() {
      started = false
      paused = false
      lease = null
      failures = 0
    },
    status() {
      return {
        started,
        paused,
        hasLease: Boolean(lease),
        busy: Boolean(operation),
      }
    },
  }
}
