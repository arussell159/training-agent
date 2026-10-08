import test from "node:test"
import assert from "node:assert/strict"
import vm from "node:vm"
import fs from "node:fs/promises"
import { createShellManifest } from "../shell-manifest-plugin.mjs"
const source = await fs.readFile(
  new URL("../public/sw.js", import.meta.url),
  "utf8"
)
const origin = "https://app.test",
  current = "training-agent-shell-v5"
const urlOf = (key) =>
  new URL(typeof key === "string" ? key : key.url, origin).href
function withURL(value, url = origin + "/") {
  Object.defineProperty(value, "url", { value: url })
  const clone = value.clone.bind(value)
  value.clone = () => withURL(clone(), url)
  return value
}
const response = (body, status = 200, type = "text/html", url = origin + "/") =>
  withURL(
    new Response(body, { status, headers: { "Content-Type": type } }),
    url
  )
const html = (version) =>
  `<html><head><meta name="training-shell-manifest" content="/assets/shell-manifest-${version}.json"></head><body>${version}</body></html>`
const manifest = (version) => ({
  format: 1,
  base: [`/assets/main-${version}.js`, `/assets/style-${version}.css`],
  routes: {
    "/": [`/assets/home-${version}.js`],
    "/calendar": [`/assets/calendar-${version}.js`],
  },
  details: { workout: [`/assets/detail-${version}.js`] },
})
function memoryCache() {
  const rows = new Map()
  return {
    rows,
    async match(key) {
      return rows.get(urlOf(key))?.clone()
    },
    async put(key, value) {
      rows.set(urlOf(key), value.clone())
    },
    async delete(key) {
      return rows.delete(urlOf(key))
    },
    async keys() {
      return [...rows.keys()].map((url) => ({ url }))
    },
  }
}
async function seed(
  cache,
  version = "one",
  { calendar = true, detail = false } = {}
) {
  const data = manifest(version),
    assets = [
      ...data.base,
      ...data.routes["/"],
      ...(calendar ? data.routes["/calendar"] : []),
      ...(detail ? data.details.workout : []),
    ]
  await cache.put("/__app_shell__", response(html(version)))
  await cache.put(
    "/__app_shell_assets__",
    response(
      JSON.stringify({
        manifestUrl: `/assets/shell-manifest-${version}.json`,
        manifest: data,
        assets,
        previousAssets: [],
      }),
      200,
      "application/json"
    )
  )
  await cache.put(
    `/assets/shell-manifest-${version}.json`,
    response(JSON.stringify(data), 200, "application/json")
  )
  for (const path of assets)
    await cache.put(
      path,
      response(
        path,
        200,
        path.endsWith(".css") ? "text/css" : "text/javascript",
        origin + path
      )
    )
}
function fixture(
  fetch,
  { cache = memoryCache(), legacy, openError = false } = {}
) {
  const handlers = {},
    background = [],
    cacheMap = new Map([[current, cache]]),
    calls = []
  if (legacy) cacheMap.set("training-agent-shell-v4", legacy)
  const caches = {
    open: async (name) => {
      if (openError) throw Error("Storage disabled")
      if (!cacheMap.has(name)) cacheMap.set(name, memoryCache())
      return cacheMap.get(name)
    },
    keys: async () => [...cacheMap.keys()],
    delete: async (name) => cacheMap.delete(name),
    match: async (key) => {
      for (const cache of cacheMap.values()) {
        const found = await cache.match(key)
        if (found) return found
      }
    },
  }
  const self = {
    location: { origin },
    registration: {},
    clients: {
      claim: async () => {},
      matchAll: async () => [{ url: origin + "/calendar" }],
    },
    skipWaiting: async () => {},
    addEventListener: (name, handler) => {
      handlers[name] = handler
    },
  }
  vm.runInNewContext(source, {
    URL,
    AbortSignal,
    Response,
    fetch: (...args) => {
      calls.push(urlOf(args[0]))
      return fetch(...args)
    },
    caches,
    self,
  })
  return {
    cache,
    calls,
    cacheMap,
    async request(path, mode = "navigate", method = "GET") {
      let reply
      handlers.fetch({
        request: { url: new URL(path, origin).href, method, mode },
        respondWith: (value) => {
          reply = value
        },
        waitUntil: (value) => {
          background.push(value)
        },
      })
      return reply
    },
    async lifecycle(name) {
      handlers[name]({
        waitUntil: (value) => {
          background.push(value)
        },
      })
      await this.flush()
    },
    async flush() {
      while (background.length) await Promise.all(background.splice(0))
    },
  }
}
const network =
  (version = "two") =>
  async (input) => {
    const url = new URL(typeof input === "string" ? input : input.url, origin)
    if (url.pathname.startsWith("/assets/shell-manifest-"))
      return response(
        JSON.stringify(manifest(version)),
        200,
        "application/json",
        url.href
      )
    if (url.pathname.startsWith("/assets/"))
      return response(
        url.pathname,
        200,
        url.pathname.endsWith(".css") ? "text/css" : "text/javascript",
        url.href
      )
    return response(html(version))
  }

