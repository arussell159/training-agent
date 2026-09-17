import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import { useIsMobile } from "@/hooks/use-mobile"
import {
  durationClock,
  parseDurationInput,
} from "../../../app-backend/lib/workout-editor-inputs.mjs"

const ROW_HEIGHT = 44

function TimeWheel({
  label,
  value,
  count,
  onChange,
}: {
  label: string
  value: number
  count: number
  onChange: (value: number) => void
}) {
  const scroll = useRef<HTMLDivElement>(null)
  const selected = useRef(-1)
  const id = useId()
  useLayoutEffect(() => {
    if (scroll.current && selected.current !== value) {
      scroll.current.scrollTop = value * ROW_HEIGHT
      selected.current = value
    }
  }, [value])
  const choose = (next: number) =>
    scroll.current?.scrollTo({
      top: Math.max(0, Math.min(count - 1, next)) * ROW_HEIGHT,
      behavior: "smooth",
    })
  return (
    <div className="we-time-wheel-column">
      <span>{label}</span>
      <div
        ref={scroll}
        className="we-time-wheel"
        role="listbox"
        aria-label={label}
        tabIndex={0}
        aria-activedescendant={`${id}-${value}`}
        onScroll={(event) => {
          const next = Math.max(
            0,
            Math.min(
              count - 1,
              Math.round(event.currentTarget.scrollTop / ROW_HEIGHT)
            )
          )
          if (next !== selected.current) {
            selected.current = next
            onChange(next)
          }
        }}
        onKeyDown={(event) => {
          const next =
            event.key === "ArrowDown"
              ? value + 1
              : event.key === "ArrowUp"
                ? value - 1
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? count - 1
                    : null
          if (next != null) {
            event.preventDefault()
            choose(next)
          }
        }}
      >
        {Array.from({ length: count }, (_, n) => (
          <button
            type="button"
            role="option"
            aria-selected={value === n}
            id={`${id}-${n}`}
            key={n}
            tabIndex={-1}
            onClick={() => choose(n)}
          >
            {String(n).padStart(2, "0")}
          </button>
        ))}
      </div>
    </div>
  )
}

export function DurationField({
  label = "Duration",
  value,
  onChange,
}: {
  label?: string
  value: number
  onChange: (value: number) => void
}) {
  const mobile = useIsMobile()
  const [text, setText] = useState(durationClock(value))
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(durationClock(value))
  }, [value])
  const commitText = () => {
    focused.current = false
    const parsed = parseDurationInput(text)
    if (parsed !== null) onChange(parsed)
    setText(durationClock(parsed ?? value))
  }
  const hours = Math.floor(draft / 3600),
    minutes = Math.floor(draft / 60) % 60,
    seconds = draft % 60
  return (
    <div className="we-field">
      <span>{label}</span>
      {mobile ? (
        <button
          type="button"
          className="we-duration-button"
          aria-label={label}
          aria-haspopup="dialog"
          onClick={() => {
            setDraft(Math.round(value))
            setOpen(true)
          }}
        >
          {durationClock(value)}
        </button>
      ) : (
        <Input
          aria-label={label}
          placeholder="hh:mm:ss"
          value={text}
          inputMode="numeric"
          onFocus={(event) => {
            focused.current = true
            event.target.select()
          }}
          onChange={(event) => {
            setText(event.target.value)
            const parsed = parseDurationInput(event.target.value)
            if (parsed !== null) onChange(parsed)
          }}
          onBlur={commitText}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault()
              commitText()
              event.currentTarget.blur()
            }
          }}
        />
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="we-duration-picker"
          showCloseButton={false}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <div className="we-duration-picker-heading">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <DialogTitle>{label}</DialogTitle>
            <Button
              variant="ghost"
              onClick={() => {
                onChange(draft)
                setText(durationClock(draft))
                setOpen(false)
              }}
            >
              Done
            </Button>
          </div>
          <DialogDescription className="sr-only">
            Scroll each wheel to choose hours, minutes, and seconds.
          </DialogDescription>
          <div className="we-time-wheels">
            <TimeWheel
              label="Hours"
              count={Math.max(100, hours + 1)}
              value={hours}
              onChange={(n) =>
                setDraft((current) => n * 3600 + (current % 3600))
              }
            />
            <TimeWheel
              label="Minutes"
              count={60}
              value={minutes}
              onChange={(n) =>
                setDraft(
                  (current) =>
                    Math.floor(current / 3600) * 3600 + n * 60 + (current % 60)
                )
              }
            />
            <TimeWheel
              label="Seconds"
              count={60}
              value={seconds}
              onChange={(n) =>
                setDraft((current) => Math.floor(current / 60) * 60 + n)
              }
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
