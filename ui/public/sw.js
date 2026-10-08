const SHELL_CACHE = "training-agent-shell-v5"
const SHELL_KEY = "/__app_shell__"
const STATE_KEY = "/__app_shell_assets__"
const APP_ROUTES = new Set([
  "/",
  "/calendar",
  "/week",
  "/nutrition",
  "/settings",
  "/coach",
  "/library",
  "/annual-plan",
  "/atp",
  "/workout-reports",
])
const cacheOrNull = () => caches.open(SHELL_CACHE).catch(() => null)
const pathFor = (url) => url.pathname.replace(/\/+$/, "") || "/"
const match = (cache, key) => cache?.match(key).catch(() => null)
const assetPath = (value) =>
  typeof value === "string" && /^\/assets\/[A-Za-z0-9_.-]+$/.test(value)
const save = async (cache, key, response) => {
  if (!cache) return false
  try {
    await cache.put(key, response)
    return true
  } catch {
    return false
  }
}
const sameOrigin = (response) => {
  try {
    return new URL(response.url).origin === self.location.origin
  } catch {
    return false
  }
}
const isShell = (response) =>
  response.ok &&
  sameOrigin(response) &&
  response.headers.get("content-type")?.includes("text/html")
const isAsset = (response, path = "") => {
  if (!response.ok || !sameOrigin(response)) return false
  const type = response.headers.get("content-type") || ""
  if (path.endsWith(".js")) return /(?:java|ecma)script/i.test(type)
  if (path.endsWith(".css")) return type.includes("text/css")
  if (path.endsWith(".json")) return type.includes("application/json")
  return !type.includes("text/html")
}
const manifestPath = (html) => {
  const value = html.match(
    /<meta\s+name=["']training-shell-manifest["']\s+content=["']([^"']+)["']/i
  )?.[1]
  return assetPath(value) && value.endsWith(".json") ? value : null
}
function validManifest(value) {
  if (
    value?.format !== 1 ||
    !Array.isArray(value.base) ||
    !value.base.length ||
    !value.routes ||
    !value.details
  )
    return false
  const groups = [
    value.base,
    ...Object.values(value.routes),
    ...Object.values(value.details),
  ]
  return (
    groups.length <= 24 &&
    groups.every(
      (group) =>
        Array.isArray(group) && group.length <= 150 && group.every(assetPath)
    )
  )
}
function requiredAssets(manifest, url) {
  const route = pathFor(url)
  if (!Object.hasOwn(manifest.routes, route)) return null
  return [
    ...new Set([
      ...manifest.base,
      ...manifest.routes[route],
      ...Object.entries(manifest.details).flatMap(([key, assets]) =>
        url.searchParams.has(key) ? assets : []
      ),
    ]),
  ]
}
const stateFrom = async (cache) => {
  try {
    const state = await (await match(cache, STATE_KEY))?.json()
    return state &&
      assetPath(state.manifestUrl) &&
      validManifest(state.manifest) &&
      Array.isArray(state.assets) &&
      state.assets.every(assetPath) &&
      Array.isArray(state.previousAssets) &&
      state.previousAssets.every(assetPath)
      ? state
      : null
  } catch {
    return null
  }
}
const assetRequests = new Map()
async function fetchAsset(cache, path) {
  const existing = await match(cache, path)
  if (existing) return existing
  let pending = assetRequests.get(path)
  if (!pending) {
    pending = fetch(path, { signal: AbortSignal.timeout(8000) }).then(
      async (response) => {
        if (isAsset(response, path)) await save(cache, path, response.clone())
        return response
      }
    )
    assetRequests.set(path, pending)
    void pending.then(
      () => assetRequests.delete(path),
      () => assetRequests.delete(path)
    )
  }
  return (await pending).clone()
}
async function trimAssets(cache, state) {
  if (!cache) return
  try {
    const pinned = new Set([
      state.manifestUrl,
      ...state.assets,
      ...state.previousAssets,
    ])
    const assets = (await cache.keys()).filter((key) =>
      assetPath(new URL(key.url).pathname)
    )
    const candidates = assets.filter(
      (key) => !pinned.has(new URL(key.url).pathname)
    )
    for (const key of candidates.slice(
      0,
      Math.max(0, assets.length - Math.max(120, pinned.size))
    ))
      await cache.delete(key)
  } catch {
    /* Storage maintenance never blocks navigation. */
  }
}
let staging = Promise.resolve()
let revalidation = null
let bypassCachedShell = false
async function stageShell(cache, response, urls) {
  if (!cache || !isShell(response)) return
  const html = await response.clone().text(),
    manifestUrl = manifestPath(html)
  if (!manifestUrl) return
  const manifestResponse = await fetchAsset(cache, manifestUrl)
  if (!isAsset(manifestResponse, manifestUrl)) return
  const manifest = await manifestResponse.json()
  if (!validManifest(manifest)) return
  const previous = await stateFrom(cache)
  const requested = [new URL("/", self.location.origin), ...urls]
  const assets = [
    ...new Set([
      ...requested.flatMap((url) => requiredAssets(manifest, url) || []),
      ...(previous?.manifestUrl === manifestUrl ? previous.assets : []),
    ]),
  ]
  for (let offset = 0; offset < assets.length; offset += 6) {
    const responses = await Promise.all(
      assets.slice(offset, offset + 6).map((path) => fetchAsset(cache, path))
    )
    if (
      responses.some(
        (result, index) => !isAsset(result, assets[offset + index])
      )
    )
      return
  }
  // Quota failure must leave the last complete HTML+asset set untouched.
  if (
    !(await Promise.all(assets.map((path) => match(cache, path)))).every(
      Boolean
    )
  )
    return
  const state = {
    manifestUrl,
    manifest,
    assets,
    previousAssets:
      previous?.manifestUrl === manifestUrl
        ? previous.previousAssets
        : previous?.assets || [],
  }
  if (
    !(await save(
      cache,
      STATE_KEY,
      new Response(JSON.stringify(state), {
        headers: { "Content-Type": "application/json" },
      })
    ))
  )
    return
  if (await save(cache, SHELL_KEY, response)) {
    bypassCachedShell = false
    await trimAssets(cache, state)
  } else if (previous) {
    // State is just a commit marker. Restore it if the HTML put failed.
    await save(
      cache,
      STATE_KEY,
      new Response(JSON.stringify(previous), {
        headers: { "Content-Type": "application/json" },
      })
    )
  }
}
function queueStage(cache, response, urls) {
  const task = staging.then(() => stageShell(cache, response, urls))
  staging = task.catch(() => {})
  return staging
}
function revalidate(cache, url) {
  if (!revalidation) {
    const task = fetch("/", {
      cache: "no-cache",
      signal: AbortSignal.timeout(8000),
    })
      .then((response) => queueStage(cache, response, [url]))
      .catch(() => {})
    revalidation = task
    void task.then(() => {
      if (revalidation === task) revalidation = null
    })
  }
  return revalidation
}
async function readyShell(cache, url) {
  const [cached, state] = await Promise.all([
    match(cache, SHELL_KEY),
    stateFrom(cache),
  ])
  if (
    !cached ||
    !state ||
    manifestPath(await cached.clone().text()) !== state.manifestUrl
  )
    return null
  const assets = requiredAssets(state.manifest, url)
  if (!assets || assets.some((asset) => !state.assets.includes(asset)))
    return null
  return (await Promise.all(assets.map((path) => match(cache, path)))).every(
    Boolean
  )
    ? cached
    : null
}
async function legacyShell() {
  try {
    const names = (await caches.keys())
      .filter(
        (key) => key.startsWith("training-agent-shell-") && key !== SHELL_CACHE
      )
      .sort()
      .reverse()
    for (const name of names) {
      const cached = await match(await caches.open(name), SHELL_KEY)
      if (cached) return cached
    }
  } catch {
    /* Restricted storage can disable offline fallback. */
  }
  return null
}
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const clients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        })
        const urls = clients
          .map((client) => new URL(client.url))
          .filter(
            (url) =>
              url.origin === self.location.origin &&
              APP_ROUTES.has(pathFor(url))
          )
        const response = await fetch("/", {
          cache: "no-cache",
          signal: AbortSignal.timeout(8000),
        })
        await queueStage(await cacheOrNull(), response, urls)
      } catch {
        /* Keep the previous worker's saved shell when offline. */
      }
      await self.skipWaiting()
    })()
  )
})
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      // Do not delete v4 during the upgrade: an offline install or an open old tab
      // can still need its HTML and hashed assets. Both caches remain bounded.
      try {
        const subscription =
          await self.registration.pushManager?.getSubscription()
        if (subscription) await subscription.unsubscribe()
      } catch {
        /* Optional retirement. */
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
    if (!APP_ROUTES.has(pathFor(url))) return
    const cache = cacheOrNull()
    const served = cache.then(async (value) => {
      const cached = !bypassCachedShell && (await readyShell(value, url))
      if (cached) return { response: cached, cached: true, cache: value }
      try {
        const response = await fetch(event.request, {
          signal: AbortSignal.timeout(8000),
        })
        if (response.status >= 500) {
          const fallback =
            (await readyShell(value, url)) || (await legacyShell())
          if (fallback)
            return { response: fallback, cached: true, cache: value }
        }
        return { response, cached: false, cache: value }
      } catch (error) {
        const fallback = (await readyShell(value, url)) || (await legacyShell())
        if (fallback) return { response: fallback, cached: true, cache: value }
        throw error
      }
    })
    event.respondWith(served.then(({ response }) => response))
    // Register immediately; response delivery never waits for background fetch.
    event.waitUntil(
      served
        .then(({ response, cached, cache: value }) =>
          cached
            ? revalidate(value, url)
            : queueStage(value, response.clone(), [url])
        )
        .catch(() => {})
    )
  } else if (assetPath(url.pathname)) {
    const result = cacheOrNull().then(async (cache) => {
      const cached = await match(cache, event.request)
      if (cached) return cached
      // Existing open tabs may still refer to the previous worker's deployment.
      try {
        const older = await caches.match(event.request)
        if (older) return older
      } catch {
        /* Cache is optional. */
      }
      const response = await fetchAsset(cache, url.pathname)
      if (!response.ok || !isAsset(response, url.pathname))
        bypassCachedShell = true
      return response
    })
    event.respondWith(result)
    event.waitUntil(
      result
        .then(async () => {
          const cache = await cacheOrNull(),
            state = await stateFrom(cache)
          if (state) await trimAssets(cache, state)
        })
        .catch(() => {})
    )
  }
})
