import { useEffect, useId, useRef, useState, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { Sheet } from "framework7-react"
import { ChevronRight, X } from "lucide-react"

export function DetailSheetRow({
  title,
  date,
  children,
  dark = false,
}: {
  title: string
  date?: string
  children: ReactNode
  dark?: boolean
}) {
  const id = `detail-${useId().replace(/[^a-z0-9]/gi, "")}`
  const [open, setOpen] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const previous = window.history.state
    window.history.pushState({ ...previous, detailSheet: id }, "")
    const back = (event: PopStateEvent) => {
      event.stopImmediatePropagation()
      setOpen(false)
    }
    window.addEventListener("popstate", back, true)
    return () => {
      window.removeEventListener("popstate", back, true)
      if (window.history.state?.detailSheet === id) window.history.back()
    }
  }, [open, id])
  return (
    <div className="detail-sheet-row">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen(true)}
        className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold ${dark ? "bg-muted" : "bg-background"}`}
      >
        {title}
        <ChevronRight className="size-[18px] text-muted-foreground" />
      </button>
      {createPortal(
        <div id={id}>
          <div
            className={["terms-metric-backdrop sheet-backdrop", open ? "backdrop-in" : ""].join(" ")}
            aria-hidden="true"
            onClick={() => setOpen(false)}
          />
          <Sheet
            containerEl={`#${id}`}
            className="terms-metric-sheet"
            opened={open}
            backdropEl={`#${id} .sheet-backdrop`}
            swipeToClose
            swipeHandler={`#${id} .detail-sheet-handle`}
            backdrop
            closeByBackdropClick
            closeOnEscape
            onSheetClose={() => setOpen(false)}
            onSheetClosed={() =>
              trigger.current?.focus({ preventScroll: true })
            }
            {...{ role: "dialog", "aria-modal": true, "aria-label": title }}
          >
            <div
              className="terms-metric-sheet-handle detail-sheet-handle"
              aria-hidden="true"
            >
              <span />
            </div>
            <div className="terms-metric-sheet-heading">
              <h2>{date || title}</h2>
              <button
                type="button"
                className="terms-metric-sheet-close"
                aria-label={`Close ${title}`}
                onClick={() => setOpen(false)}
              >
                <X />
              </button>
            </div>
            <div className="terms-metric-sheet-scroll report-reader-scroll">
              {open && children}
            </div>
          </Sheet>
        </div>,
        document.body
      )}
    </div>
  )
}
