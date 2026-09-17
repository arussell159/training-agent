import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react"
import { Fingerprint, LoaderCircle, LockKeyhole, LogOut } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  addPasskey,
  authError,
  authRequest,
  signInWithPasskey,
  supportsPasskeys,
  type AppSession,
} from "@/lib/app-auth"
import { clearDeviceCache } from "@/lib/device-cache"
import { setApiAuthenticated } from "@/lib/api-client"

type AuthContextValue = {
  session: AppSession
  refresh: () => Promise<void>
  logout: () => Promise<void>
  update: (value: AppSession) => void
}
const AuthContext = createContext<AuthContextValue | null>(null)
const inputClass =
  "h-12 w-full rounded-xl border bg-background px-3 text-base outline-none focus:ring-2 focus:ring-ring"
export function useAppAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("App authentication is unavailable.")
  return value
}
async function clearPrivateCache() {
  window.dispatchEvent(new Event("training-cache-reset"))
  try {
    localStorage.removeItem("training-agent-startup-v2")
    sessionStorage.removeItem("training-agent-open-workout-v1")
  } catch {
    /* A browser storage restriction must not prevent server logout. */
  }
  await clearDeviceCache()
}

export function AppAuth({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AppSession | null>(null)
  const [password, setPassword] = useState("")
  const [remember, setRemember] = useState(true)
  const [passwordMode, setPasswordMode] = useState(false)
  const [offerPasskey, setOfferPasskey] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const revision = useRef(0)
  const update = useCallback((value: AppSession) => {
    revision.current++
    setApiAuthenticated(value.authenticated)
    setSession(value)
  }, [])
  const refresh = useCallback(async () => {
    const current = revision.current
    const next = await authRequest("session")
    if (current !== revision.current) return
    update(next)
    if (!next.authenticated) {
      setOfferPasskey(false)
      await clearPrivateCache()
    }
    setError("")
  }, [update])
  useEffect(() => {
    let active = true
    const check = () => {
      if (document.visibilityState !== "hidden")
        void refresh().catch((problem) => {
          if (active) {
            setApiAuthenticated(false)
            setSession(null)
            setError(authError(problem))
          }
        })
    }
    const expired = () => {
      revision.current++
      setApiAuthenticated(false)
      setSession((current) =>
        current ? { ...current, authenticated: false } : null
      )
      setOfferPasskey(false)
      void clearPrivateCache()
    }
    const storage = (event: StorageEvent) => {
      if (event.key === "training-app-signed-out") expired()
    }
    check()
    window.addEventListener("app-auth-required", expired)
    window.addEventListener("focus", check)
    window.addEventListener("pageshow", check)
    window.addEventListener("storage", storage)
    document.addEventListener("visibilitychange", check)
    const timer = window.setInterval(check, 60000)
    return () => {
      active = false
      window.clearInterval(timer)
      window.removeEventListener("app-auth-required", expired)
      window.removeEventListener("focus", check)
      window.removeEventListener("pageshow", check)
      window.removeEventListener("storage", storage)
      document.removeEventListener("visibilitychange", check)
    }
  }, [refresh])
  async function logout() {
    await authRequest("logout", {})
    update({ ...session!, authenticated: false })
    setOfferPasskey(false)
    try {
      localStorage.setItem("training-app-signed-out", String(Date.now()))
    } catch {
      /* Other tabs also check their server session. */
    }
    await clearPrivateCache()
  }
  async function passwordLogin(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError("")
    revision.current++
    try {
      const next = await authRequest("password", { password, remember })
      setPassword("")
      update(next)
      setOfferPasskey(
        !next.hasPasskey && next.passkeysSupported && supportsPasskeys()
      )
      setPasswordMode(false)
    } catch (problem) {
      setError(authError(problem))
    } finally {
      setBusy(false)
    }
  }
  async function passkeyAction(register: boolean) {
    setBusy(true)
    setError("")
    revision.current++
    try {
      const next = register
        ? await addPasskey()
        : await signInWithPasskey(remember)
      update(next)
      setOfferPasskey(false)
    } catch (problem) {
      setError(authError(problem))
    } finally {
      setBusy(false)
    }
  }
  if (session?.authenticated && !offerPasskey)
    return (
      <AuthContext.Provider value={{ session, refresh, logout, update }}>
        {children}
      </AuthContext.Provider>
    )

  const preferPasskey =
    session?.hasPasskey &&
    session.passkeysSupported &&
    supportsPasskeys() &&
    !passwordMode
  return (
    <main className="flex min-h-svh items-center justify-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-sm">
        <p className="mb-8 text-xs font-semibold tracking-[0.22em] text-muted-foreground uppercase">
          AR Performance
        </p>
        <div className="mb-6 flex size-12 items-center justify-center rounded-2xl border bg-muted/30">
          {offerPasskey || preferPasskey ? (
            <Fingerprint className="size-6" />
          ) : (
            <LockKeyhole className="size-5" />
          )}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">
          {offerPasskey ? "Make next time easier" : "Your training starts here"}
        </h1>
        <p className="mt-3 mb-7 text-sm leading-6 text-muted-foreground">
          {offerPasskey
            ? "Create a passkey to sign in with your fingerprint, face, or device PIN."
            : "Sign in once to access your training, calendar, and coach."}
        </p>
        {error && (
          <p
            role="alert"
            className="mb-5 rounded-xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {!session ? (
          error ? (
            <Button
              onClick={() =>
                void refresh().catch((problem) => setError(authError(problem)))
              }
            >
              Try again
            </Button>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              Checking your session…
            </p>
          )
        ) : !session.configured ? (
          <p className="text-sm text-muted-foreground">
            Set APP_PASSWORD to at least 20 characters in the server environment
            to enable sign-in.
          </p>
        ) : offerPasskey ? (
          <div className="space-y-3">
            <Button
              className="h-12 w-full"
              disabled={busy}
              onClick={() => void passkeyAction(true)}
            >
              {busy ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Fingerprint />
              )}{" "}
              Create a passkey
            </Button>
            <Button
              className="w-full"
              variant="ghost"
              disabled={busy}
              onClick={() => setOfferPasskey(false)}
            >
              Maybe later
            </Button>
          </div>
        ) : (
          <form onSubmit={passwordLogin} className="space-y-5">
            <input
              type="text"
              name="username"
              autoComplete="username"
              value="athlete"
              readOnly
              hidden
            />
            {!preferPasskey && (
              <div className="space-y-2">
                <label htmlFor="app-password" className="text-sm font-medium">
                  Password
                </label>
                <input
                  id="app-password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  maxLength={1000}
                  className={inputClass}
                />
              </div>
            )}
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
                className="size-4 accent-primary"
              />{" "}
              Remember me for 90 days
            </label>
            {preferPasskey ? (
              <Button
                key="passkey"
                type="button"
                className="h-12 w-full"
                disabled={busy}
                onClick={() => void passkeyAction(false)}
              >
                {busy ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <Fingerprint />
                )}{" "}
                Sign in with a passkey
              </Button>
            ) : (
              <Button
                key="password"
                type="submit"
                className="h-12 w-full"
                disabled={busy || !password}
              >
                {busy && <LoaderCircle className="animate-spin" />} Sign in
              </Button>
            )}
            {session.hasPasskey &&
              session.passkeysSupported &&
              supportsPasskeys() && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full"
                  disabled={busy}
                  onClick={() => {
                    setPasswordMode(!passwordMode)
                    setError("")
                  }}
                >
                  {preferPasskey
                    ? "Use password instead"
                    : "Use a passkey instead"}
                </Button>
              )}
          </form>
        )}
      </div>
    </main>
  )
}

