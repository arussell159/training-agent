import type { LucideIcon } from "lucide-react"
import { Check, ChevronDown, Circle, LoaderCircle } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export function ChainOfThought({
  defaultOpen = false,
  isStreaming = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  defaultOpen?: boolean
  isStreaming?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen || isStreaming)

  useEffect(() => {
    setOpen(isStreaming)
  }, [isStreaming])

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("w-full", className)}
    >
      <div {...props}>{children}</div>
    </Collapsible>
  )
}

export function ChainOfThoughtHeader({
  children = "Chain of thought",
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger>) {
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full items-center gap-2 py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground",
        className
      )}
      {...props}
    >
      <span>{children}</span>
      <ChevronDown className="ml-auto size-3.5 transition-transform data-[panel-open]:rotate-180" />
    </CollapsibleTrigger>
  )
}

export function ChainOfThoughtContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      className={cn("space-y-2 border-l py-1 pl-3", className)}
      {...props}
    />
  )
}

export function ChainOfThoughtStep({
  icon: Icon,
  label,
  description,
  status = "pending",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  icon?: LucideIcon
  label?: string
  description?: string
  status?: "complete" | "active" | "pending"
}) {
  const StatusIcon =
    Icon ||
    (status === "complete"
      ? Check
      : status === "active"
        ? LoaderCircle
        : Circle)
  return (
    <div className={cn("flex gap-2 text-xs", className)} {...props}>
      <StatusIcon
        className={cn(
          "mt-0.5 size-3.5 shrink-0 text-muted-foreground",
          status === "active" && "animate-spin",
          status === "complete" && "text-foreground"
        )}
      />
      <div className="min-w-0">
        <p className="font-medium text-foreground">{label}</p>
        {description && <p className="text-muted-foreground">{description}</p>}
      </div>
    </div>
  )
}
