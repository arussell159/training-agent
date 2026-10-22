import {
  BookOpen,
  CalendarRange,
  Map,
  Settings,
  ChevronDown,
} from "lucide-react"
import { cachedTrainingContext } from "@/lib/training-context"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import "./desktop-calendar-workspace.css"

/** Calendar chrome is intentionally independent of the rest of the app shell. */
export function DesktopCalendarWorkspaceNavigation({
  onNavigate,
}: {
  onNavigate: (destination: string) => void
}) {
  const athlete = cachedTrainingContext().athlete.name || "Athlete"
  return (
    <>
      <header
        className="desktop-calendar-topbar"
        aria-label="Calendar workspace"
      >
        <button
          className="desktop-calendar-brand"
          onClick={() => onNavigate("Home")}
          aria-label="AR Performance Home"
        >
          <img src="/ar-performance-mark.png" alt="" />
        </button>
        <nav aria-label="Primary navigation">
          {[
            ["Home", "Home"],
            ["Calendar", "Calendar"],
            ["Dashboard", "Home"],
            ["ATP", "Annual Plan"],
          ].map(([label, destination]) => (
            <button
              key={label}
              type="button"
              aria-current={label === "Calendar" ? "page" : undefined}
              onClick={() => onNavigate(destination)}
            >
              {label}
            </button>
          ))}
        </nav>
        <DropdownMenu>
          <DropdownMenuTrigger className="desktop-calendar-account">
            <span className="desktop-calendar-athlete-avatar" aria-hidden="true">{athlete.split(/\s+/).slice(0,2).map(part=>part[0]).join("")}</span>
            <span>{athlete}</span>
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="calendar-context-menu">
            <DropdownMenuItem onClick={() => onNavigate("Nutrition")}>
              Nutrition
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onNavigate("Coach")}>
              Coach
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onNavigate("Workout Reports")}>
              Workout reports
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onNavigate("Settings")}>
              <Settings />
              Settings
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </header>
      <aside
        className="desktop-calendar-library-rail"
        aria-label="Calendar libraries"
      >
        <button type="button" onClick={() => onNavigate("Library")}>
          <BookOpen aria-hidden="true" />
          <span>
            Workout
            <br />
            Library
          </span>
        </button>
        <button type="button" onClick={() => onNavigate("Annual Plan")}>
          <CalendarRange aria-hidden="true" />
          <span>
            Training
            <br />
            Plans
          </span>
        </button>
        <button
          type="button"
          disabled
          title="Route-library management is not available through this Intervals.icu connection."
        >
          <Map aria-hidden="true" />
          <span>
            Routes
            <br />
            Library
          </span>
        </button>
      </aside>
      <div className="desktop-calendar-rail-space" aria-hidden="true" />
    </>
  )
}
