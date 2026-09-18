import { useEffect, useId, useRef, useState } from "react"
import { f7, f7ready } from "framework7-react"
import type { Picker } from "framework7/types"
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

function MobileTimePicker({
  initialValue,
  onChange,
}: {
  initialValue: number
  onChange: (seconds: number) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const id = useId().replace(/:/g, "")
  useEffect(() => {
    let disposed = false
    let picker: Picker.Picker | undefined
    const cleanup: (() => void)[] = []
    f7ready(() => {
      if (disposed || !container.current) return
      const values = (count: number) =>
        Array.from({ length: count }, (_, n) => String(n).padStart(2, "0"))
      const current = [
        Math.floor(initialValue / 3600),
        Math.floor(initialValue / 60) % 60,
        initialValue % 60,
      ].map((n) => String(n).padStart(2, "0"))
      const updateAccessibility = () => {
        picker?.cols
          .filter((_, index) => index % 2 === 0)
          .forEach((col, index) => {
            const column = col.el
            if (!column) return
            column.setAttribute(
              "aria-activedescendant",
              id + "-" + index + "-" + col.value
            )
            column
              .querySelectorAll<HTMLElement>(".picker-item")
              .forEach((item) =>
                item.setAttribute(
                  "aria-selected",
                  String(item.dataset.pickerValue === col.value)
                )
              )
          })
      }
      picker = f7.picker.create({
        containerEl: container.current,
        toolbar: false,
        rotateEffect: true,
        closeByOutsideClick: false,
        value: current,
        formatValue: (values) => values.join(":"),
        cols: [
          {
            values: values(Math.max(100, Math.floor(initialValue / 3600) + 1)),
            textAlign: "center",
          },
          { divider: true, content: ":" },
          { values: values(60), textAlign: "center" },
          { divider: true, content: ":" },
          { values: values(60), textAlign: "center" },
        ],
        on: {
          change: (_picker, value) => {
            const parts = (value as string[]).map(Number)
            if (parts.length === 3 && parts.every(Number.isFinite))
              onChange(parts[0] * 3600 + parts[1] * 60 + parts[2])
            updateAccessibility()
          },
        },
      })
      picker.cols
        .filter((_, index) => index % 2 === 0)
        .forEach((col, index) => {
          const column = col.el
          column.setAttribute("role", "listbox")
          column.setAttribute(
            "aria-label",
            ["Hours", "Minutes", "Seconds"][index]
          )
          column.tabIndex = 0
          column
            .querySelectorAll<HTMLElement>(".picker-item")
            .forEach((item) => {
              item.setAttribute("role", "option")
              item.id = id + "-" + index + "-" + item.dataset.pickerValue
            })
          const keydown = (event: KeyboardEvent) => {
            const values = Array.from(
              {
                length:
                  index === 0
                    ? Math.max(100, Math.floor(initialValue / 3600) + 1)
                    : 60,
              },
              (_, n) => String(n).padStart(2, "0")
            )
            const currentIndex = values.indexOf(String(col.value))
            const next =
              event.key === "ArrowDown"
                ? currentIndex + 1
                : event.key === "ArrowUp"
                  ? currentIndex - 1
                  : event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? values.length - 1
                      : null
            if (next == null) return
            event.preventDefault()
            col.setValue(values[Math.max(0, Math.min(values.length - 1, next))])
          }
          column.addEventListener("keydown", keydown)
          cleanup.push(() => column.removeEventListener("keydown", keydown))
        })
      updateAccessibility()
    })
    return () => {
      disposed = true
      cleanup.forEach((fn) => fn())
      picker?.destroy()
    }
  }, [id, initialValue, onChange])
  return (
    <>
      <div className="we-time-labels" aria-hidden="true">
        <span>Hours</span>
        <span>Minutes</span>
        <span>Seconds</span>
      </div>
      <div ref={container} className="we-framework7-time-picker" />
    </>
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
          <MobileTimePicker
            initialValue={Math.round(value)}
            onChange={setDraft}
          />
        </DialogContent>
      </Dialog>
    </div>
  )
}
