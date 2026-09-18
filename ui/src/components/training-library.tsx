import {
  List,
  ListItem,
  Subnavbar,
  Segmented,
  Button as F7Button,
} from "framework7-react"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"
import { apiFetch } from "@/lib/api-client"
import { useIsMobile } from "@/hooks/use-mobile"
import { useEffect, useMemo, useState } from "react"
import { Search, ChevronRight } from "lucide-react"

import { WorkoutCard } from "@/components/training-calendar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { type PlannedWorkout } from "@/lib/training-context"

const disciplines = ["All", "Swim", "Bike", "Run"] as const

export function TrainingLibrary({
  onWorkoutOpen,
}: {
  onWorkoutOpen?: (workout: PlannedWorkout) => void
}) {
  const mobile = useIsMobile()
  const [workouts, setWorkouts] = useState<PlannedWorkout[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [discipline, setDiscipline] =
    useState<(typeof disciplines)[number]>("All")
  const [query, setQuery] = useState("")

  useEffect(() => {
    const controller = new AbortController()
    const load = async () => {
      try {
        const response = await apiFetch("/api/workout-library", {
          signal: controller.signal,
        })
        const value = await response.json()
        if (!response.ok)
          throw new Error(value.error || "Unable to load saved workouts.")
        setWorkouts(value.workouts || [])
        setError("")
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Unable to load saved workouts."
          )
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    window.addEventListener("training-context-updated", load)
    return () => {
      controller.abort()
      window.removeEventListener("training-context-updated", load)
    }
  }, [])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return workouts.filter((workout) => {
      const matchesDiscipline =
        discipline === "All" ||
        workout.sport.toLowerCase().includes(discipline.toLowerCase())
      const matchesQuery =
        !needle ||
        `${workout.title} ${workout.goal} ${workout.sport}`
          .toLowerCase()
          .includes(needle)
      return matchesDiscipline && matchesQuery
    })
  }, [discipline, query, workouts])

  if (mobile)
    return (
      <div className="coach-report-page flex min-h-0 flex-1 flex-col">
        <MobileSiteNavbar title="Library" className="coach-report-navbar">
          <Subnavbar className="coach-report-subnavbar">
            <Segmented strong round className="w-full">
              {disciplines.map((item) => (
                <F7Button
                  key={item}
                  active={discipline === item}
                  onClick={(event) => {
                    event.preventDefault()
                    setDiscipline(item)
                  }}
                >
                  {item}
                </F7Button>
              ))}
            </Segmented>
          </Subnavbar>
        </MobileSiteNavbar>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="coach-report-content">
            <div className="px-4 pt-6">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search workouts"
                aria-label="Search workouts"
              />
            </div>
            {error ? (
              <p role="alert">{error}</p>
            ) : loading ? (
              <p>Loading saved workouts…</p>
            ) : (
              <List
                mediaList
                inset
                strong
                dividers
                className="coach-report-list"
              >
                {filtered.map((workout) => (
                  <ListItem
                    key={workout.id}
                    link="#"
                    noChevron
                    title={workout.title}
                    subtitle={workout.sport + " · " + workout.duration}
                    onClick={(event) => {
                      event.preventDefault()
                      onWorkoutOpen?.(workout)
                    }}
                  >
                    <ChevronRight
                      slot="after"
                      className="coach-report-chevron"
                    />
                  </ListItem>
                ))}
              </List>
            )}
            {!loading && !error && !filtered.length && (
              <p>No saved workouts match this search.</p>
            )}
          </div>
        </div>
      </div>
    )

  return (
    <div className="flex w-full min-w-0 flex-1 flex-col gap-4 p-3 sm:p-4 md:p-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workouts"
            aria-label="Search workouts"
            className="pl-9"
          />
        </div>
        <div
          className="flex flex-wrap gap-2"
          aria-label="Filter workouts by discipline"
        >
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

      {error && <p role="alert">{error}</p>}
      {filtered.length ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((workout) => (
            <WorkoutCard
              key={workout.id}
              workout={workout}
              onClick={() => onWorkoutOpen?.(workout)}
            />
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
