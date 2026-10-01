import { lazy, Suspense, useState } from "react"
import { Play, X } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { mapboxConfig } from "@/lib/mapbox-config"
import type { PlannedWorkout } from "@/lib/training-context"
import type { ReplayPoint } from "@/lib/route-replay"
import { LiquidGlassLayer } from "@/components/ui/liquid-glass-layer"
import { PageErrorBoundary } from "@/components/page-error-boundary"
import "@/components/route-replay-button.css"

const loadReplay = () =>
  import("@/components/route-replay").then((module) => ({
    default: module.RouteReplay,
  }))
const RouteReplay = lazy(loadReplay)

export function RouteReplayButton({
  workout,
  points,
  timed,
  bottom = 20,
}: {
  workout: PlannedWorkout
  points: ReplayPoint[]
  timed: boolean
  bottom?: number
}) {
  const [open, setOpen] = useState(false)
  if (!mapboxConfig || points.length < 2) return null
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        style={{ bottom }}
        aria-label="Replay route"
        title="Replay route"
        onPointerEnter={() => {
          void loadReplay().catch(() => {})
        }}
        onFocus={() => {
          void loadReplay().catch(() => {})
        }}
        onTouchStart={() => {
          void loadReplay().catch(() => {})
        }}
        className="route-replay-trigger mobile-glass-action liquid-glass-button"
      >
        <LiquidGlassLayer />
        <Play aria-hidden="true" className="fill-current" />
      </DialogTrigger>
      <DialogContent
        fullscreen
        showCloseButton={false}
        className="!z-[200] !block overflow-hidden !bg-white !p-0 !text-slate-900"
      >
        <DialogTitle className="sr-only">
          Route replay: {workout.title}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Explore your activity with a moving map. Play, pause, change speed, or
          scrub through the route.
        </DialogDescription>
        {open && (
          <PageErrorBoundary
            resetKey={workout.id}
            onClose={() => setOpen(false)}
          >
            <Suspense
              fallback={
                <>
                  <DialogClose
                    aria-label="Close route replay"
                    className="absolute top-[max(1rem,env(safe-area-inset-top))] left-4 z-30 grid !size-11 place-items-center rounded-full bg-white !p-0 text-slate-900 shadow-md"
                  >
                    <X className="size-5" />
                  </DialogClose>
                  <div
                    role="status"
                    className="grid h-full place-items-center text-sm text-slate-600"
                  >
                    Preparing your replay…
                  </div>
                </>
              }
            >
              <RouteReplay
                key={workout.id}
                workout={workout}
                points={points}
                timed={timed}
              />
            </Suspense>
          </PageErrorBoundary>
        )}
      </DialogContent>
    </Dialog>
  )
}
