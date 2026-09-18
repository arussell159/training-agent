import type { ReactNode } from "react"
import { ExternalLink } from "lucide-react"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"
import { cn } from "@/lib/utils"

export function InlineCitation({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span className={cn("inline-flex align-baseline", className)} {...props} />
  )
}

export function InlineCitationText({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return <span className={cn("mr-1", className)} {...props} />
}

export function InlineCitationCard({
  children,
  ...props
}: React.ComponentProps<typeof HoverCard>) {
  return <HoverCard {...props}>{children}</HoverCard>
}

export function InlineCitationCardTrigger({
  sources = [],
  children,
  className,
  ...props
}: React.ComponentProps<"button"> & { sources?: string[] }) {
  const label =
    children || `Source${sources.length > 1 ? `s · ${sources.length}` : ""}`
  return (
    <HoverCardTrigger
      render={
        <button
          type="button"
          className={cn(
            "inline-flex items-center rounded-md bg-muted px-1.5 py-0.5 text-[0.7rem] font-medium text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground",
            className
          )}
          {...props}
        />
      }
    >
      {label}
    </HoverCardTrigger>
  )
}

export function InlineCitationCardBody({
  className,
  ...props
}: React.ComponentProps<typeof HoverCardContent>) {
  return <HoverCardContent className={cn("w-72 p-3", className)} {...props} />
}

export function InlineCitationSource({
  title,
  url,
  description,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  title?: string
  url?: string
  description?: string
}) {
  const content = (
    <div className={cn("space-y-1", className)} {...props}>
      <p className="font-medium text-foreground">{title}</p>
      {description && (
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      )}
      {url && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          {new URL(url).hostname}
          <ExternalLink className="size-3" />
        </span>
      )}
    </div>
  )
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="block hover:underline"
    >
      {content}
    </a>
  ) : (
    content
  )
}

export function InlineCitationQuote({
  className,
  ...props
}: React.ComponentProps<"blockquote">) {
  return (
    <blockquote
      className={cn(
        "border-l-2 pl-2 text-xs leading-5 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export function InlineCitationCarousel({ children }: { children?: ReactNode }) {
  return <div>{children}</div>
}

export function InlineCitationCarouselContent({
  children,
}: {
  children?: ReactNode
}) {
  return <div>{children}</div>
}

export function InlineCitationCarouselItem({
  children,
}: {
  children?: ReactNode
}) {
  return <div>{children}</div>
}
