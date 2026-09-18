import { ChevronDown, LoaderCircle } from "lucide-react"
import { useEffect, useState } from "react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

export function Reasoning({
  isStreaming = false,
  defaultOpen = false,
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  isStreaming?: boolean
  defaultOpen?: boolean
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

export function ReasoningTrigger({
  children = "Reasoning",
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
      <LoaderCircle className="size-3.5 data-[streaming=true]:animate-spin" />
      <span>{children}</span>
      <ChevronDown className="ml-auto size-3.5 transition-transform data-[panel-open]:rotate-180" />
    </CollapsibleTrigger>
  )
}

export function ReasoningContent({
  className,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      className={cn(
        "border-l pl-3 text-xs leading-5 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}
