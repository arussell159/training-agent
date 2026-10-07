const DB_NAME = "training-agent-device-v1"
const CACHE_TIMEOUT = 1000
let lastStartup: string | null | undefined
let lastScope = "initial"
export function deviceCacheScope() {
  try {
    const startup = localStorage.getItem("training-agent-startup-v2")
    if (startup !== lastStartup) {
      lastStartup = startup
      const scope = JSON.parse(startup || "null")?.cache_scope
      lastScope = typeof scope === "string" && scope ? scope : "initial"
    }
    return lastScope
  } catch {
    lastStartup = undefined
    return "initial"
  }
}

let database: Promise<IDBDatabase | null> | undefined
let retryAt = 0
let generation = 0
function openDatabase(): Promise<IDBDatabase | null> {
  if (database) return database
  if (Date.now() < retryAt) return Promise.resolve(null)
  const attempt = new Promise<IDBDatabase | null>((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null)
    let finished = false
    const finish = (db: IDBDatabase | null) => {
      if (finished) {
        db?.close()
        return
      }
      finished = true
      clearTimeout(timer)
      resolve(db)
    }
    const timer = setTimeout(() => finish(null), CACHE_TIMEOUT)
    try {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains("records"))
          request.result.createObjectStore("records")
      }
      request.onsuccess = () => {
        const db = request.result
        db.onversionchange = () => {
          db.close()
          if (database === attempt) database = undefined
        }
        finish(db)
      }
      request.onerror = request.onblocked = () => finish(null)
    } catch {
      finish(null)
    }
  })
  database = attempt
  void attempt.then((db) => {
    if (!db && database === attempt) {
      database = undefined
      // Retry transient/private-mode failures without reopening on every read.
      retryAt = Date.now() + 30_000
    }
  })
  return attempt
}

export async function readDeviceCache<T>(
  key: string,
  maxAgeMs = Infinity
): Promise<T | null> {
  const version = generation
  try {
    const db = await openDatabase()
    if (!db || version !== generation) return null
    return await new Promise<T | null>((resolve) => {
      let finished = false
      const finish = (value: T | null) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        resolve(version === generation ? value : null)
      }
      const timer = setTimeout(() => finish(null), CACHE_TIMEOUT)
      try {
        const transaction = db.transaction("records")
        const request = transaction.objectStore("records").get(key)
        request.onsuccess = () => {
          if (finished) return
          if (version !== generation) {
            finish(null)
            return
          }
          const row = request.result
          const age = Date.now() - row?.savedAt
          if (
            !row ||
            !Number.isFinite(row.savedAt) ||
            age < -60_000 ||
            age >= maxAgeMs
          ) {
            finish(null)
            if (row)
              try {
                db.transaction("records", "readwrite")
                  .objectStore("records")
                  .delete(key)
              } catch {
                /* Expiry cleanup is optional. */
              }
          } else finish(row.value ?? null)
        }
        request.onerror = transaction.onabort = () => finish(null)
      } catch {
        finish(null)
      }
    })
  } catch {
    return null
  }
}

async function writeTransaction(
  db: IDBDatabase,
  action: (store: IDBObjectStore) => void
) {
  await new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, CACHE_TIMEOUT)
    try {
      const transaction = db.transaction("records", "readwrite")
      transaction.oncomplete =
        transaction.onerror =
        transaction.onabort =
          finish
      action(transaction.objectStore("records"))
    } catch {
      finish()
    }
  })
}

export async function writeDeviceCache(key: string, value: unknown) {
  const version = generation
  try {
    const db = await openDatabase()
    if (!db || version !== generation) return
    await writeTransaction(db, (store) => {
      store.put({ value, savedAt: Date.now() }, key)
      // Bound chart snapshots without expiring the useful startup history.
      const kind = key.startsWith("activity:")
        ? "activity:"
        : key.startsWith("nutrition:")
          ? "nutrition:"
          : key.startsWith("history-range:")
            ? "history-range:"
            : key.startsWith("history-report:")
              ? "history-report:"
              : key.startsWith("history-workout:")
                ? "history-workout:"
                : null
      if (!kind) return
      const request = store.openCursor()
      const charts: { key: IDBValidKey; savedAt: number }[] = []
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          if (String(cursor.key).startsWith(kind)) {
            const savedAt = cursor.value?.savedAt
            if (
              !Number.isFinite(savedAt) ||
              (kind === "nutrition:" && Date.now() - savedAt >= 15 * 60_000)
            )
              cursor.delete()
            else charts.push({ key: cursor.key, savedAt })
          }
          cursor.continue()
        } else {
          charts
            .sort((a, b) => b.savedAt - a.savedAt)
            .slice(kind === "activity:" || kind === "history-workout:" ? 40 : kind === "history-range:" ? 36 : kind === "history-report:" ? 24 : 14)
            .forEach((row) => store.delete(row.key))
        }
      }
    })
  } catch {
    /* Device cache failure never blocks the app or a durable save. */
  }
}

export async function clearDeviceCache() {
  generation++
  if (typeof window !== "undefined")
    window.dispatchEvent(new Event("device-cache-cleared"))
  try {
    const db = await openDatabase()
    if (db)
      await writeTransaction(db, (store) => {
        store.clear()
      })
  } catch {
    /* Best effort. */
  }
}

export async function deleteDeviceCachePrefix(prefix: string) {
  generation++
  try {
    const db = await openDatabase()
    if (!db) return
    await writeTransaction(db, (store) => {
      const request = store.openCursor()
      request.onsuccess = () => {
        const cursor = request.result
        if (cursor) {
          if (String(cursor.key).startsWith(prefix)) cursor.delete()
          cursor.continue()
        }
      }
    })
  } catch {
    /* Cache invalidation is best effort. */
  }
}
