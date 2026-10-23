import { createRoot } from "react-dom/client";
import { createRef } from "react";
import { registerWorkoutNavigationGuard } from "@/lib/workout-navigation-guard";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

let confirmationOpen = false;

function actionLabel(title: string) {
  if (/^Discard.*interval/i.test(title)) return "Discard interval changes";
  if (/^Discard/i.test(title)) return "Discard changes";
  if (/^Delete.*workouts/i.test(title)) return "Delete workouts";
  // Existing callers supply an action title (Delete note, Clear pending paste,
  // Delete interval, etc.). Keep that concrete wording on the action itself.
  return title.replace(/[?!.]+$/, "").trim() || "Continue";
}

/** Shared imperative confirmation for mouse, keyboard and touch. */
export function confirmOnDesktop(title: string, message: string) {
  // Repeated requests must not share a positive answer with a second mutation.
  if (confirmationOpen) return Promise.resolve(false);
  confirmationOpen = true;
  return new Promise<boolean>((resolve) => {
    const container = document.createElement("div");
    container.dataset.appConfirmation = "true";
    document.body.append(container);
    const root = createRoot(container);
    const cancelRef = createRef<HTMLButtonElement>();
    const previousFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    let finished = false;
    let releaseNavigation = () => {};
    const onTraversal = () => finish(false);
    const finish = (confirmed: boolean) => {
      if (finished) return;
      finished = true;
      // Keep the navigation guard until this event dispatch is finished. A Back
      // traversal must cancel the confirmation and preserve its underlying view.
      window.setTimeout(() => {
        window.removeEventListener("workout-navigation-traversal", onTraversal);
        releaseNavigation();
        root.unmount();
        container.remove();
        if (previousFocus?.isConnected && !previousFocus.closest("[inert]"))
          previousFocus.focus({ preventScroll: true });
        confirmationOpen = false;
        resolve(confirmed);
      }, 0);
    };
    releaseNavigation = registerWorkoutNavigationGuard(
      async () => {
        finish(false);
        return false;
      },
      undefined,
      10_000
    );
    // This also covers a second Back while the navigation guard that opened
    // this confirmation is already waiting for its answer.
    window.addEventListener("workout-navigation-traversal", onTraversal);
    root.render(
      <AlertDialog
        open
        onOpenChange={(open) => {
          if (!open) finish(false);
        }}
      >
        <AlertDialogContent
          initialFocus={cancelRef}
          finalFocus={() => (previousFocus?.isConnected ? previousFocus : false)}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              ref={cancelRef}
              data-confirm-cancel
              variant="outline"
              onClick={() => finish(false)}
            >
              Cancel
            </Button>
            <Button
              variant={/^(Delete|Discard|Clear)/i.test(title) ? "destructive" : "default"}
              onClick={() => finish(true)}
            >
              {actionLabel(title)}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  });
}
