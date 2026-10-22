import { Suspense, useState, type ComponentProps } from "react"
import { preloadable } from "@/lib/preloadable"
import { loadWorkoutEditor } from "@/lib/workout-read-cache"
import { canEditWorkout } from "@/lib/workout-permissions"
import type { PlannedWorkout } from "@/lib/training-context"
import { Button } from "@/components/ui/button"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ChartSkeleton } from "@/components/loading-layouts"
import { PageErrorBoundary } from "@/components/page-error-boundary"
import { retryFailedPreloadStyles } from "@/lib/asset-preload-recovery"
import { Ellipsis, Pencil } from "lucide-react"
export { useEditedWorkout } from "@/hooks/use-edited-workout"
export type { DesktopBuilderSubmission } from "./workout-editor"
const recoverEditorStyles = () =>
  retryFailedPreloadStyles(document, (url) =>
    /\/(?:workout-editor|desktop-workout-builder|desktop-strength-[\w-]+)-[\w-]+\.css$/.test(
      url
    )
  )
const editor = preloadable(
  async () => {
    // An earlier intent preload may have failed before the dialog opened.
    // Vite skips an already-attempted CSS URL on subsequent imports, so repair
    // tracked styles before allowing a successful module to render.
    await recoverEditorStyles()
    const module = await import("./workout-editor")
    return { default: module.WorkoutEditor }
  },
  (props) => (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
    >
      <DialogContent>
        <DialogTitle>Loading workout editor</DialogTitle>
        <ChartSkeleton />
      </DialogContent>
    </Dialog>
  )
)
export const preloadWorkoutEditor = editor.preload
export function prepareWorkoutEditor(workout: PlannedWorkout) {
  if (!canEditWorkout(workout) || workout.app_pending_operation) return
  void editor.preload().catch(() => {})
  void loadWorkoutEditor(
    `/api/workouts/${encodeURIComponent(workout.id)}/editor`
  ).catch(() => {})
}
export function WorkoutEditor(
  props: ComponentProps<typeof import("./workout-editor").WorkoutEditor>
) {
  const Editor = editor.Component
  const [attempt, setAttempt] = useState(0)
  return (
    <PageErrorBoundary
      resetKey={props.workout?.id || "new-editor"}
      onRetry={async () => {
        await recoverEditorStyles()
        await editor.preload()
        setAttempt((value) => value + 1)
      }}
      fallback={({
        retry,
        retrying,
        retryAvailable,
        reload,
        reloadBlocked,
      }) => (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !retrying) props.onClose()
          }}
        >
          <DialogContent showCloseButton={!retrying}>
            <DialogTitle>Workout editor couldn’t load</DialogTitle>
            <p>
              Your workout stays open underneath. Try again, or return to it
              without losing its fields.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={retry} disabled={!retryAvailable || retrying}>
                {retrying ? "Trying again…" : "Try again"}
              </Button>
              <Button
                variant="outline"
                onClick={props.onClose}
                disabled={retrying}
              >
                Return to workout
              </Button>
              <Button variant="ghost" onClick={reload} disabled={retrying}>
                Reload latest app
              </Button>
            </div>
            {reloadBlocked && (
              <p role="status">
                Keep this workout open. Your draft could not be retained safely
                for a reload.
              </p>
            )}
          </DialogContent>
        </Dialog>
      )}
    >
      <Suspense
        fallback={
          <Dialog
            open
            onOpenChange={(open) => {
              if (!open) props.onClose()
            }}
          >
            <DialogContent>
              <DialogTitle>Loading workout editor</DialogTitle>
              <ChartSkeleton />
            </DialogContent>
          </Dialog>
        }
      >
        <Editor key={attempt} {...props} />
      </Suspense>
    </PageErrorBoundary>
  )
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
