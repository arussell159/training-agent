import { useCallback, useEffect, useMemo, useState } from "react"
import { Ellipsis, Trophy, Trash2 } from "lucide-react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"
import { Card, CardContent } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { calendarRaceEvents, dateLabel } from "@/lib/annual-plan"
import type { AnnualPlan, PlanEvent } from "@/lib/annual-plan"
import { apiFetch } from "@/lib/api-client"
import type { PlannedWorkout, TrainingContext } from "@/lib/training-context"

export function isRaceWorkout(workout: PlannedWorkout) {
  const race = workout as PlannedWorkout & { category?: string; raw?: { category?: string } }
  return /^RACE(?:_[ABC])?$/.test(String(race.category || race.raw?.category || ""))
}

export function RaceMarkerIcon({ priority = "A" }: { priority?: string | null }) {
  return (
    <span className="relative inline-flex size-5 shrink-0 items-center justify-center" aria-hidden="true">
      <Trophy className="size-5 fill-teal-700 text-teal-700 dark:fill-teal-400 dark:text-teal-400" />
      <span className="absolute top-[3px] text-[7px] font-black leading-none text-white dark:text-slate-950">
        {priority || "A"}
      </span>
    </span>
  )
}

function DateFlag({ date }: { date: string }) {
  const parsed = new Date(`${date}T12:00:00Z`)
  return (
    <div className="relative flex h-14 w-12 shrink-0 flex-col items-center bg-blue-700 pt-1 text-white after:absolute after:inset-x-0 after:bottom-[-10px] after:border-x-[24px] after:border-b-0 after:border-t-[10px] after:border-x-transparent after:border-t-blue-700">
      <span className="text-[11px] uppercase leading-4">
        {parsed.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })}
      </span>
      <span className="text-xl leading-5">{parsed.getUTCDate()}</span>
    </div>
  )
}

function eventCountdown(date: string, target = "event") {
  const countdown = countdownDetails(date)
  if (countdown.days === 0) return "Event day"
  if (countdown.days < 0) return `${Math.abs(countdown.days)} days ago`
  return `${countdown.value} ${countdown.unit.toLowerCase()}${countdown.value === 1 ? "" : "s"} until ${target}`
}

function countdownDetails(date: string) {
  const today = new Date()
  today.setHours(12, 0, 0, 0)
  const event = new Date(`${date}T12:00:00`)
  const days = Math.ceil((event.getTime() - today.getTime()) / 86_400_000)
  const twoMonthsBefore = new Date(event)
  twoMonthsBefore.setMonth(twoMonthsBefore.getMonth() - 2)
  const showDays = today >= twoMonthsBefore
  return { days, value:showDays ? Math.max(0,days) : Math.max(0,Math.floor(days / 7)), unit:showDays ? "DAY" : "WEEK" }
}

function racePriority(workout: PlannedWorkout) {
  const race = workout as PlannedWorkout & { category?: string; raw?: { category?: string; priority?: string; race_priority?: string } }
  return race.raw?.priority || race.raw?.race_priority || String(race.category || race.raw?.category || "").split("_")[1] || "A"
}

