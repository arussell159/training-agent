/** Bounded, abort-aware request sharing. One view closing does not cancel another view's request. */
export function createSharedRequestCache<T>(
  fetchValue: (key: string, signal: AbortSignal) => Promise<T>,
  {
    maxWeight = 100000,
    weight = () => 1,
    timeoutMs = 20000,
    maxEntries = 8,
    ttlMs = Infinity,
  }: {
    maxWeight?: number
    weight?: (value: T) => number
    timeoutMs?: number
    maxEntries?: number
    ttlMs?: number
  } = {}
) {
  const values = new Map<string, { value: T; weight: number; expires: number }>()
  const requests = new Map<
    string,
    { controller: AbortController; promise: Promise<T>; users: number }
  >()
  const controllers = new Set<AbortController>()
  const entryLimit = Number.isFinite(maxEntries)
    ? Math.max(0, Math.floor(maxEntries))
    : 8
  let generation = 0
  let totalWeight = 0
  const peek = (key: string) => {
    const entry = values.get(key)
    if (entry && entry.expires <= Date.now()) {
      values.delete(key)
      totalWeight -= entry.weight
      return undefined
    }
    if (entry) {
      values.delete(key)
      values.set(key, entry)
    }
    return entry?.value
  }
  return {
    peek,
    clear() {
      generation++
      values.clear()
      totalWeight = 0
      for (const controller of controllers) controller.abort()
      controllers.clear()
      requests.clear()
    },
    invalidate() {
      // Active views may finish reading their snapshot. Future readers must
      // fetch again, and older responses must not repopulate the cache.
      generation++
      values.clear()
      totalWeight = 0
      requests.clear()
    },
    get(key: string, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted)
        return Promise.reject(new DOMException("Aborted", "AbortError"))
      const cached = peek(key)
      if (values.has(key)) return Promise.resolve(cached as T)
      let request = requests.get(key)
      if (!request || request.controller.signal.aborted) {
        const controller = new AbortController()
        controllers.add(controller)
        const version = generation
        const timer = setTimeout(
          () =>
            controller.abort(
              new Error("The recording took too long to load. Please retry.")
            ),
          timeoutMs
        )
        const entry = {
          controller,
          users: 0,
          promise: Promise.resolve(null as T),
        }
        entry.promise = Promise.race([
          Promise.resolve().then(() => fetchValue(key, controller.signal)),
          new Promise<never>((_, reject) =>
            controller.signal.addEventListener(
              "abort",
              () => reject(controller.signal.reason),
              { once: true }
            )
          ),
        ])
          .then((value) => {
            if (!controller.signal.aborted && generation === version) {
              let cost = Infinity
              try {
                cost = Math.max(1, weight(value))
              } catch {
                /* Cache sizing is optional. */
              }
              if (Number.isFinite(cost) && cost <= maxWeight) {
                totalWeight -= values.get(key)?.weight ?? 0
                values.set(key, { value, weight: cost, expires: Date.now() + ttlMs })
                totalWeight += cost
                while (totalWeight > maxWeight || values.size > entryLimit) {
                  const first = values.keys().next().value!
                  totalWeight -= values.get(first)!.weight
                  values.delete(first)
                }
              }
            }
            return value
          })
          .finally(() => {
            clearTimeout(timer)
            controllers.delete(controller)
            if (requests.get(key) === entry) requests.delete(key)
          })
        requests.set(key, entry)
        request = entry
      }
      const shared = request
      shared.users++
      return new Promise<T>((resolve, reject) => {
        let done = false
        const release = () => {
          if (done) return false
          done = true
          signal?.removeEventListener("abort", abort)
          if (--shared.users === 0 && requests.get(key) === shared)
            shared.controller.abort()
          return true
        }
        const abort = () => {
          if (release()) reject(new DOMException("Aborted", "AbortError"))
        }
        signal?.addEventListener("abort", abort, { once: true })
        shared.promise.then(
          (value) => {
            if (release()) resolve(value)
          },
          (error) => {
            if (release()) reject(error)
          }
        )
      })
    },
  }
}
