const SHELL_CACHE = "training-agent-shell-v4"
const cacheOrNull = () => caches.open(SHELL_CACHE).catch(() => null)
const save = async (cache, key, response) => {
  if (!cache) return
  try {
    await cache.put(key, response)
  } catch {
    /* Cache quota must not discard a good network response. */
  }
}
const isShell = (response) =>
  response.ok &&
  new URL(response.url).origin === self.location.origin &&
  response.headers.get("content-type")?.includes("text/html")

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await cacheOrNull()
      try {
        const response = await fetch("/", { signal: AbortSignal.timeout(8000) })
        if (isShell(response)) await save(cache, "/__app_shell__", response)
      } catch {
        /* The existing shell remains available when offline. */
      }
      if (cache)
        try {
          await cache.addAll([
            "/ar-performance-background.png",
            "/ar-performance-favicon.png",
          ])
        } catch {
          /* Optional branding is available online. */
        }
      await self.skipWaiting()
    })()
  )
})
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      try {
        for (const key of await caches.keys())
          if (key.startsWith("training-agent-shell-") && key !== SHELL_CACHE)
            await caches.delete(key)
      } catch {
        /* Restricted browser storage must not prevent activation. */
      }
      try {
        const subscription =
          await self.registration.pushManager?.getSubscription()
        if (subscription) await subscription.unsubscribe()
      } catch {
        /* Retiring push delivery must not block the shell. */
      }
      await self.clients.claim()
    })()
  )
)
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url)
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname === "/api" ||
    url.pathname.startsWith("/api/")
  )
    return
  if (event.request.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cache = await cacheOrNull()
        const cached = await cache?.match("/__app_shell__").catch(() => null)
        try {
          // Current HTML avoids references to chunks removed by a deployment.
          const response = await fetch(event.request, {
            signal: AbortSignal.timeout(8000),
          })
          if (isShell(response))
            event.waitUntil(save(cache, "/__app_shell__", response.clone()))
          if (!response.ok && cached && response.status >= 500) return cached
          return response
        } catch (error) {
          if (cached) return cached
          throw error
        }
      })()
    )
  } else if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      (async () => {
        const cache = await cacheOrNull()
        const cached = await cache?.match(event.request).catch(() => null)
        if (cached) return cached
        const response = await fetch(event.request)
        if (response.ok)
          event.waitUntil(
            (async () => {
              await save(cache, event.request, response.clone())
              if (cache)
                try {
                  const keys = (await cache.keys()).filter((key) =>
                    new URL(key.url).pathname.startsWith("/assets/")
                  )
                  for (const key of keys.slice(
                    0,
                    Math.max(0, keys.length - 120)
                  ))
                    await cache.delete(key)
                } catch {
                  /* Eviction remains best effort. */
                }
            })()
          )
        return response
      })()
    )
  }
})
