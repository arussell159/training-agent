/** Bounded, abort-aware request sharing. One view closing does not cancel another view's request. */
export function createSharedRequestCache<T>(
  fetchValue: (key: string, signal: AbortSignal) => Promise<T>,
  {
    maxWeight = 100000,
    weight = () => 1,
    timeoutMs = 20000,
  }: {
    maxWeight?: number
    weight?: (value: T) => number
    timeoutMs?: number
  } = {}
) {
  const values = new Map<string, { value: T; weight: number }>()
  const requests = new Map<
    string,
    { controller: AbortController; promise: Promise<T>; users: number }
  >()
  let generation = 0
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
      for (const request of requests.values()) request.controller.abort()
      requests.clear()
    },
    get(key: string, signal?: AbortSignal): Promise<T> {
      if (signal?.aborted)
        return Promise.reject(new DOMException("Aborted", "AbortError"))
      const cached = peek(key)
      if (cached !== undefined) return Promise.resolve(cached)
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
              const cost = Math.max(1, weight(value))
              if (cost <= maxWeight) {
                values.set(key, { value, weight: cost })
                let total = [...values.values()].reduce(
                  (sum, item) => sum + item.weight,
                  0
                )
                while (total > maxWeight || values.size > 8) {
                  const first = values.keys().next().value!
                  total -= values.get(first)!.weight
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
