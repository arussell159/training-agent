import type { ComponentProps, ReactNode } from "react"
import { Ellipsis } from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { LiquidGlassLayer } from "@/components/ui/liquid-glass-layer"

type NativeOption = { value: string; label: string; disabled?: boolean }

export function MobileSelect({
  children,
  options,
  onValueChange,
  className,
  ...props
}: Omit<ComponentProps<"select">, "children" | "onChange"> & {
  children: ReactNode
  options: NativeOption[]
  onValueChange: (value: string) => void
}) {
  const mobile = useIsMobile()
  if (!mobile) return children
  return (
    <select
      {...props}
      data-native-control="select"
      className={cn(
        "h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-base text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        className
      )}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className="bg-background text-foreground"
        >
          {option.label}
        </option>
      ))}
    </select>
  )
}

export function MobileActionMenu({
  label,
  actions,
  children,
  className,
  disabled,
  plain = false,
  liquidGlass = false,
}: {
  label: string
  actions: {
    value: string
    label: string
    disabled?: boolean
    onSelect: () => void
  }[]
  children?: ReactNode
  className?: string
  disabled?: boolean
  plain?: boolean
  liquidGlass?: boolean
}) {
  const mobile = useIsMobile()
  if (!mobile) return children
  return (
    <span
      className={cn(
        plain
          ? "relative inline-flex size-9 shrink-0 items-center justify-center"
          : "mobile-glass-action relative inline-flex size-9 shrink-0 items-center justify-center rounded-full",
        disabled && "opacity-50",
        liquidGlass && "liquid-glass-button",
        className
      )}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {liquidGlass && <LiquidGlassLayer />}
      <Ellipsis className="pointer-events-none size-5" aria-hidden="true" />
      <select
        data-native-control="actions"
        aria-label={label}
        disabled={disabled}
        value=""
        className="absolute inset-0 size-full cursor-pointer text-base opacity-0"
        onChange={(event) => {
          const action = actions.find(
            (item) => item.value === event.currentTarget.value
          )
          // Reset before running the action so the same choice can be used again.
          event.currentTarget.value = ""
          if (!disabled && action && !action.disabled) action.onSelect()
        }}
      >
        <option value="" disabled>Options</option>
        {actions.map((action) => (
          <option
            key={action.value}
            value={action.value}
            disabled={action.disabled}
          >
            {action.label}
          </option>
        ))}
      </select>
    </span>
  )
}

export function MobileDatePicker({
  children,
  displayValue,
  onValueChange,
  className,
  ...props
}: Omit<ComponentProps<"input">, "type" | "children" | "onChange"> & {
  children: ReactNode
  displayValue?: string
  onValueChange: (value: string) => void
}) {
  const mobile = useIsMobile()
  if (!mobile) return children
  const field = (
    <input
      {...props}
      type="date"
      data-native-control="date"
      className={cn(
        "h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
        displayValue && "absolute inset-0 size-full cursor-pointer opacity-0",
        !displayValue && className
      )}
      onChange={(event) => {
        if (event.currentTarget.value) onValueChange(event.currentTarget.value)
      }}
    />
  )
  return displayValue ? (
    <span
      className={cn(
        "relative inline-flex items-center focus-within:ring-2 focus-within:ring-ring",
        className
      )}
    >
      <span aria-hidden="true">{displayValue}</span>
      {field}
    </span>
  ) : (
    field
  )
}
