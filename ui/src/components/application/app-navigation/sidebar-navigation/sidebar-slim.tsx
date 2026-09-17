import type { ComponentType } from "react"
import { BookOpen, Ellipsis } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type NavItem = { label: string; icon: ComponentType<{ className?: string }> }

export function SidebarNavigationSlim({
  items,
  activeItem,
  onNavigate,
  onPrefetch,
}: {
  items: NavItem[]
  activeItem: string
  onNavigate: (label: string) => void
  onPrefetch?: (label: string) => void
}) {
  const navButton = ({ label, icon: Icon }: NavItem) => (
    <Button
      key={label}
      variant="ghost"
      size="icon"
      type="button"
      aria-label={label}
      title={label}
      aria-current={activeItem === label ? "page" : undefined}
      onClick={() => onNavigate(label)}
      onPointerEnter={() => onPrefetch?.(label)}
      onFocus={() => onPrefetch?.(label)}
      className={cn(
        "size-11 rounded-lg text-muted-foreground hover:text-foreground",
        activeItem === label && "bg-accent text-foreground"
      )}
    >
      <Icon className="size-6" />
    </Button>
  )
  return (
    <div className="relative hidden w-[72px] shrink-0 md:block">
      <aside
        aria-label="Desktop sidebar"
        className="fixed inset-y-0 left-0 z-40 flex w-[72px] border-r bg-background"
      >
        <nav
          aria-label="Primary navigation"
          className="flex w-[72px] shrink-0 flex-col items-center gap-2 border-r py-5"
        >
          <Button
            variant="ghost"
            size="icon"
            className="mb-5 size-11"
            aria-label="AR Performance Home"
            onClick={() => onNavigate("Home")}
          >
            <img
              src="/ar-performance-logo.png"
              alt=""
              className="size-8 rounded-md object-contain"
            />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-11 rounded-lg text-muted-foreground hover:text-foreground"
                  aria-label="Site menu"
                  title="Site menu"
                />
              }
            >
              <Ellipsis className="size-6" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              side="right"
              align="start"
              className="w-max min-w-48"
            >
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={() => window.dispatchEvent(new Event("terms-open"))}
              >
                <BookOpen />
                Terms &amp; definitions
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {items.filter((item) => item.label !== "Settings").map(navButton)}
          <div className="mt-auto">
            {items.filter((item) => item.label === "Settings").map(navButton)}
          </div>
        </nav>
      </aside>
    </div>
  )
}
