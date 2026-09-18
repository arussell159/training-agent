import { forwardRef } from "react"
import { ArrowUp, LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

export type PromptInputMessage = {
  text: string
  files?: File[]
}

export function PromptInput({
  onSubmit,
  className,
  children,
  ...props
}: Omit<React.ComponentProps<"form">, "onSubmit"> & {
  onSubmit?: (message: PromptInputMessage) => void
}) {
  return (
    <form
      className={cn("w-full", className)}
      onSubmit={(event) => {
        event.preventDefault()
        const value = new FormData(event.currentTarget).get("prompt-input")
        onSubmit?.({ text: typeof value === "string" ? value : "" })
      }}
      {...props}
    >
      {children}
    </form>
  )
}

export const PromptInputTextarea = forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<typeof Textarea>
>(function PromptInputTextarea(
  { className, name = "prompt-input", ...props },
  ref
) {
  return (
    <Textarea
      ref={ref}
      name={name}
      className={cn(
        "min-h-11 resize-none border-0 bg-transparent px-1 py-2.5 text-base shadow-none outline-none focus-visible:ring-0 md:text-sm",
        className
      )}
      {...props}
    />
  )
})

export function PromptInputSubmit({
  status = "ready",
  className,
  ...props
}: React.ComponentProps<typeof Button> & {
  status?: "ready" | "submitted" | "streaming" | "error"
}) {
  return (
    <Button
      type="submit"
      size="icon"
      aria-label={status === "streaming" ? "Sending message" : "Send message"}
      className={className}
      {...props}
    >
      {status === "streaming" ? (
        <LoaderCircle className="animate-spin" />
      ) : (
        <ArrowUp />
      )}
    </Button>
  )
}

export function PromptInputBody({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("min-w-0 flex-1", className)} {...props} />
}

export function PromptInputFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("flex items-center justify-between gap-2", className)}
      {...props}
    />
  )
}

export function PromptInputTools({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return <div className={cn("flex items-center gap-1", className)} {...props} />
}
