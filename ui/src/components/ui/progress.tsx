import { Progress as ProgressPrimitive } from "@base-ui/react/progress"
import { cn } from "cn"

export function Progress({
  value,
  "aria-label": ariaLabel = "Progress",
  className,
}: {
  value: number | null
  "aria-label"?: string
  className?: string
}) {
  return (
    <ProgressPrimitive.Root
      value={value}
      aria-label={ariaLabel}
      className={cn("h-1.5 w-full overflow-hidden rounded-full bg-primary/15", className)}
    >
      <ProgressPrimitive.Track className="size-full overflow-hidden rounded-full">
        <ProgressPrimitive.Indicator
          className={cn(
            "h-full rounded-full bg-primary",
            value == null
              ? "w-1/3 animate-[sync-progress_1.8s_ease-in-out_infinite]"
              : "transition-[width] duration-700 ease-out"
          )}
        />
      </ProgressPrimitive.Track>
    </ProgressPrimitive.Root>
  )
}
