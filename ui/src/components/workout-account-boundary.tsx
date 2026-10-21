import type { ReactNode } from "react"
import { useWorkoutAccountBoundary } from "../hooks/use-workout-account-boundary"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "./ui/dialog"
import { Button } from "./ui/button"

/** Keep the same boundary mounted across Summary, Details, Analyze and editing. */
export function WorkoutAccountBoundary({
  children,
  onClose,
}: {
  children: (isCurrent: () => boolean) => ReactNode
  onClose: () => void
}) {
  const account = useWorkoutAccountBoundary(true)
  if (account.trusted) return children(account.isCurrent)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogTitle>Reopen workout</DialogTitle>
        <DialogDescription>
          The connected account changed. Close this workout and reopen it from
          your current calendar.
        </DialogDescription>
        <Button onClick={onClose}>Close workout</Button>
      </DialogContent>
    </Dialog>
  )
}
