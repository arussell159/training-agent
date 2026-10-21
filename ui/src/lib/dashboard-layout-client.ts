import { apiFetch } from "./api-client.ts"
import { withRequestDeadline } from "./request-deadline.ts"
import { deviceCacheScope } from "./device-cache.ts"
import {
  validDashboardLayout,
  type DashboardLayout,
} from "./dashboard-charts.ts"

type Request = (path: string, options?: RequestInit) => Promise<Response>
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, canonical(item)])
        )
      : value
export const sameDashboardLayout = (
  left: DashboardLayout,
  right: DashboardLayout
) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right))
export function createDashboardLayoutClient(
  namespace: string,
  request: Request = apiFetch,
  timeoutMs = 30_000,
  isCurrentConnection: () => boolean = () => true
) {
  let queue: Promise<unknown> = Promise.resolve()
  const assertConnection = () => {
    if (!isCurrentConnection())
      throw Error(
        "Connection changed. Reopen Analysis before saving dashboard changes."
      )
  }
  const decode = async (response: Response) => {
    const body = await response.json()
    if (!response.ok)
      throw Error(
        typeof body?.error === "string"
          ? body.error
          : "Dashboard preferences could not be saved."
      )
    if (
      !body ||
      typeof body !== "object" ||
      !body.training_preferences ||
      typeof body.training_preferences !== "object" ||
      Array.isArray(body.training_preferences)
    )
      throw Error("Dashboard preferences response is incomplete.")
    const value = body.training_preferences[namespace]
    if (value === undefined) return null
    if (!validDashboardLayout(value))
      throw Error(
        "The saved dashboard layout is invalid. Your local layout is retained."
      )
    return value
  }
  return {
    load: (signal?: AbortSignal) =>
      withRequestDeadline(
        async (requestSignal) => {
          assertConnection()
          const result = await decode(
            await request("/api/training-preferences", {
              signal: requestSignal,
              cache: "no-store",
            })
          )
          assertConnection()
          return result
        },
        timeoutMs,
        signal,
        "Dashboard preferences took too long to load."
      ),
    save: (layout: DashboardLayout) => {
      if (!validDashboardLayout(layout))
        return Promise.reject(Error("The dashboard layout is invalid."))
      const snapshot = JSON.parse(JSON.stringify(layout)) as DashboardLayout
      const operation = () =>
        withRequestDeadline(
          async (signal) => {
            assertConnection()
            const result = await decode(
              await request("/api/training-preferences", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  training_preferences: { [namespace]: snapshot },
                }),
                signal,
              })
            )
            assertConnection()
            if (!result || !sameDashboardLayout(result, snapshot))
              throw Error(
                "The server did not confirm this dashboard layout. Your local changes are retained."
              )
            return result
          },
          timeoutMs,
          undefined,
          "Dashboard preferences took too long to save. Your local changes are retained."
        )
      const pending = queue.then(operation, operation)
      queue = pending.catch(() => {})
      return pending
    },
  }
}
const clients = new Map<
  string,
  ReturnType<typeof createDashboardLayoutClient>
>()
let connectionGeneration = 0
if (typeof window !== "undefined")
  for (const event of [
    "app-auth-required",
    "training-cache-reset",
    "device-cache-cleared",
  ])
    window.addEventListener(event, () => {
      connectionGeneration++
      clients.clear()
    })
export function dashboardLayoutClient(
  namespace: string,
  currentScope: () => string = deviceCacheScope
) {
  let client = clients.get(namespace)
  if (!client) {
    const generation = connectionGeneration
    client = createDashboardLayoutClient(
      namespace,
      apiFetch,
      30_000,
      () =>
        generation === connectionGeneration &&
        namespace === `desktopDashboard:${currentScope()}`
    )
    clients.set(namespace, client)
  }
  return client
}
