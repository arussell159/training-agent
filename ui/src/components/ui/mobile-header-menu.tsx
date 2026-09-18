import { useContext, useState } from "react"
import { MobileHeaderNavigation } from "@/components/ui/mobile-header-navigation"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"

export function MobileHeaderMenu({
  onEditWorkout,
}: {
  onEditWorkout?: () => void
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
        label="Page menu"
        className="size-11 p-0"
        actions={[
          ...(onEditWorkout
            ? [
                {
                  value: "edit",
                  label: "Edit Workout",
                  onSelect: onEditWorkout,
                },
              ]
            : []),
          {
            value: "terms",
            label: "Terms & definitions",
            onSelect: () => window.dispatchEvent(new Event("terms-open")),
          },
          {
            value: "refresh",
            label: busy ? "Refreshing Intervals.icu…" : "Refresh Intervals.icu",
            disabled: busy,
            onSelect: () => void runRefresh(),
          },
        ]}
      />
      <span role="status" className="sr-only">
        {busy ? "Refreshing Intervals.icu…" : ""}
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