export function RaceCalendarCard({
  workout,
  disabled,
  onOpen,
  onDelete,
}: {
  workout: PlannedWorkout
  disabled?: boolean
  onOpen: () => void
  onDelete: () => void
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const date = workout.workout_date || ""
  const countdown = countdownDetails(date)
  return (
    <>
      <Card
        role="button"
        tabIndex={0}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onOpen()
          }
        }}
        className="group/race w-full cursor-pointer gap-0 overflow-hidden rounded-md border-blue-200 px-0 py-0 shadow-sm dark:border-blue-900"
      >
        <div className="flex min-h-16 items-start justify-between gap-2 pr-1.5">
          <div className="ml-2 shrink-0"><DateFlag date={date} /></div>
          <div className="pt-1.5" onClick={(event) => event.stopPropagation()}>
            <MobileActionMenu
              label={`Options for ${workout.title}`}
              actions={[{ value: "delete", label: "Delete race", disabled, onSelect: () => setDeleteOpen(true) }]}
            ><DropdownMenu>
              <DropdownMenuTrigger
                render={<Button variant="ghost" size="icon-sm" className="size-6" aria-label={`Options for ${workout.title}`} />}
              >
                <Ellipsis className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" disabled={disabled} onClick={() => setDeleteOpen(true)}>
                  <Trash2 /> Delete race
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu></MobileActionMenu>
          </div>
        </div>
        <div className="space-y-1 px-2.5 pb-2.5 pt-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug">{workout.title}</p>
          <p className="text-[10px] text-muted-foreground">{dateLabel(date, { weekday:"short", month:"short", day:"numeric", year:"numeric" })}</p>
          <div className="mt-2 flex items-center justify-between gap-2 border-t pt-2 text-[10px]">
            <span className="font-semibold text-blue-700 dark:text-blue-400">{countdown.value} {countdown.unit.toLowerCase()}{countdown.value===1?'':'s'} left</span>
            <span className="text-muted-foreground">Race {racePriority(workout)}</span>
          </div>
        </div>
      </Card>
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent onClick={(event) => event.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete race?</AlertDialogTitle>
            <AlertDialogDescription>Delete “{workout.title}” from your race calendar and annual training plan?</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={onDelete}>Delete race</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

export function EventsCard({ context }: { context: TrainingContext }) {
  const [planEvents, setPlanEvents] = useState<PlanEvent[]>([])
  const loadPlanEvents = useCallback(async () => {
    const response = await apiFetch("/api/annual-plans")
    if (!response.ok) return
    const result = await response.json() as { plans?: AnnualPlan[]; activeId?: string | null }
    const active = result.plans?.find((plan) => plan.id === result.activeId) || result.plans?.[0]
    setPlanEvents(active?.events || [])
  }, [])

  useEffect(() => {
    void loadPlanEvents()
    window.addEventListener("annual-plan-updated", loadPlanEvents)
    return () => window.removeEventListener("annual-plan-updated", loadPlanEvents)
  }, [loadPlanEvents])

  const today = new Date().toISOString().slice(0, 10)
  const events = useMemo(() => {
    const merged = new Map<string, Partial<PlanEvent> & { name: string; date: string }>()
    for (const event of [...calendarRaceEvents(context), ...planEvents]) {
      merged.set(event.date, event)
    }
    return [...merged.values()]
      .filter((event) => event.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [context, planEvents, today])
  const nextA = events.find((event) => String(event.priority || "").toUpperCase() === "A")
  const countdown = nextA ? countdownDetails(nextA.date) : null

  return (
    <Card className="col-span-2 min-w-0 gap-0 overflow-hidden bg-card py-0 [--card-spacing:--spacing(3)] sm:[--card-spacing:--spacing(4)] lg:col-span-2">
      <CardContent className="space-y-3 px-0">
        {nextA ? (
          <>
            <div className="flex items-start gap-3 pr-3 sm:pr-4">
              <div className="ml-3 shrink-0 sm:ml-4">
                <DateFlag date={nextA.date} />
              </div>
              <div className="min-w-0 flex-1 pt-3">
                <p className="min-w-0 text-base font-black uppercase leading-tight">{nextA.name}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{dateLabel(nextA.date, { weekday: "short", month: "long", day: "numeric", year: "numeric" })}</p>
              </div>
              {countdown&&<div className="shrink-0 pt-2 text-center sm:hidden" aria-label={`${countdown.value} ${countdown.unit.toLowerCase()}${countdown.value===1?'':'s'} left`}>
                <div className="flex justify-center gap-0.5">
                  {String(countdown.value).padStart(2,"0").split("").map((digit,index)=><span key={`${digit}-${index}`} className="relative flex h-10 w-7 items-center justify-center overflow-hidden rounded-[4px] border border-zinc-700 bg-zinc-900 text-3xl font-black leading-none text-white after:absolute after:inset-x-0 after:top-1/2 after:border-t after:border-black/70">{digit}</span>)}
                </div>
                <p className="mt-1 text-[8px] font-black uppercase leading-none">{countdown.unit}{countdown.value===1?'':'S'} LEFT</p>
              </div>}
            </div>
            {countdown&&<div className="hidden px-3 text-center sm:block sm:px-4" aria-label={`${countdown.value} ${countdown.unit.toLowerCase()}${countdown.value===1?'':'s'} left`}>
              <div className="flex justify-center gap-1">
                {String(countdown.value).padStart(2,"0").split("").map((digit,index)=><span key={`${digit}-${index}`} className="relative flex h-16 w-11 items-center justify-center overflow-hidden rounded-md border border-zinc-700 bg-zinc-900 text-5xl font-black leading-none text-white shadow-sm after:absolute after:inset-x-0 after:top-1/2 after:border-t after:border-black/70">{digit}</span>)}
              </div>
              <p className="mt-1 text-lg font-black uppercase tracking-tight">{countdown.unit}{countdown.value===1?'':'S'} LEFT</p>
            </div>}
            <div className="mx-3 mb-3 space-y-1.5 border-t border-border pt-2.5 text-xs sm:mx-4 sm:mb-4">
              {events.slice(0, 3).map((event) => (
                <div key={`${event.id}-${event.date}`} className="grid grid-cols-[3.5rem_1.25rem_minmax(0,1fr)] items-center gap-2 font-normal normal-case">
                  <span>{dateLabel(event.date, { month: "short", day: "2-digit" })}</span>
                  <span className="text-center">{event.priority || "—"}</span>
                  <span className="truncate">{event.name}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="px-3 pt-3 text-sm text-muted-foreground sm:px-4 sm:pt-4">No upcoming A race.</p>
            {events.length > 0 && <div className="mx-3 mb-3 space-y-1.5 border-t border-border pt-2.5 text-xs sm:mx-4 sm:mb-4">{events.slice(0, 3).map((event) => (
              <div key={`${event.id}-${event.date}`} className="grid grid-cols-[3.5rem_1.25rem_minmax(0,1fr)] items-center gap-2 font-normal normal-case">
                <span>{dateLabel(event.date, { month: "short", day: "2-digit" })}</span>
                <span className="text-center">{event.priority || "—"}</span>
                <span className="truncate">{event.name}</span>
              </div>
            ))}</div>}
          </>
        )}
      </CardContent>
    </Card>
  )
}

export { DateFlag, eventCountdown, racePriority }
