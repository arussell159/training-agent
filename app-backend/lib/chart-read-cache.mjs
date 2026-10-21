// Bounded shared read cache. Caller cancellation never cancels other subscribers.
export function createChartReadCache({
  now = Date.now,
  maxEntries = 64,
  ttl = 30 * 60_000,
  failureTtl = 60_000,
  maxWeight = Infinity,
  weight = () => 0,
  busy,
} = {}) {
  const entries = new Map();
  let totalWeight = 0;
  const remove = (key, entry) => {
    if (entries.get(key) !== entry) return false;
    entries.delete(key);
    totalWeight -= entry.weight;
    return true;
  };
  return {
    clear: () => {
      entries.clear();
      totalWeight = 0;
    },
    stats: () => ({ entries: entries.size, totalWeight }),
    read(key, fn, lifetime = () => ttl) {
      const found = entries.get(key);
      if (found && (found.expires === null || found.expires > now())) return found.promise;
      if (found) remove(key, found);
      if (entries.size >= maxEntries) {
        const idle = [...entries].find(([, entry]) => entry.expires !== null);
        if (!idle) throw busy();
        remove(idle[0], idle[1]);
      }
      const entry = { expires: null, promise: null, weight: 0 };
      entry.promise = Promise.resolve()
        .then(fn)
        .then(
          (value) => {
            entry.expires = now() + lifetime(value);
            if (entries.get(key) !== entry) return value;
            let valueWeight;
            try {
              valueWeight = weight(value);
              if (!Number.isSafeInteger(valueWeight) || valueWeight < 0)
                throw Error("Invalid chart cache weight.");
            } catch (error) {
              remove(key, entry);
              throw error;
            }
            if (valueWeight > maxWeight) {
              remove(key, entry);
              return value;
            }
            while (totalWeight + valueWeight > maxWeight) {
              const idle = [...entries].find(([, item]) => item !== entry && item.expires !== null);
              if (!idle) {
                remove(key, entry);
                return value;
              }
              remove(idle[0], idle[1]);
            }
            entry.weight = valueWeight;
            totalWeight += valueWeight;
            return value;
          },
          (error) => {
            entry.expires = now() + failureTtl;
            throw error;
          }
        );
      entries.set(key, entry);
      return entry.promise;
    },
  };
}
export function chartReadSubscriber(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
