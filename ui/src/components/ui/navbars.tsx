import {
  CalendarDays,
  Home,
  Library,
  MessageCircle,
  Settings,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const destinations = [
  { label: "Home", icon: Home },
  { label: "Calendar", icon: CalendarDays },
  { label: "Coach", icon: MessageCircle },
  { label: "Library", icon: Library },
  { label: "Settings", icon: Settings },
]

export function MobileNavbar({
  activeItem,
  onNavigate,
}: {
  activeItem: string
  onNavigate: (destination: string) => void
}) {
  return (
    <div className="pointer-events-none fixed inset-x-[calc(1rem+env(safe-area-inset-bottom))] bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex justify-center md:hidden">
      <nav
        aria-label="Primary navigation"
        className="pointer-events-auto flex w-full items-center justify-between gap-2 rounded-full border border-border/70 bg-background/95 p-2 shadow-lg backdrop-blur"
      >
        {destinations.map(({ label, icon: Icon }) => (
          <Button
            key={label}
            type="button"
            variant={label === "Coach" ? "default" : "ghost"}
            size="icon"
            aria-label={label}
            aria-current={activeItem === label ? "page" : undefined}
            onClick={() => onNavigate(label)}
            className={cn(
              "size-11 rounded-full transition-colors",
              label !== "Coach" &&
                activeItem === label &&
                "bg-accent text-accent-foreground"
            )}
          >
            <Icon className="size-5" />
            <span className="sr-only">{label}</span>
          </Button>
        ))}
      </nav>
    </div>
  )
}
