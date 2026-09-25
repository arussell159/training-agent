import type { LucideIcon } from "lucide-react"
import { ChevronRight } from "lucide-react"
import type { MouseEvent, ReactNode } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { cn } from "cn"

export function SettingsList({ children, className }: { children: ReactNode; className?: string }) {
  return <Card className={cn("gap-0 divide-y overflow-hidden rounded-2xl py-0 shadow-none", className)}>{children}</Card>
}

export function SettingsListItem({
  icon: Icon,
  label,
  description,
  value,
  onClick,
  expanded,
  className,
}: {
  icon?: LucideIcon
  label: string
  description?: string
  value?: string
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  expanded?: boolean
  className?: string
}) {
  return <Button
    type="button"
    variant="ghost"
    aria-expanded={expanded}
    className={cn("h-14 w-full justify-start rounded-none px-4 font-normal", description && !value && "h-auto min-h-14 py-3", className)}
    onClick={onClick}
  >
    {Icon && <Icon className="size-4 text-muted-foreground" aria-hidden="true" />}
    <span className={cn("min-w-0 flex-1 truncate text-left", description && !value && "whitespace-normal")}>
      <span className={cn("block truncate", description && !value && "text-sm font-medium")}>{label}</span>
      {description && <span className="mt-1 block truncate text-xs text-muted-foreground">{description}</span>}
    </span>
    {value && <span className="max-w-32 truncate text-xs text-muted-foreground">{value}</span>}
    <ChevronRight className={cn("size-4 text-muted-foreground/70", expanded && "rotate-90")} aria-hidden="true" />
  </Button>
}