test("a complete cached shell returns while network revalidation remains unresolved", async () => {
  const cache = memoryCache()
  await seed(cache)
  let finish
  const app = fixture(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
    { cache }
  )
  const result = await Promise.race([
    app.request("/calendar"),
    new Promise((_, reject) =>
      setTimeout(() => reject(Error("Waited for network")), 100)
    ),
  ])
  assert.match(await result.text(), /one/)
  assert.equal(app.calls.length, 1)
  finish(response("outage", 503))
  await app.flush()
})

test("background updates promote new HTML only after route and base assets are stored", async () => {
  const cache = memoryCache()
  await seed(cache)
  let release
  const app = fixture(
    async (input) =>
      String(typeof input === "string" ? input : input.url).includes(
        "calendar-two.js"
      )
        ? new Promise((resolve) => {
            release = () =>
              resolve(response("calendar", 200, "text/javascript"))
          })
        : network()(input),
    { cache }
  )
  assert.match(await (await app.request("/calendar")).text(), /one/)
  while (!release) await new Promise((resolve) => setImmediate(resolve))
  assert.match(await (await cache.match("/__app_shell__")).text(), /one/)
  release()
  await app.flush()
  assert.match(await (await cache.match("/__app_shell__")).text(), /two/)
  for (const path of [
    ...manifest("two").base,
    ...manifest("two").routes["/"],
    ...manifest("two").routes["/calendar"],
  ])
    assert.ok(await cache.match(path))
  assert.ok(await cache.match("/assets/main-one.js"))
  assert.ok(
    !app.calls.some((path) => path.includes("detail-two")),
    "unrequested detail chunks are not prefetched"
  )
})

test("an unavailable new asset or quota failure retains the last complete shell", async () => {
  for (const fail of ["asset", "quota", "wrong-content-type"]) {
    const cache = memoryCache()
    await seed(cache)
    const put = cache.put.bind(cache)
    cache.put = async (key, value) => {
      if (fail === "quota" && String(key).includes("two")) throw Error("Quota")
      return put(key, value)
    }
    const app = fixture(
      (input) =>
        fail === "asset" && String(input).includes("main-two.js")
          ? Promise.resolve(response("missing", 404))
          : fail === "wrong-content-type" &&
              String(input).includes("main-two.js")
            ? Promise.resolve(response("{}", 200, "application/json"))
            : network()(input),
      { cache }
    )
    await app.request("/calendar")
    await app.flush()
    assert.match(await (await cache.match("/__app_shell__")).text(), /one/)
  }
})

test("a route or workout deep link lacking saved dependencies uses current network HTML", async () => {
  const cache = memoryCache()
  await seed(cache, "one", { calendar: false })
  const app = fixture(network(), { cache })
  assert.match(
    await (await app.request("/calendar?workout=activity%3Ai123")).text(),
    /two/
  )
  await app.flush()
  assert.ok(app.calls.some((path) => path.includes("detail-two.js")))
  const snapshot = await (await cache.match("/__app_shell_assets__")).json()
  assert.ok(snapshot.assets.includes("/assets/detail-two.js"))
})

test("an HTML quota failure rolls the commit marker back to the previous complete shell", async () => {
  const cache = memoryCache()
  await seed(cache)
  const put = cache.put.bind(cache)
  cache.put = async (key, value) => {
    if (key === "/__app_shell__" && (await value.clone().text()).includes("two"))
      throw Error("HTML quota exceeded")
    return put(key, value)
  }
  const app = fixture(network(), { cache })
  await app.request("/calendar")
  await app.flush()
  assert.match(await (await cache.match("/__app_shell__")).text(), /one/)
  assert.equal((await (await cache.match("/__app_shell_assets__")).json()).manifestUrl, "/assets/shell-manifest-one.json")
})

