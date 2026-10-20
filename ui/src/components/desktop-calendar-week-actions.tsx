import { useRef, useState } from "react"
import {
  ArrowRightLeft,
  ClipboardPaste,
  Copy,
  EllipsisVertical,
  Scissors,
  Trash2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function DesktopCalendarWeekActions({
  start,
  disabled,
  count,
  canPaste,
  onAction,
}: {
  start: string
  disabled: boolean
  count: number
  canPaste: boolean
  onAction: (action: "cut" | "copy" | "paste" | "shift" | "delete") => void
}) {
  const afterClose = useRef<"shift" | "delete" | null>(null)
  const label = new Date(`${start}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
  return (
    <div className="calendar-week-actions">
      <DropdownMenu
        onOpenChangeComplete={(open) => {
          if (!open && afterClose.current) {
            const action = afterClose.current
            afterClose.current = null
            onAction(action)
          }
        }}
      >
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={disabled}
              aria-label={`Actions for week of ${label}`}
              title="Week actions"
            />
          }
        >
          <EllipsisVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="calendar-context-menu">
          <DropdownMenuItem
            disabled={disabled || !count}
            onClick={() => onAction("cut")}
          >
            <Scissors />
            Cut
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled || !count}
            onClick={() => onAction("copy")}
          >
            <Copy />
            Copy
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled || !canPaste}
            onClick={() => onAction("paste")}
          >
            <ClipboardPaste />
            Paste
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={disabled || !count}
            onClick={() => {
              afterClose.current = "shift"
            }}
          >
            <ArrowRightLeft />
            Shift
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={disabled || !count}
            onClick={() => {
              afterClose.current = "delete"
            }}
          >
            <Trash2 />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function DesktopCalendarShiftDialog({
  start,
  count,
  onClose,
  onShift,
}: {
  start: string
  count: number
  onClose: () => void
  onShift: (date: string) => void
}) {
  const [mode, setMode] = useState("date"),
    [date, setDate] = useState(start),
    [amount, setAmount] = useState("1"),
    [error, setError] = useState("")
  const submit = () => {
    let target = date
    if (mode !== "date") {
      const value = Number(amount)
      if (
        !Number.isInteger(value) ||
        !amount.trim() ||
        Math.abs(value) > 3660
      ) {
        setError("Enter a whole number between -3660 and 3660.")
        return
      }
      target = new Date(
        Date.parse(`${start}T00:00:00Z`) +
          value * (mode === "weeks" ? 7 : 1) * 86400000
      )
        .toISOString()
        .slice(0, 10)
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(target) ||
      !Number.isFinite(Date.parse(target)) ||
      new Date(target).toISOString().slice(0, 10) !== target
    ) {
      setError("Choose a valid destination date.")
      return
    }
    if (target === start) {
      setError("Choose a different start date.")
      return
    }
    onShift(target)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="calendar-shift-dialog">
        <form
          className="grid gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Shift Items</DialogTitle>
            <DialogDescription>
              Move {count} planned workout{count === 1 ? "" : "s"} and notes
              from the week of{" "}
              {new Date(`${start}T12:00:00`).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
              . Keep their relative days and start times.
            </DialogDescription>
          </DialogHeader>
          <fieldset className="space-y-3">
            <legend className="mb-3 text-sm font-medium">
              How do you want to shift these items?
            </legend>
            {[
              ["date", "Move to new start date"],
              ["days", "Move by a specified number of days"],
              ["weeks", "Move by a specified number of weeks"],
            ].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="calendar-shift-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => {
                    setMode(value)
                    setError("")
                  }}
                />
                {label}
              </label>
            ))}
          </fieldset>
          {mode === "date" ? (
            <label className="space-y-2 text-sm">
              Select new start date
              <Input
                aria-label="New start date"
                type="date"
                value={date}
                onInput={(event) => {
                  setDate(event.currentTarget.value)
                  setError("")
                }}
                onChange={(event) => {
                  setDate(event.target.value)
                  setError("")
                }}
              />
            </label>
          ) : (
            <label className="space-y-2 text-sm">
              Number of {mode}
              <Input
                aria-label={`Number of ${mode}`}
                type="number"
                min={-3660}
                max={3660}
                step={1}
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value)
                  setError("")
                }}
              />
            </label>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">OK</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
