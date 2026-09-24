import { type ComponentProps } from "react"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"

export function MobileHeaderMenu({
  onEditWorkout,
  actions = [],
}: {
  onEditWorkout?: () => void
  actions?: ComponentProps<typeof MobileActionMenu>["actions"]
}) {
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
    </div>
  )
}