test("a concurrent navigation never reuses HTML whose commit marker is changing", async () => {
  const cache = memoryCache()
  await seed(cache)
  const put = cache.put.bind(cache)
  let release, paused = false
  cache.put = async (key, value) => {
    await put(key, value)
    if (key === "/__app_shell_assets__" && !paused) {
      paused = true
      await new Promise(resolve => { release = resolve })
    }
  }
  const app = fixture(network(), { cache })
  assert.match(await (await app.request("/calendar")).text(), /one/)
  while (!release) await new Promise(resolve => setImmediate(resolve))
  assert.match(await (await cache.match("/__app_shell__")).text(), /one/)
  assert.match(await (await app.request("/")).text(), /two/)
  release()
  await app.flush()
  assert.match(await (await cache.match("/__app_shell__")).text(), /two/)
})

test("disabled storage and cache quota failures still return good online responses", async () => {
  const app = fixture(network(), { openError: true })
  assert.match(await (await app.request("/calendar")).text(), /two/)
  assert.match(
    await (await app.request("/assets/main-two.js", "cors")).text(),
    /main-two/
  )
  await app.flush()
})

test("offline v4 upgrades keep the previous saved shell and its assets", async () => {
  const legacy = memoryCache()
  await legacy.put("/__app_shell__", response("legacy-shell"))
  await legacy.put(
    "/assets/old.js",
    response("old-code", 200, "text/javascript")
  )
  const app = fixture(
    async () => {
      throw Error("Offline")
    },
    { legacy }
  )
  await app.lifecycle("install")
  await app.lifecycle("activate")
  assert.ok(app.cacheMap.has("training-agent-shell-v4"))
  assert.equal(await (await app.request("/calendar")).text(), "legacy-shell")
  assert.equal(
    await (await app.request("/assets/old.js", "cors")).text(),
    "old-code"
  )
  await app.flush()
})

test("private APIs, unrelated documents, cross-origin and writes never enter the worker cache", async () => {
  const app = fixture(async () => {
    throw Error("Unexpected fetch")
  })
  for (const path of [
    "/api/config",
    "/api",
    "/privacy",
    "/privacy.html",
    "/not-an-app-route",
    "https://external.test/calendar",
  ])
    assert.equal(await app.request(path), undefined)
  assert.equal(await app.request("/calendar", "navigate", "POST"), undefined)
  assert.equal(app.calls.length, 0)
})

test("eviction protects current and previous shell assets while bounding optional assets", async () => {
  const cache = memoryCache()
  await seed(cache)
  const app = fixture(network(), { cache })
  await app.request("/calendar")
  await app.flush()
  for (let index = 0; index < 140; index++)
    await cache.put(
      `/assets/optional-${index}.js`,
      response("optional", 200, "text/javascript")
    )
  await app.request("/assets/extra.js", "cors")
  await app.flush()
  assert.ok(await cache.match("/assets/main-one.js"))
  assert.ok(await cache.match("/assets/main-two.js"))
  assert.ok(
    (await cache.keys()).filter((key) =>
      new URL(key.url).pathname.startsWith("/assets/")
    ).length <= 120
  )
})

test("build manifest follows static dependencies and CSS without pulling dynamic grandchildren", () => {
  const chunk = (fileName, options = {}) => ({
    type: "chunk",
    fileName,
    imports: [],
    ...options,
  })
  const bundle = {
    "assets/main.js": chunk("assets/main.js", {
      isEntry: true,
      imports: ["assets/shared.js"],
      dynamicImports: ["assets/huge-map.js"],
      viteMetadata: { importedCss: new Set(["assets/style.css"]) },
    }),
    "assets/shared.js": chunk("assets/shared.js"),
    "assets/style.css": { type: "asset" },
    "assets/home.js": chunk("assets/home.js", {
      facadeModuleId: "/src/components/home.tsx",
      imports: ["assets/shared.js"],
    }),
    "assets/huge-map.js": chunk("assets/huge-map.js"),
  }
  const result = createShellManifest(bundle, { "/": "home" }, {})
  assert.deepEqual(result.base, [
    "/assets/main.js",
    "/assets/shared.js",
    "/assets/style.css",
  ])
  assert.deepEqual(result.routes["/"], ["/assets/home.js"])
  assert.ok(!JSON.stringify(result).includes("huge-map"))
  assert.throws(
    () => createShellManifest(bundle, { "/": "missing" }, {}),
    /route entry is missing/
  )
})
