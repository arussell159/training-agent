import { useRef } from "react"
import {
  FileText,
  SquareCheck,
  HeartPulse,
  CalendarOff,
  Trophy,
  Upload,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { DesktopSportIcon } from "@/components/desktop-sport-icon"
import { calendarAddTypes } from "@/lib/calendar-events"

export function CalendarAddDialog({
  date,
  onClose,
  onSelect,
  onMetrics,
  onEvent,
  onGoals,
  onAvailability,
  onGenerator,
  onUpload,
}: {
  date: string
  onClose: () => void
  onSelect: (type: (typeof calendarAddTypes)[number]) => void
  onMetrics: () => void
  onEvent: () => void
  onGoals: () => void
  onAvailability: () => void
  onGenerator: () => void
  onUpload: () => void
}) {
  const selecting = useRef(false)
  const options = (note: boolean) =>
    calendarAddTypes
      .filter(
        (type) => (type.sport === "Note") === note && type.label !== "Sauna"
      )
      .map((type) => {
        return (
          <Button
            key={type.label}
            variant="outline"
            onClick={() => {
              selecting.current = true
              onSelect(type)
            }}
          >
            {note ? (
              <FileText aria-hidden="true" className="text-slate-500" />
            ) : (
              <DesktopSportIcon sport={type.label} />
            )}
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
        overlayClassName="calendar-add-overlay"
        finalFocus={() => !selecting.current}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 text-[28px] leading-tight font-semibold">
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
        <section className="calendar-add-section">
          <p className="calendar-add-section-heading">Add a Workout</p>
          <div className="calendar-add-options">
            {options(false)}
            <Button
              className="calendar-add-generator"
              onClick={() => {
                selecting.current = true
                onGenerator()
              }}
            >
              Workout Generator
            </Button>
          </div>
        </section>
        <section className="calendar-add-section">
          <p className="calendar-add-section-heading">Add Other</p>
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
              <SquareCheck aria-hidden="true" className="text-purple-600" />
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
        </section>
        <section className="calendar-add-section">
          <p className="calendar-add-section-heading">Upload Device Files</p>
          <div className="calendar-add-options">
            <Button
              variant="outline"
              onClick={() => {
                selecting.current = true
                onUpload()
              }}
            >
              <Upload aria-hidden="true" />
              Upload File
            </Button>
          </div>
        </section>
        <a
          className="calendar-add-sync-help"
          href="https://intervals.icu/settings"
          target="_blank"
          rel="noopener noreferrer"
        >
          Learn about the many ways to AutoSync your activity data.
        </a>
      </DialogContent>
    </Dialog>
  )
}
