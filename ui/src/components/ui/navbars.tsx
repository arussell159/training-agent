import { type ReactNode, type MouseEvent, type KeyboardEvent } from "react"
import {
  CalendarDays,
  CalendarRange,
  Menu,
  Home,
  MessageCircle,
} from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { LiquidGlassLayer } from "@/components/ui/liquid-glass-layer"

const destinations = [
  { label: "Home", icon: Home, id: "home" },
  { label: "Calendar", icon: CalendarDays, id: "calendar" },
  { label: "Coach", icon: MessageCircle, id: "coach" },
  {
    label: "Annual Plan",
    displayLabel: "ATP",
    icon: CalendarRange,
    id: "annual-plan",
  },
  { label: "Settings", displayLabel: "More", icon: Menu, id: "settings" },
]

export function MobilePageTabs({
  activeItem,
  children,
}: {
  activeItem: string
  children: ReactNode
}) {
  const mobile = useIsMobile()
  if (!mobile) return children
  return (
    <div className="tabs mobile-page-tabs">
      {destinations.map(({ label, id }) => (
        <div
          key={id}
          id={`mobile-panel-${id}`}
          className={`tab mobile-page-tab ${activeItem === label ? "tab-active app-surface-enter" : ""}`}
          {...{ role: "tabpanel" }}
          aria-label={label}
        >
          {activeItem === label ? children : null}
        </div>
      ))}
    </div>
  )
}

export function MobileNavbar({
  activeItem,
  onNavigate,
  onPrefetch,
}: {
  activeItem: string
  onNavigate: (destination: string) => void
  onPrefetch?: (destination: string) => void
}) {
  const mobile = useIsMobile()
  if (!mobile) return null
  return (
    <nav
      className="toolbar toolbar-bottom tabbar tabbar-icons no-outline mobile-navbar"
      aria-label="Primary navigation"
    >
      <div className="toolbar-inner">
        <div
          className="toolbar-pane liquid-glass-nav"
          role="tablist"
          aria-label="App pages"
        >
          <LiquidGlassLayer />
          {destinations.map(
            ({ label, displayLabel, icon: Icon, id }, index) => (
              <button
                key={id}
                type="button"
                className={
                  activeItem === label ? "tab-link tab-link-active" : "tab-link"
                }
                id={`mobile-tab-${id}`}
                role="tab"
                aria-label={displayLabel ?? label}
                aria-selected={activeItem === label}
                aria-controls={`mobile-panel-${id}`}
                tabIndex={
                  activeItem === label ||
                  (activeItem === "Annual Plan" && index === 0)
                    ? 0
                    : -1
                }
                onClick={(event: MouseEvent) => {
                  event.preventDefault()
                  onNavigate(label)
                }}
                onPointerEnter={() => onPrefetch?.(label)}
                onFocus={() => onPrefetch?.(label)}
                onTouchStart={() => onPrefetch?.(label)}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => {
                  const next =
                    event.key === "ArrowRight"
                      ? (index + 1) % destinations.length
                      : event.key === "ArrowLeft"
                        ? (index + destinations.length - 1) %
                          destinations.length
                        : event.key === "Home"
                          ? 0
                          : event.key === "End"
                            ? destinations.length - 1
                            : null
                  if (next == null) return
                  event.preventDefault()
                  onNavigate(destinations[next].label)
                  document
                    .getElementById(`mobile-tab-${destinations[next].id}`)
                    ?.focus()
                }}
              >
                <Icon
                  aria-hidden="true"
                  strokeWidth={label === "Settings" ? 2.8 : undefined}
                />
                <span className="tabbar-label">{displayLabel ?? label}</span>
              </button>
            )
          )}
          <span className="tab-link-highlight" aria-hidden="true" />
        </div>
      </div>
    </nav>
  )
}
