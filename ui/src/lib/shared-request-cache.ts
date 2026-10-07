/** Bounded, abort-aware request sharing. One view closing does not cancel another view's request. */
export function createSharedRequestCache<T>(
  fetchValue: (key: string, signal: AbortSignal) => Promise<T>,
  {
    maxWeight = 100000,
    weight = () => 1,
    timeoutMs = 20000,
    maxEntries = 8,
  }: {
    maxWeight?: number
    weight?: (value: T) => number
    timeoutMs?: number
    maxEntries?: number
  } = {}
) {
  const values = new Map<string, { value: T; weight: number }>()
  const requests = new Map<
    string,
    { controller: AbortController; promise: Promise<T>; users: number }
  >()
  const entryLimit = Number.isFinite(maxEntries)
    ? Math.max(0, Math.floor(maxEntries))
    : 8
  let generation = 0
  let totalWeight = 0
  const peek = (key: string) => {
    const entry = values.get(key)
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
      for (const request of requests.values()) request.controller.abort()
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
                values.set(key, { value, weight: cost })
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
