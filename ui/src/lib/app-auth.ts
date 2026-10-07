import { toFunctionUrl } from "../../../app-backend/lib/api-routing.mjs"

export type AppSession = {
  configured: boolean
  authenticated: boolean
  hasPasskey: boolean
  passkeysSupported: boolean
  expiresAt?: number
  verifiedAt?: number
  recentlyVerified?: boolean
  remember?: boolean
  passkeys?: { id: string; name: string; created?: number | null }[]
}

let pendingSession: Promise<unknown> | null = null
function takeStartupSession() {
  if (typeof window === 'undefined') return undefined
  const target = window as Window & { __trainingSessionRequest?: Promise<Response | null> }
  const pending = target.__trainingSessionRequest
  delete target.__trainingSessionRequest
  return pending
}
const REQUEST_TIMEOUT_MS = 20_000

function validSession(value: unknown): value is AppSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  const session = value as Record<string, unknown>
  if (
    !["configured", "authenticated", "hasPasskey", "passkeysSupported"].every(
      (key) => typeof session[key] === "boolean"
    )
  )
    return false
  if (
    !["recentlyVerified", "remember"].every(
      (key) => session[key] === undefined || typeof session[key] === "boolean"
    )
  )
    return false
  if (
    !["expiresAt", "verifiedAt"].every(
      (key) =>
        session[key] === undefined ||
        (typeof session[key] === "number" &&
          Number.isFinite(session[key]) &&
          session[key] >= 0)
    )
  )
    return false
  return (
    session.passkeys === undefined ||
    (Array.isArray(session.passkeys) &&
      session.passkeys.every(
        (key) =>
          key &&
          typeof key === "object" &&
          typeof key.id === "string" &&
          typeof key.name === "string" &&
          (key.created == null ||
            (typeof key.created === "number" &&
              Number.isFinite(key.created) &&
              key.created >= 0))
      ))
  )
}

async function request(endpoint: string, body?: unknown): Promise<unknown> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(
        new Error("The server took too long to respond. Please try again.")
      )
    }, REQUEST_TIMEOUT_MS)
  })
  try {
    return await Promise.race([
      timeout,
      (async () => {
        const startupRequest = endpoint === 'session' && body === undefined ? takeStartupSession() : undefined
        const startup = startupRequest ? await startupRequest : null
        const response = startup || await fetch(toFunctionUrl(`/api/auth/${endpoint}`), {
          method: body === undefined ? "GET" : "POST",
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
          headers: { "Content-Type": "application/json" },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
        const result = await response.json().catch(() => {
          throw new Error(
            "The server returned an invalid response. Please try again."
          )
        })
        if (!response.ok)
          throw new Error(
            typeof result?.error === "string"
              ? result.error
              : "Unable to sign in. Please try again."
          )
        if (
          endpoint === "session" ||
          endpoint === "password" ||
          endpoint === "passkeys/authenticate/verify"
        ) {
          if (!validSession(result))
            throw new Error(
              "The server returned an invalid session. Please try again."
            )
        }
        return result
      })(),
    ])
  } finally {
    clearTimeout(timer)
  }
}

export function authRequest<T = AppSession>(
  endpoint: string,
  body?: unknown
): Promise<T> {
  if (endpoint !== "session" || body !== undefined) {
    takeStartupSession()
    // A session read started before a sign-in or logout cannot represent it.
    pendingSession = null
    return request(endpoint, body) as Promise<T>
  }
  if (!pendingSession) {
    const next = request(endpoint)
    pendingSession = next
    const clear = () => {
      if (pendingSession === next) pendingSession = null
    }
    void next.then(clear, clear)
  }
  return pendingSession as Promise<T>
}

export const supportsPasskeys = () =>
  window.isSecureContext && typeof window.PublicKeyCredential === "function"
export async function signInWithPasskey(remember: boolean) {
  const { startAuthentication } = await import("@simplewebauthn/browser")
  const optionsJSON = await authRequest<
    Parameters<typeof startAuthentication>[0]["optionsJSON"]
  >("passkeys/authenticate/options", { remember })
  const response = await startAuthentication({ optionsJSON })
  return authRequest("passkeys/authenticate/verify", { response })
}
export async function addPasskey(name = "My passkey") {
  const { startRegistration } = await import("@simplewebauthn/browser")
  const optionsJSON = await authRequest<
    Parameters<typeof startRegistration>[0]["optionsJSON"]
  >("passkeys/register/options", {})
  const response = await startRegistration({ optionsJSON })
  await authRequest("passkeys/register/verify", { response, name })
  return authRequest("session")
}
export function authError(error: unknown) {
  if (
    error instanceof Error &&
    ["NotAllowedError", "AbortError"].includes(error.name)
  )
    return "Passkey setup or sign-in was cancelled. You can try again or use your password."
  return error instanceof Error
    ? error.message
    : "Unable to sign in. Please try again."
}
