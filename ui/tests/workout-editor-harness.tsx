import { useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import {
  WorkoutEditor,
  WorkoutEditorMenu,
} from "../src/components/workout-editor"
import { WorkoutProfile } from "../src/components/workout-profile"
import { Button } from "../src/components/ui/button"
import type { PlannedWorkout } from "../src/lib/training-context"
import "../src/index.css"
function Harness() {
  const [creating, setCreating] = useState(false)
  const [workout, setWorkout] = useState<PlannedWorkout | null>(null),
    [state, setState] = useState("Online")
  const reset = async (sport: string) => {
    setWorkout(null)
    const w = await (await fetch("/api/test/reset?sport=" + sport)).json()
    setWorkout(w)
    setState("Online")
  }
  useEffect(() => {
    void reset("Ride")
  }, [])
  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="mb-2 text-xl font-bold">
        Workout editor · isolated verification
      </h1>
      <p className="mb-5 text-sm">
        All provider events are in memory. No live account or calendar is
        connected.
      </p>
      {creating && (
        <WorkoutEditor
          date="2026-10-12"
          onClose={() => setCreating(false)}
          onSaved={setWorkout}
        />
      )}
      <div className="mb-8 flex flex-wrap gap-2">
        <Button onClick={() => setCreating(true)}>
          Create workout on 2026-10-12
        </Button>
        {["Ride", "Run", "Swim"].map((s) => (
          <Button key={s} variant="outline" onClick={() => void reset(s)}>
            {s} fixture
          </Button>
        ))}
        <Button
          variant="outline"
          onClick={async () =>
            setState(
              (await (await fetch("/api/test/offline")).json()).offline
                ? "Offline"
                : "Online"
            )
          }
        >
          Toggle failure
        </Button>
        <Button
          variant="outline"
          onClick={async () => {
            await fetch("/api/test/conflict")
            setState("Remote edit")
          }}
        >
          Simulate remote edit
        </Button>
        <Button
          variant="outline"
          onClick={async () =>
            setWorkout(await (await fetch("/api/test/preview")).json())
          }
        >
          Reload preview
        </Button>
        <span>{state}</span>
      </div>
      {workout && (
        <section className="rounded-xl border p-5">
          <div className="flex justify-between">
            <h2 className="font-semibold">{workout.title}</h2>
            <WorkoutEditorMenu
              key={workout.sport}
              workout={workout}
              onSaved={setWorkout}
            />
          </div>
          <p className="my-2 text-sm">
            {workout.date} · {workout.duration}
          </p>
          <pre className="text-sm whitespace-pre-wrap">{workout.details}</pre>
          <WorkoutProfile workout={workout} />
        </section>
      )}
    </div>
  )
}
createRoot(document.getElementById("root")!).render(<Harness />)
