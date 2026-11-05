import {
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
  type CSSProperties,
} from "react"
import { useIsMobile } from "@/hooks/use-mobile"
import { useMobileTabGesture } from "@/hooks/use-mobile-tab-gesture"
import { LiquidGlassLayer } from "@/components/ui/liquid-glass-layer"
import { MobileTabIcon } from "@/components/ui/mobile-tab-icon"

const destinations = [
  { label: "Home", id: "home" },
  { label: "Calendar", id: "calendar" },
  { label: "Coach", id: "coach" },
  {
    label: "Annual Plan",
    displayLabel: "ATP",
    id: "annual-plan",
  },
  { label: "Settings", displayLabel: "More", id: "settings" },
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
  const selectedIndex = Math.max(
    0,
    destinations.findIndex((item) => item.label === activeItem)
  )
  const gesture = useMobileTabGesture(
    activeItem,
    destinations.length,
    (index) => onNavigate(destinations[index].label)
  )
  if (!mobile) return null
  return (
    <nav
      className="toolbar toolbar-bottom tabbar tabbar-icons no-outline mobile-navbar native-glass-tabs"
      aria-label="Primary navigation"
      data-native-react-tabs=""
      style={
        { "--mobile-tab-position": `${selectedIndex * 100}%` } as CSSProperties
      }
    >
      <div className="toolbar-inner">
        <div className="toolbar-pane liquid-glass-nav">
          <LiquidGlassLayer />
          <div
            className="mobile-tab-track"
            ref={gesture.pane}
            role="tablist"
            aria-label="App pages"
            {...gesture.handlers}
          >
            {destinations.map(({ label, displayLabel, id }, index) => (
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
                data-tab-index={index}
                data-highlighted={(gesture.preview ?? selectedIndex) === index}
                tabIndex={selectedIndex === index ? 0 : -1}
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
                <MobileTabIcon
                  page={id}
                  selected={(gesture.preview ?? selectedIndex) === index}
                />
                <span className="tabbar-label">{displayLabel ?? label}</span>
              </button>
            ))}
            <span className="tab-link-highlight" aria-hidden="true" />
          </div>
        </div>
      </div>
    </nav>
  )
}
