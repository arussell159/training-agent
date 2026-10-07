function waitForRead(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Bounded, account-scoped read cache. Writes invalidate before and after completion. */
export function createRequestCache({ ttl = 60000, maxEntries = 100, now = Date.now } = {}) {
  const entries = new Map();
  const invalidate = (account) => {
    const prefix = `${account}\0`;
    for (const key of entries.keys()) if (key.startsWith(prefix)) entries.delete(key);
  };
  return {
    clear() {
      entries.clear();
    },
    wrap(request, account) {
      return async (path, options = {}) => {
        if ((options.method || "GET").toUpperCase() !== "GET") {
          invalidate(account);
          try {
            return await request(path, options);
          } finally {
            invalidate(account);
          }
        }
        if (options.signal?.aborted) throw options.signal.reason;
        // Header/query/body overrides may change the representation. Only the
        // ordinary provider GET can safely share a path-based cache entry.
        if (Object.keys(options).some((key) => !["method", "signal"].includes(key)))
          return structuredClone(await request(path, options));
        const key = account + "\0" + path,
          cached = entries.get(key);
        if (cached && (cached.expiresAt === null || now() < cached.expiresAt))
          return structuredClone(await waitForRead(cached.promise, options.signal));
        const entry = { expiresAt: null, promise: null };
        // A caller's cancellation only cancels its wait. The bounded provider
        // request continues for other subscribers and retains its own timeout.
        const { signal, ...sharedOptions } = options;
        entry.promise = Promise.resolve()
          .then(() => request(path, sharedOptions))
          .then((value) => {
            entry.expiresAt = now() + ttl;
            return value;
          })
          .catch((error) => {
            if (entries.get(key) === entry) entries.delete(key);
            throw error;
          });
        entries.delete(key);
        if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
        entries.set(key, entry);
        return structuredClone(await waitForRead(entry.promise, signal));
      };
    },
  };
}
