import { useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { WorkoutLapChart } from "@/components/workout-lap-chart"
import { WorkoutLapsTable } from "@/components/workout-laps-table"
import { intervalSignals, type RecordedLap } from "@/lib/interval-signals"
import type { RecordedPoint } from "@/lib/segment-statistics"

export function WorkoutLapsPage({
  points,
  laps,
  sport,
  selected,
  onSelect,
  onClose,
}: {
  points: RecordedPoint[]
  laps: RecordedLap[]
  sport: string
  selected: RecordedLap | null
  onSelect: (lap: RecordedLap) => void
  onClose: () => void
}) {
  const page = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = window.history.state
    const overflow = document.body.style.overflow
    const focused = document.activeElement as HTMLElement | null
    const appRoot = document.getElementById("root")
    const wasInert = appRoot?.inert ?? false
    window.history.pushState({ ...previous, workoutLaps: true }, "")
    document.body.style.overflow = "hidden"
    if (appRoot) appRoot.inert = true
    page.current
      ?.querySelector<HTMLButtonElement>("button")
      ?.focus({ preventScroll: true })
    const back = (event: PopStateEvent) => {
      event.stopImmediatePropagation()
      onClose()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") window.history.back()
    }
    window.addEventListener("popstate", back, true)
    window.addEventListener("keydown", escape)
    return () => {
      window.removeEventListener("popstate", back, true)
      window.removeEventListener("keydown", escape)
      document.body.style.overflow = overflow
      if (appRoot) appRoot.inert = wasInert
      if (window.history.state?.workoutLaps)
        window.history.replaceState(previous, "")
      focused?.focus({ preventScroll: true })
    }
  }, [onClose])
  return createPortal(
    <div
      ref={page}
      className="fixed inset-0 z-[100] overflow-x-hidden overflow-y-auto bg-background"
      aria-label="Workout laps page"
    >
      <MobileSiteNavbar
        title={/swim/i.test(sport) ? "Swim intervals" : "Laps"}
        onBack={() => window.history.back()}
        backLabel="Back to workout"
        showMenu={false}
      />
      <main className="mx-auto max-w-2xl px-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        <p className="-mx-4 mb-5 bg-muted/60 px-4 py-5 text-center text-sm">
          Scroll through the workout to explore lap details.
        </p>
        <WorkoutLapChart
          points={points}
          laps={laps}
          sport={sport}
          selected={selected}
          onSelect={onSelect}
          expanded
        />
        <h2 className="-mx-4 mt-4 mb-2 bg-muted/60 px-4 py-3 text-xs font-semibold uppercase">
          Laps
        </h2>
        <WorkoutLapsTable
          intervals={intervalSignals(points, laps)}
          sport={sport}
          selected={selected}
          onSelect={onSelect}
        />
      </main>
    </div>,
    document.body
  )
}
