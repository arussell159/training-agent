// This fixture uses the actual auth boundary and account-security controls.
// The runner installs API interception first; manual opens cannot call an API.
import { StrictMode, useState } from "react"
import { createRoot } from "react-dom/client"
import Framework7 from "framework7/lite"
import Framework7React, { App as Framework7App } from "framework7-react"
import { AccountSecurity, AppAuth, useAppAuth } from "../src/components/app-auth"
import { apiFetch } from "../src/lib/api-client"
import "../src/index.css"
import "../src/styles/framework7-navbar.less"
import "../src/styles/mobile-bottom-nav.css"
import "../src/styles/mobile-dashboard.css"

declare global {
  interface Window { __authFixtureIntercepted?: boolean }
}
if (!window.__authFixtureIntercepted) {
  window.fetch = async () => { throw Error("Run the isolated authentication browser check; API access is blocked in this fixture.") }
}
// eslint-disable-next-line react-hooks/rules-of-hooks
Framework7.use([Framework7React])

function Workspace() {
  const { refresh } = useAppAuth()
  const [requestResult, setRequestResult] = useState("idle")
  const [refreshResult, setRefreshResult] = useState("idle")
  const load = async () => {
    setRequestResult("pending")
    try {
      const response = await apiFetch("/api/reliability-fixture")
      const result = await response.json()
      setRequestResult(`${response.status}:${result.value || result.error}`)
    } catch (error) { setRequestResult(error instanceof Error ? error.message : "failed") }
  }
  return <main id="fixture-workspace" className="mx-auto max-w-xl space-y-6 p-6">
    <h1>Authenticated fixture workspace</h1>
    <button id="fixture-api-load" onClick={() => void load()}>Start protected request</button>
    <output id="fixture-api-result">{requestResult}</output>
    <button id="fixture-session-refresh" onClick={() => {
      setRefreshResult("pending")
      void refresh().then(() => setRefreshResult("complete"), () => setRefreshResult("failed"))
    }}>Refresh session</button>
    <output id="fixture-refresh-result">{refreshResult}</output>
    <AccountSecurity />
  </main>
}

createRoot(document.getElementById("root")!).render(<StrictMode>
  <Framework7App name="Authentication fixture" theme="ios">
    <AppAuth><Workspace /></AppAuth>
  </Framework7App>
</StrictMode>)
