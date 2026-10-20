import { ChevronRight } from "lucide-react"

export function MobileHomeHeading({
  title,
  action,
  item,
}: {
  title: string
  action?: string
  item?: string
}) {
  return (
    <div className="home-section-heading">
      <h2>{title}</h2>
      {action && item && (
        <button
          type="button"
          onClick={() =>
            window.dispatchEvent(
              new CustomEvent("app-navigate", { detail: { item } })
            )
          }
        >
          {action}
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}
