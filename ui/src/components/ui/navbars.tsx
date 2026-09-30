import { type ReactNode, type MouseEvent, type KeyboardEvent } from "react"
import { Tab, Tabs, Toolbar, ToolbarPane } from "framework7-react"
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

const pageDestinations = [...destinations, { label: "Lab Results", id: "labs" }]

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
    <Tabs className="mobile-page-tabs">
      {pageDestinations.map(({ label, id }) => (
          <Tab
            key={id}
            id={`mobile-panel-${id}`}
            tabActive={activeItem === label}
            className="mobile-page-tab"
            {...{ role: "tabpanel" }}
            aria-label={label}
          >
            {activeItem === label ? children : null}
          </Tab>
        ))}
    </Tabs>
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
  const selectedItem = activeItem === "Lab Results" ? "Settings" : activeItem
  return (
    <Toolbar
      bottom
      tabbar
      icons
      className="mobile-navbar"
      {...{ role: "navigation" }}
      aria-label="Primary navigation"
    >
      <ToolbarPane className="liquid-glass-nav" {...{ role: "tablist" }} aria-label="App pages">
        <LiquidGlassLayer />
        {destinations.map(({ label, displayLabel, icon: Icon, id }, index) => (
          <button
            key={id}
            type="button"
            data-tab={
              selectedItem === label ? undefined : `#mobile-panel-${id}`
            }
            className={
              selectedItem === label ? "tab-link tab-link-active" : "tab-link"
            }
            id={`mobile-tab-${id}`}
            role="tab"
            aria-label={displayLabel ?? label}
            aria-selected={selectedItem === label}
            aria-controls={activeItem === "Lab Results" && label === "Settings" ? "mobile-panel-labs" : `mobile-panel-${id}`}
            tabIndex={
              selectedItem === label ||
              (activeItem === "Annual Plan" && index === 0)
                ? 0
                : -1
            }
            onClick={(event: MouseEvent) => {
              event.preventDefault()
              if (label === "Calendar" && activeItem === "Calendar") {
                window.dispatchEvent(new Event("calendar-go-today"))
                return
              }
              if (label === "Annual Plan" && activeItem === "Annual Plan") {
                window.dispatchEvent(new Event("annual-plan-go-current-week"))
                return
              }
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
                    ? (index + destinations.length - 1) % destinations.length
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
            <Icon aria-hidden="true" strokeWidth={label === "Settings" ? 2.8 : undefined} />
            <span className="tabbar-label">{displayLabel ?? label}</span>
          </button>
        ))}
      </ToolbarPane>
    </Toolbar>
  )
}
