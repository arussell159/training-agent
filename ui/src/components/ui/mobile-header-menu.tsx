import { useContext, useState } from "react"
import { MobileHeaderNavigation } from "@/components/ui/mobile-header-navigation"
import { Ellipsis, Pencil, RefreshCw, SquarePen } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export function MobileHeaderMenu({
  onNewChat,
  onEditWorkout,
}: {
  onNewChat?: () => void
  onEditWorkout?: () => void
}) {
  const refresh = useContext(MobileHeaderNavigation)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)
  const runRefresh = async () => {
    setBusy(true)
    setError("")
    try {
      await refresh()
      setOpen(false)
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
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              className="size-9 rounded-full bg-white/50 p-0 shadow-sm backdrop-blur-sm hover:bg-white/70"
              aria-label="Page menu"
            />
          }
        >
          <Ellipsis className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-max min-w-40">
          {onEditWorkout && (
            <DropdownMenuItem
              className="whitespace-nowrap"
              onClick={() => {
                setOpen(false)
                onEditWorkout()
              }}
            >
              <Pencil />
              Edit Workout
            </DropdownMenuItem>
          )}
          {onNewChat && (
            <>
              <DropdownMenuItem
                className="whitespace-nowrap"
                onClick={() => {
                  onNewChat()
                  setOpen(false)
                }}
              >
                <SquarePen />
                New chat
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          <DropdownMenuItem
            className="whitespace-nowrap"
            disabled={busy}
            closeOnClick={false}
            onClick={() => void runRefresh()}
          >
            <RefreshCw className={busy ? "animate-spin" : undefined} />
            {busy ? "Refreshing Intervals.icu…" : "Refresh Intervals.icu"}
          </DropdownMenuItem>
          {error && (
            <p
              role="alert"
              className="max-w-64 px-2 py-2 text-xs text-destructive"
            >
              {error}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
