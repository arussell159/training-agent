import type { ReactNode, MouseEvent, KeyboardEvent } from "react"
import { Tab, Tabs, Toolbar, ToolbarPane } from "framework7-react"
import {
  CalendarDays,
  Home,
  Library,
  MessageCircle,
  Settings,
} from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"

const destinations = [
  { label: "Home", icon: Home, id: "home" },
  { label: "Calendar", icon: CalendarDays, id: "calendar" },
  { label: "Coach", icon: MessageCircle, id: "coach" },
  { label: "Library", icon: Library, id: "library" },
  { label: "Settings", icon: Settings, id: "settings" },
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
    <Tabs className="mobile-page-tabs">
      {[...destinations, { label: "Annual Plan", id: "annual-plan" }].map(
        ({ label, id }) => (
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
        )
      )}
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
  return (
    <Toolbar
      bottom
      tabbar
      icons
      className="mobile-navbar"
      {...{ role: "navigation" }}
      aria-label="Primary navigation"
    >
      <ToolbarPane {...{ role: "tablist" }} aria-label="App pages">
        {destinations.map(({ label, icon: Icon, id }, index) => (
          <button
            key={id}
            type="button"
            data-tab={`#mobile-panel-${id}`}
            className={
              activeItem === label ? "tab-link tab-link-active" : "tab-link"
            }
            id={`mobile-tab-${id}`}
            role="tab"
            aria-label={label}
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
            onPointerDown={() => {
              if (activeItem === "Calendar" && label === "Calendar")
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
            <Icon aria-hidden="true" />
            <span className="tabbar-label">{label}</span>
          </button>
        ))}
      </ToolbarPane>
    </Toolbar>
  )
}
