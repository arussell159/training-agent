import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { cn } from "@/lib/utils"

export function Message({
  from = "assistant",
  className,
  ...props
}: React.ComponentProps<"div"> & { from?: string }) {
  return (
    <div
      data-message-role={from}
      className={cn(
        "flex w-full gap-3",
        from === "user" ? "justify-end" : "justify-start",
        className
      )}
      {...props}
    />
  )
}

export function MessageContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "max-w-[92%] min-w-0 text-sm leading-7",
        "[&[data-message-role=user]]:rounded-2xl [&[data-message-role=user]]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

export function MessageResponse({
  children,
  className,
  ...props
}: Omit<React.ComponentProps<"div">, "children"> & {
  children?: string
}) {
  return (
    <div className={cn("wrap-anywhere text-foreground", className)} {...props}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        components={{
          img: () => null,
          a: ({ children: linkChildren }) => <span>{linkChildren}</span>,
          table: ({ children: tableChildren }) => (
            <div className="overflow-x-auto">
              <table>{tableChildren}</table>
            </div>
          ),
        }}
      >
        {children || ""}
      </ReactMarkdown>
    </div>
  )
}

export function MessageActions({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-1 text-muted-foreground",
        className
      )}
      {...props}
    />
  )
}

export function MessageAction({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md hover:bg-muted hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}
