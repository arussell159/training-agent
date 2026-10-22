import type { ComponentType } from "react"
import { cn } from "@/lib/utils"

export function MobileFilterTabs<T extends string>({
  label,
  items,
  value,
  onChange,
  className,
  inline = false,
}: {
  label: string
  items: readonly {
    value: T
    label: string
    icon?: ComponentType<{ className?: string }>
  }[]
  value: T
  onChange: (value: T) => void
  className?: string
  inline?: boolean
}) {
  if (inline) {
    return (
      <div
        role="tablist"
        aria-label={label}
        className={cn("mobile-filter-tabs-inline", className)}
        style={{
          gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`,
        }}
      >
        {items.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={value === item.value}
            className={cn(
              "mobile-filter-tab-pill",
              value === item.value && "is-active"
            )}
            onClick={() => onChange(item.value)}
          >
            {item.icon && <item.icon className="size-3.5 shrink-0" />}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className={cn("toolbar tabbar mobile-filter-toolbar", className)}>
      <div className="toolbar-inner">
        <div className="toolbar-pane" role="tablist" aria-label={label}>
          {items.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={value === item.value}
              className={
                value === item.value ? "tab-link tab-link-active" : "tab-link"
              }
              onClick={() => onChange(item.value)}
            >
              {item.icon && <item.icon className="size-3.5 shrink-0" />}
              <span className="tabbar-label">{item.label}</span>
            </button>
          ))}
          <span
            className="tab-link-highlight"
            aria-hidden="true"
            style={{
              width: `${100 / items.length}%`,
              transform: `translate3d(${
                Math.max(
                  0,
                  items.findIndex((item) => item.value === value)
                ) * 100
              }%,0,0)`,
            }}
          />
        </div>
      </div>
    </div>
  )
}
