import { toFunctionUrl } from "../../../app-backend/lib/api-routing.mjs"
import {
  readDeviceCache,
  writeDeviceCache,
  deviceCacheScope,
  clearDeviceCache,
} from "./device-cache.ts"
import { createSharedRequestCache } from "./shared-request-cache.ts"
import { validActivityPayload } from "./activity-payload.ts"

// Share overlapping shell reads (including StrictMode), then discard the result.
// Each caller gets its own body; closing one view leaves other readers alive.
const shellReads = createSharedRequestCache(
  async (key, signal) => {
    const [, path, cache, headers] = JSON.parse(key) as [
      number,
      string,
      RequestCache,
      [string, string][],
    ]
    const response = await fetch(toFunctionUrl(path), {
      credentials: "same-origin",
      cache,
      signal,
      headers,
    })
    return {
      body: await response.arrayBuffer(),
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }
  },
  { maxWeight: 0, maxEntries: 0 }
)

let authenticated = false
let authRevision = 0
export function setApiAuthenticated(value: boolean, newSession = false) {
  if (authenticated !== value || newSession) authRevision++
  authenticated = value
}

export async function apiFetch(
  path: string,
  options?: RequestInit
): Promise<Response> {
  if (
    !path.startsWith("/api/") ||
    path.startsWith("/api//") ||
    path.includes("\\")
  )
    throw new TypeError("App requests must use a local API route.")
  if (options?.signal?.aborted)
    throw options.signal.reason ?? new DOMException("Aborted", "AbortError")
  if (!authenticated)
    return new Response(
      JSON.stringify({ error: "Sign in to your app to continue." }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    )
  const revision = authRevision
  const activity =
    /^\/api\/activities\/[^/?]+\/(analysis|summary|route)(?:\?|$)/.test(path) &&
    (!options?.method || options.method.toUpperCase() === "GET") &&
    options?.cache !== "no-store" &&
    options?.cache !== "reload"
  const key = `activity:${deviceCacheScope()}:${path}`
  if (activity) {
    // A slow or unavailable device database must not postpone the network.
    const cached = await Promise.race([
      readDeviceCache(key),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 40)),
    ])
    if (options?.signal?.aborted)
      throw new DOMException("Aborted", "AbortError")
    if (
      cached &&
      validActivityPayload(path, cached) &&
      authenticated &&
      revision === authRevision
    )
      return new Response(JSON.stringify(cached), {
        headers: { "Content-Type": "application/json" },
      })
  }
  if (!authenticated || revision !== authRevision)
    return new Response(JSON.stringify({ error: "Your session has ended." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  const share =
    (!options?.method || options.method.toUpperCase() === "GET") &&
    /^\/api\/(config|annual-plans|training-history|training-updates|training-context)(?:\?|$)/.test(path) &&
    !options?.body &&
    !options?.mode &&
    !options?.integrity &&
    !options?.redirect &&
    !options?.keepalive &&
    !options?.referrer &&
    !options?.referrerPolicy
  const response = share
    ? await shellReads
        .get(
          JSON.stringify([
            revision,
            path,
            options?.cache || "default",
            [...new Headers(options?.headers).entries()],
          ]),
          options?.signal ?? undefined
        )
        .then(
          (value) =>
            new Response(
              [204, 205, 304].includes(value.status) ? null : value.body,
              value
            )
        )
    : await fetch(toFunctionUrl(path), {
        ...options,
        credentials: "same-origin",
      })
  if (revision !== authRevision)
    return new Response(JSON.stringify({ error: "Your session has ended." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  if (response.status === 401 && authenticated) {
    setApiAuthenticated(false)
    window.dispatchEvent(new Event("app-auth-required"))
  }
  if (revision !== authRevision)
    return new Response(JSON.stringify({ error: "Your session has ended." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    })
  if (
    response.ok &&
    path === "/api/config" &&
    options?.method?.toUpperCase() === "POST" &&
    typeof options.body === "string"
  ) {
    let connectionChanged = false
    try {
      connectionChanged = Object.hasOwn(
        JSON.parse(options.body),
        "INTERVALS_API_KEY"
      )
    } catch {
      /* Not a connection change. */
    }
    if (connectionChanged) {
      authRevision++
      try {
        localStorage.removeItem("training-agent-startup-v2")
      } catch {
        /* Browser storage is optional. */
      }
      void clearDeviceCache()
      window.dispatchEvent(new Event("training-cache-reset"))
    }
  }
  if (activity && response.ok)
    void response
      .clone()
      .json()
      .then((value) => {
        if (
          authenticated &&
          revision === authRevision &&
          validActivityPayload(path, value)
        )
          return writeDeviceCache(key, value)
      })
      .catch(() => {})
  return response
}
