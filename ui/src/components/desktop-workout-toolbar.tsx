import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react"
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
        // A boolean lets Base UI respect focus already transferred into an
        // opened editor. A resolver is treated as an explicit focus override.
        finalFocus={!preserveActionFocus.current}
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

// Additional app controls live on the header's standard context gesture so
// they do not add controls to the reference workout window's visible chrome.
export function DesktopWorkoutContextMenu({rootRef, settings, actions, disabled=false}: {
  rootRef: RefObject<HTMLDivElement | null>
  settings: ReactNode
  actions: ReactNode
  disabled?: boolean
}) {
  const menu = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  useEffect(() => {
    const header = rootRef.current?.querySelector<HTMLElement>(".dtb-header")
    const popup = menu.current
    if (!header || !popup || disabled) return
    const openAt = (x: number, y: number) => {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      popup.style.left = `${Math.max(8, Math.min(x, innerWidth - 288))}px`
      popup.style.top = `${Math.max(8, Math.min(y, innerHeight - 360))}px`
      popup.showPopover()
      popup.querySelector<HTMLElement>("button:enabled, input:enabled, select:enabled")?.focus({preventScroll:true})
    }
    const contextMenu = (event: MouseEvent) => {
      if (popup.contains(event.target as Node)) return
      event.preventDefault()
      openAt(event.clientX,event.clientY)
    }
    const keyboardMenu = (event: KeyboardEvent) => {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return
      if (popup.contains(event.target as Node)) return
      event.preventDefault()
      const rect = (event.target as HTMLElement).getBoundingClientRect()
      openAt(rect.left,rect.bottom)
    }
    // The dialog library cannot see a native HTML popover in its dismiss stack.
    // Consume Escape before its document listener can dismiss the workout too.
    const escape = (event: KeyboardEvent) => {
      if(event.key!=="Escape" || !popup.matches(":popover-open"))return
      event.preventDefault()
      event.stopImmediatePropagation()
      popup.hidePopover()
      if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true})
    }
    header.addEventListener("contextmenu",contextMenu)
    header.addEventListener("keydown",keyboardMenu)
    window.addEventListener("keydown",escape,true)
    return () => {
      header.removeEventListener("contextmenu",contextMenu)
      header.removeEventListener("keydown",keyboardMenu)
      window.removeEventListener("keydown",escape,true)
    }
  },[rootRef,disabled])
  useEffect(() => {if(disabled)menu.current?.hidePopover()},[disabled])
  return <div ref={menu} popover="auto" role="dialog" aria-label="Workout settings and actions" className="desktop-workout-context-popover"
    onToggle={event => {
      if(event.currentTarget.matches(":popover-open"))return
      const active=document.activeElement
      if(active===document.body || (active && event.currentTarget.contains(active))) {
        const target=returnFocus.current
        if(target?.isConnected)target.focus({preventScroll:true})
      }
    }}
    onClick={event=>{
      const action=(event.target as HTMLElement).closest("button")
      if(action && !action.disabled)menu.current?.hidePopover()
    }}>
    <fieldset><legend>Workout settings</legend>{settings}</fieldset>
    <div className="desktop-workout-context-actions" aria-label="Workout actions">{actions}</div>
  </div>
}
