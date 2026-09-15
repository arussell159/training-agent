import type { ComponentType, ReactNode } from "react"
import { SquarePen } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type NavItem = {label: string; icon: ComponentType<{className?: string}>}

export function SidebarNavigationSlim({items, activeItem, onNavigate, children}: {
  items: NavItem[]
  activeItem: string
  onNavigate: (label: string) => void
  children: ReactNode
}) {
  const showHistory = activeItem === "Coach"
  const navButton = ({label, icon: Icon}: NavItem) => (
    <Button key={label} variant="ghost" size="icon" type="button" aria-label={label} title={label}
      aria-current={activeItem === label ? "page" : undefined} onClick={() => onNavigate(label)}
      className={cn("size-11 rounded-lg text-muted-foreground hover:text-foreground", activeItem === label && "bg-accent text-foreground")}>
      <Icon className="size-6" />
    </Button>
  )
  return <div className={cn("relative hidden shrink-0 md:block", showHistory ? "w-[332px]" : "w-[72px]")}>
    <aside aria-label="Desktop sidebar" className={cn("fixed inset-y-0 left-0 z-40 flex border-r bg-background", showHistory ? "w-[332px]" : "w-[72px]")}>
      <nav aria-label="Primary navigation" className="flex w-[72px] shrink-0 flex-col items-center gap-2 border-r py-5">
        <Button variant="ghost" size="icon" className="mb-5 size-11" aria-label="AR Performance Home" onClick={() => onNavigate("Home")}>
          <img src="/ar-performance-logo.png" alt="" className="size-8 rounded-md object-contain" />
        </Button>
        {items.filter(item => item.label !== "Settings").map(navButton)}
        <div className="mt-auto">{items.filter(item => item.label === "Settings").map(navButton)}</div>
      </nav>
      {showHistory && <section aria-label="Coach history" className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-20 shrink-0 items-center justify-between px-4">
          <h2 className="text-base font-medium">Coach</h2>
          <Button variant="ghost" size="icon-sm" aria-label="New chat" title="New chat" onClick={() => onNavigate("Coach")}><SquarePen className="size-4" /></Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">{children}</div>
      </section>}
    </aside>
  </div>
}
