import { useState } from "react"
import { createRoot } from "react-dom/client"
import { DetailSheetRow } from "../src/components/detail-sheet-row"
import { useMobileViewport } from "../src/hooks/use-mobile-viewport"
import "../src/index.css"
import "../src/styles/framework7-navbar.less"
document.documentElement.classList.add("ios")
function Fixture() {
  useMobileViewport()
  const [draft, setDraft] = useState("Retained draft")
  const [saved, setSaved] = useState("")
  return <main className="p-4" style={{ minHeight: "200vh" }}>
    <h1>Disposable detail sheet fixture</h1>
    <DetailSheetRow title="Workout Details" date="Friday, October 23, 2026" fullHeight>
      <label>Sheet draft<input aria-label="Sheet draft" value={draft} onChange={event => setDraft(event.target.value)} /></label>
      <button onClick={() => setSaved(draft)}>Save fixture draft</button>
      <p role="status">{saved ? `Saved ${saved}` : "Draft not saved"}</p>
      {Array.from({length:50},(_,index)=><p key={index}>Workout note {index + 1}: Controlled scrolling should keep the sheet header visible.</p>)}
    </DetailSheetRow>
    <button>Underlying page action</button>
  </main>
}
createRoot(document.getElementById("root")!).render(<Fixture />)
