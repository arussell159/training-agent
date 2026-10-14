import { createRoot } from "react-dom/client"
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"

export function confirmOnDesktop(title: string, message: string) {
  return new Promise<boolean>((resolve) => {
    const container = document.createElement("div")
    document.body.append(container)
    const root = createRoot(container)
    let finished = false
    const finish = (confirmed: boolean) => {
      if (finished) return
      finished = true
      // Unmount after the dialog's event handler has finished.
      window.setTimeout(() => {
        root.unmount()
        container.remove()
        resolve(confirmed)
      }, 0)
    }
    root.render(
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) finish(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button variant="outline" autoFocus onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button
              variant={/^Delete/i.test(title) ? "destructive" : "default"}
              onClick={() => finish(true)}
            >
              {/^Delete/i.test(title) ? "Delete" : "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  })
}
