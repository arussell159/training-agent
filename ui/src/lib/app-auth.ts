import {
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser"
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
  passkeys?: { id: string; name: string; created: number }[]
}

export async function authRequest<T = AppSession>(
  endpoint: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(toFunctionUrl(`/api/auth/${endpoint}`), {
    method: body === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const result = await response.json()
  if (!response.ok)
    throw new Error(result.error || "Unable to sign in. Please try again.")
  return result as T
}

export const supportsPasskeys = () =>
  window.isSecureContext && browserSupportsWebAuthn()
export async function signInWithPasskey(remember: boolean) {
  const optionsJSON = await authRequest<
    Parameters<typeof startAuthentication>[0]["optionsJSON"]
  >("passkeys/authenticate/options", { remember })
  const response = await startAuthentication({ optionsJSON })
  return authRequest("passkeys/authenticate/verify", { response })
}
export async function addPasskey(name = "My passkey") {
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
