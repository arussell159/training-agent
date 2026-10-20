import { Suspense, useState, type ComponentProps } from "react"
import { preloadable } from "@/lib/preloadable"
import { loadWorkoutEditor } from "@/lib/workout-read-cache"
import { canEditWorkout } from "@/lib/workout-permissions"
import type { PlannedWorkout } from "@/lib/training-context"
import { Button } from "@/components/ui/button"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ChartSkeleton } from "@/components/loading-layouts"
import { Ellipsis, Pencil } from "lucide-react"
export { useEditedWorkout } from "@/hooks/use-edited-workout"
export type { DesktopBuilderSubmission } from "./workout-editor"
const editor = preloadable(() => import("./workout-editor").then(module => ({ default: module.WorkoutEditor })), props => <Dialog open onOpenChange={open => { if (!open) props.onClose() }}><DialogContent><DialogTitle>Loading workout editor</DialogTitle><ChartSkeleton /></DialogContent></Dialog>)
export const preloadWorkoutEditor = editor.preload
export function prepareWorkoutEditor(workout: PlannedWorkout) {
  if (!canEditWorkout(workout) || workout.app_pending_operation) return
  void editor.preload().catch(() => {})
  void loadWorkoutEditor(`/api/workouts/${encodeURIComponent(workout.id)}/editor`).catch(() => {})
}
export function WorkoutEditor(props: ComponentProps<typeof import("./workout-editor").WorkoutEditor>) {
  const Editor = editor.Component
  return <Suspense fallback={<Dialog open onOpenChange={open => { if (!open) props.onClose() }}><DialogContent><DialogTitle>Loading workout editor</DialogTitle><ChartSkeleton /></DialogContent></Dialog>}><Editor {...props}/></Suspense>
}

export function WorkoutEditorMenu({
  workout,
  className = "",
  onSaved,
}: {
  workout: PlannedWorkout
  className?: string
  onSaved?: (w: PlannedWorkout) => void
}) {
  const [open, setOpen] = useState(false)
  const editable = canEditWorkout(workout)
  if (!editable) return null
  return (
    <>
      <MobileActionMenu
        label="Workout options"
        className={className}
        actions={[
          {
            value: "edit",
            label: editable
              ? "Edit Workout"
              : "Completed activity is read-only",
            disabled: !editable,
            onSelect: () => setOpen(true),
          },
        ]}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                className={className}
                aria-label="Workout options"
              />
            }
          >
            <Ellipsis size={18} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              disabled={!editable}
              onClick={() => setOpen(true)}
            >
              <Pencil size={16} />
              Edit Workout
            </DropdownMenuItem>
            {!editable && (
              <p className="max-w-56 p-2 text-xs text-muted-foreground">
                Completed activity data is read-only. Open its planned calendar
                workout to edit the prescription.
              </p>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </MobileActionMenu>
      {open && (
        <WorkoutEditor
          workout={workout}
          onClose={() => setOpen(false)}
          onSaved={onSaved}
        />
      )}
    </>
  )
}
