import { useEffect, useMemo, useState } from "react"
import { Search } from "lucide-react"

import { WorkoutCard } from "@/components/training-calendar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  fallbackTrainingContext,
  loadTrainingContext,
  type PlannedWorkout,
} from "@/lib/training-context"

const disciplines = ["All", "Swim", "Bike", "Run"] as const

export function TrainingLibrary({
  onWorkoutOpen,
}: {
  onWorkoutOpen?: (workout: PlannedWorkout) => void
}) {
  const [context, setContext] = useState(fallbackTrainingContext)
  const [discipline, setDiscipline] = useState<(typeof disciplines)[number]>("All")
  const [query, setQuery] = useState("")

  useEffect(() => {
    let active = true
    loadTrainingContext().then((next) => active && setContext(next))
    return () => { active = false }
  }, [])

  const workouts = useMemo(() => (context.library ?? []).map((item): PlannedWorkout => ({
    id:item.id,
    day:"",
    date:"",
    sport:item.sport,
    title:item.title,
    duration:item.duration,
    goal:item.purpose,
    details:item.purpose,
    status:"upcoming",
  })), [context.library])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return workouts.filter((workout) => {
      const matchesDiscipline = discipline === "All" || workout.sport.toLowerCase().includes(discipline.toLowerCase())
      const matchesQuery = !needle || `${workout.title} ${workout.goal} ${workout.sport}`.toLowerCase().includes(needle)
      return matchesDiscipline && matchesQuery
    })
  }, [discipline, query, workouts])

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-4 p-3 sm:p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workouts"
            aria-label="Search workouts"
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2" aria-label="Filter workouts by discipline">
          {disciplines.map((item) => (
            <Button
              key={item}
              type="button"
              size="sm"
              variant={discipline === item ? "default" : "outline"}
              className="cursor-pointer"
              aria-pressed={discipline === item}
              onClick={() => setDiscipline(item)}
            >
              {item}
            </Button>
          ))}
        </div>
      </div>

      {filtered.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((workout) => (
            <WorkoutCard key={workout.id} workout={workout} onClick={() => onWorkoutOpen?.(workout)} />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No workouts match this search.
        </div>
      )}
    </div>
  )
}
