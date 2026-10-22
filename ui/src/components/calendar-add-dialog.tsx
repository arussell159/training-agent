import { useRef } from "react"
import {
  Activity,
  Bike,
  Dumbbell,
  FileText,
  Flame,
  Footprints,
  Goal,
  HeartPulse,
  PersonStanding,
  CalendarOff,
  Trophy,
  Waves,
  Sparkles,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { calendarAddTypes } from "@/lib/calendar-events"

const icons = {
  Swim: Waves,
  Brick: Activity,
  Custom: Activity,
  "Day off": CalendarOff,
  Bike,
  Run: Footprints,
  Crosstrain: Activity,
  "Mtn Bike": Bike,
  "XC-Ski": PersonStanding,
  Rowing: Waves,
  Walk: Footprints,
  Other: Activity,
  Sauna: Flame,
  Strength: Dumbbell,
  Note: FileText,
}
const colors = {
  Swim: "text-cyan-600",
  Brick: "text-purple-600",
  Custom: "text-purple-600",
  "Day off": "text-slate-500",
  Bike: "text-violet-600",
  Run: "text-lime-600",
  Crosstrain: "text-purple-600",
  "Mtn Bike": "text-violet-600",
  "XC-Ski": "text-purple-600",
  Rowing: "text-purple-600",
  Walk: "text-lime-600",
  Other: "text-purple-600",
  Sauna: "text-orange-600",
  Strength: "text-amber-700",
  Note: "text-slate-500",
}

export function CalendarAddDialog({
  date,
  onClose,
  onSelect,
  onMetrics,
  onEvent,
  onGoals,
  onAvailability,
  onGenerator,
}: {
  date: string
  onClose: () => void
  onSelect: (type: (typeof calendarAddTypes)[number]) => void
  onMetrics: () => void
  onEvent: () => void
  onGoals: () => void
  onAvailability: () => void
  onGenerator: () => void
}) {
  const selecting = useRef(false)
  const options = (note: boolean) =>
    calendarAddTypes
      .filter((type) => (type.sport === "Note") === note)
      .map((type) => {
        const Icon = icons[type.label]
        return (
          <Button
            key={type.label}
            variant="outline"
            onClick={() => {
              selecting.current = true
              onSelect(type)
            }}
          >
            <Icon aria-hidden="true" className={colors[type.label]} />
            {type.label}
          </Button>
        )
      })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="calendar-add-dialog"
        finalFocus={() => !selecting.current}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 text-[28px] leading-tight font-normal">
            {new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
              timeZone: "UTC",
            })}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose a workout or note for this day.
          </DialogDescription>
        </DialogHeader>
        <p className="mt-1 text-primary">Add a Workout</p>
        <div className="calendar-add-options">{options(false)}</div>
        <Button
          variant="outline"
          onClick={() => {
            selecting.current = true
            onGenerator()
          }}
        >
          <Sparkles aria-hidden="true" className="text-primary" />
          Workout Generator
        </Button>
        <p className="mt-3 text-primary">Add Other</p>
        <div className="calendar-add-options">
          <Button
            variant="outline"
            onClick={() => {
              selecting.current = true
              onEvent()
            }}
          >
            <Trophy aria-hidden="true" className="text-purple-600" />
            Event
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              selecting.current = true
              onGoals()
            }}
          >
            <Goal aria-hidden="true" className="text-purple-600" />
            Goals
          </Button>
          {options(true)}
          <Button
            variant="outline"
            onClick={() => {
              selecting.current = true
              onMetrics()
            }}
          >
            <HeartPulse aria-hidden="true" className="text-purple-600" />
            Metrics
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              selecting.current = true
              onAvailability()
            }}
          >
            <CalendarOff aria-hidden="true" className="text-purple-600" />
            Availability
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
