import { useContext, useState, type ComponentProps } from "react"
import { MobileHeaderNavigation } from "@/components/ui/mobile-header-navigation"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"

export function MobileHeaderMenu({
  onEditWorkout,
  actions = [],
}: {
  onEditWorkout?: () => void
  actions?: ComponentProps<typeof MobileActionMenu>["actions"]
}) {
  const refresh = useContext(MobileHeaderNavigation)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const runRefresh = async () => {
    setBusy(true)
    setError("")
    try {
      await refresh()
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Intervals.icu refresh failed."
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="ml-auto shrink-0 md:hidden">
      <MobileActionMenu
        label="Options"
        className="size-11 p-0"
        actions={[
          {
            value: "terms",
            label: "Definitions",
            onSelect: () => window.dispatchEvent(new Event("terms-open")),
          },
          {
            value: "refresh",
            label: busy ? "Refreshing…" : "Refresh",
            disabled: busy,
            onSelect: () => void runRefresh(),
          },
          ...(onEditWorkout
            ? [
                {
                  value: "edit",
                  label: "Edit workout",
                  onSelect: onEditWorkout,
                },
              ]
            : []),
          ...actions.filter(
            (action) =>
              !["terms", "definitions", "refresh"].includes(action.value)
          ),
        ]}
      />
      <span role="status" className="sr-only">
        {busy ? "Refreshing…" : ""}
      </span>
      {error && (
        <p
          role="alert"
          className="absolute top-full right-4 z-50 max-w-64 rounded-lg border bg-background p-3 text-xs text-destructive shadow-sm"
        >
          {error}
        </p>
      )}
    </div>
  )
}
