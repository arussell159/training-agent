import {
  Bike,
  Dumbbell,
  FileText,
  Flame,
  Footprints,
  Waves,
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
  Bike,
  Run: Footprints,
  Sauna: Flame,
  Strength: Dumbbell,
  Note: FileText,
}
const colors = {
  Swim: "text-cyan-600",
  Bike: "text-violet-600",
  Run: "text-lime-600",
  Sauna: "text-orange-600",
  Strength: "text-amber-700",
  Note: "text-slate-500",
}

export function CalendarAddDialog({
  date,
  onClose,
  onSelect,
}: {
  date: string
  onClose: () => void
  onSelect: (type: (typeof calendarAddTypes)[number]) => void
}) {
  const options = (note: boolean) =>
    calendarAddTypes
      .filter((type) => (type.sport === "Note") === note)
      .map((type) => {
        const Icon = icons[type.label]
        return (
          <Button
            key={type.label}
            variant="outline"
            onClick={() => onSelect(type)}
          >
            <Icon className={colors[type.label]} />
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
      <DialogContent className="calendar-add-dialog">
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
        <p className="mt-3 text-primary">Add Other</p>
        <div className="calendar-add-options">{options(true)}</div>
        <p className="mt-1 text-xs text-muted-foreground">
          Sauna uses the Other activity type in Garmin.
        </p>
      </DialogContent>
    </Dialog>
  )
}
