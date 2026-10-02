import { useState } from "react"
import { createRoot } from "react-dom/client"
import { PageSkeleton } from "../src/components/loading-layouts"
import { useFirstReveal } from "../src/hooks/use-first-reveal"
import "../src/index.css"
import "../src/styles/mobile-dashboard.css"
import "../src/components/nutrition.css"

function RevealProbe() {
  const [ready, setReady] = useState(false)
  const reveal = useFirstReveal("preview", ready)
  return (
    <section className={reveal} data-testid="reveal-probe">
      <button onClick={() => setReady(true)}>Finish loading</button>
      <p>{ready ? "Ready" : "Waiting"}</p>
    </section>
  )
}
function Preview() {
  const [page, setPage] = useState("Home")
  const [probe, setProbe] = useState(false)
  return (
    <>
      <nav className="flex flex-wrap gap-2 border-b bg-background p-2">
        <label>
          Layout{" "}
          <select
            aria-label="Layout"
            value={page}
            onChange={(e) => setPage(e.target.value)}
          >
            {[
              "Home",
              "Nutrition",
              "Calendar",
              "Coach",
              "Library",
              "Annual Plan",
              "Workout Reports",
              "Workout",
              "Report",
            ].map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </label>
        <button onClick={() => setProbe(!probe)}>Toggle reveal test</button>
      </nav>
      {probe ? (
        <RevealProbe />
      ) : (
        <div className="home-dashboard-shell">
          <PageSkeleton page={page} />
        </div>
      )}
    </>
  )
}
createRoot(document.getElementById("root")!).render(<Preview />)
