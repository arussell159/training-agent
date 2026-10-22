import { useEffect } from "react"
import { createRoot } from "react-dom/client"
import { AppToastProvider, useToastManager } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { InteractionFeedback } from "@/components/interaction-feedback"
import { WorkoutSyncFeedback } from "@/components/workout-sync-feedback"
import "@/index.css"

const probe = { renders: 0, subscriptions: 0, cleanups: 0 }
Object.assign(window, { interactionProbe: probe })
function Consumer() {
  probe.renders++
  const toast = useToastManager()
  useEffect(() => {
    probe.subscriptions++
    return () => {
      probe.cleanups++
    }
  }, [toast])
  return (
    <main className="app-surface-enter p-5">
      <Button
        onClick={() =>
          toast.add({
            id: "test-feedback",
            title: "Immediate confirmation",
            type: "success",
            timeout: 0,
          })
        }
      >
        Show notice
      </Button>
    </main>
  )
}
createRoot(document.getElementById("root")!).render(
  <AppToastProvider>
    <InteractionFeedback />
    <WorkoutSyncFeedback />
    <Consumer />
  </AppToastProvider>
)
