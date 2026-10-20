import { useRef, useState, type ReactNode } from "react"
import { List, Settings } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"

function ToolbarMenu({
  label,
  children,
  icon,
  disabled,
}: {
  label: string
  children: ReactNode
  icon: ReactNode
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const preserveActionFocus = useRef(false)
  return (
    <Popover open={open && !disabled} onOpenChange={next => {
      if (next) preserveActionFocus.current = false
      setOpen(next)
    }}>
      <PopoverTrigger render={<button type="button" aria-label={label} title={label} disabled={disabled} />}>
        {icon}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="desktop-workout-toolbar-popover"
        aria-label={label}
        inert={disabled || undefined}
        finalFocus={() => !preserveActionFocus.current}
        onClick={event => {
          const action = (event.target as HTMLElement).closest("button")
          if (action && !action.disabled) {
            preserveActionFocus.current = !event.currentTarget.contains(document.activeElement)
            setOpen(false)
          }
        }}
      >
        {children}
      </PopoverContent>
    </Popover>
  )
}

export function DesktopWorkoutToolbar({
  settings,
  actions,
  disabled = false,
}: {
  settings?: ReactNode
  actions?: ReactNode
  disabled?: boolean
}) {
  return (
    <>
      {[
        { label: "Workout settings", content: settings, Icon: Settings },
        { label: "Workout actions", content: actions, Icon: List },
      ].map(({ label, content, Icon }) =>
        content ? (
          <ToolbarMenu key={`${label}-${disabled}`} label={label} disabled={disabled} icon={<Icon size={15} aria-hidden="true" />}>
            {content}
          </ToolbarMenu>
        ) : null
      )}
    </>
  )
}

export function DesktopWorkoutSummarySettings({ getRoot }: { getRoot: () => HTMLElement | null }) {
  return <button type="button" onClick={() => {
    const field = getRoot()?.querySelector<HTMLInputElement>(".desktop-workout-auto-calculate input")
    field?.scrollIntoView({ block: "nearest" })
    field?.focus({ preventScroll: true })
  }}>Automatically calculate planned values</button>
}
