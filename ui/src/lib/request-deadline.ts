/** Bound the entire request, including its response body, without retrying it. */
export async function withRequestDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  signal?: AbortSignal,
  message = "The request took too long. Please retry."
): Promise<T> {
  if (signal?.aborted)
    throw signal.reason ?? new DOMException("Aborted", "AbortError")
  const controller = new AbortController()
  const cancel = () => controller.abort(signal?.reason)
  signal?.addEventListener("abort", cancel, { once: true })
  let rejectAbort: () => void = () => {}
  const aborted = new Promise<never>((_, reject) => {
    rejectAbort = () => reject(controller.signal.reason)
    controller.signal.addEventListener("abort", rejectAbort, { once: true })
  })
  const timer = setTimeout(() => {
    controller.abort(new DOMException(message, "TimeoutError"))
  }, timeoutMs)
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        controller.signal.throwIfAborted()
        return operation(controller.signal)
      }),
      aborted,
    ])
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", cancel)
    controller.signal.removeEventListener("abort", rejectAbort)
  }
}

export function waitForRequestDelay(
  durationMs: number,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
      reject(signal.reason)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort)
      resolve()
    }, durationMs)
    signal.addEventListener("abort", abort, { once: true })
  })
}