export function AccountSecurity() {
  const { session, refresh, logout, update } = useAppAuth()
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState("")
  const [checkedAt, setCheckedAt] = useState(Date.now)
  useEffect(() => {
    const timeout = window.setTimeout(
      () => setCheckedAt(Date.now()),
      Math.max(0, (session.verifiedAt || 0) + 600000 - Date.now())
    )
    return () => window.clearTimeout(timeout)
  }, [session.verifiedAt])
  const needsPassword =
    !session.recentlyVerified ||
    checkedAt - (session.verifiedAt || 0) >= 600000
  async function act(
    action: () => Promise<unknown>,
    message: string,
    verify = true
  ) {
    setBusy(true)
    setFeedback("")
    try {
      if (verify && needsPassword) {
        const next = await authRequest("password", {
          password,
          remember: session.remember,
        })
        update(next)
        setPassword("")
      }
      await action()
      if (verify) await refresh()
      setFeedback(message)
    } catch (problem) {
      setFeedback(authError(problem))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        One sign-in covers the whole app.{" "}
        {session.remember
          ? "This device is remembered for up to 90 days."
          : "This session ends when you close your browser or after 24 hours."}
      </p>
      {session.passkeysSupported && supportsPasskeys() ? (
        <>
          {needsPassword && (
            <div className="space-y-2">
              <label htmlFor="verify-password" className="text-sm font-medium">
                Confirm your password to change passkeys
              </label>
              <input
                id="verify-password"
                name="password"
                autoComplete="current-password"
                type="password"
                className={inputClass}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <label htmlFor="passkey-name" className="text-sm font-medium">
              Passkey name
            </label>
            <input
              id="passkey-name"
              className={inputClass}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. My phone"
              maxLength={60}
            />
          </div>
          <Button
            disabled={busy || (needsPassword && !password)}
            onClick={() =>
              void act(
                () => addPasskey(name),
                "Passkey saved. It will be preferred next time you sign in."
              )
            }
          >
            <Fingerprint /> Add a passkey
          </Button>
          {session.passkeys?.map((key) => (
            <div
              className="flex items-center justify-between gap-3 border-t pt-3"
              key={key.id}
            >
              <span className="text-sm">{key.name}</span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || (needsPassword && !password)}
                onClick={() =>
                  void act(
                    () => authRequest("passkeys/remove", { id: key.id }),
                    "Passkey removed."
                  )
                }
              >
                Remove
              </Button>
            </div>
          ))}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {location.hostname === "127.0.0.1" ? (
            <>
              Use{" "}
              <a className="underline" href="http://localhost:4173/settings">
                localhost
              </a>{" "}
              for local passkey testing. Register a separate passkey on the live
              app when it is deployed.
            </>
          ) : (
            "Use a browser and device that support passkeys to add one."
          )}
        </p>
      )}
      {feedback && (
        <p role="status" className="text-sm text-muted-foreground">
          {feedback}
        </p>
      )}
      <div className="border-t pt-4">
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void act(logout, "", false)}
        >
          <LogOut /> Sign out of this device
        </Button>
      </div>
    </div>
  )
}
