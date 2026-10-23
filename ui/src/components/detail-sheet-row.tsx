import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useSheetDismiss } from "@/hooks/use-sheet-dismiss"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ChevronRight, X } from "lucide-react"
import "./detail-sheet-row.css"

export function DetailSheetRow({
  title,
  date,
  children,
  dark = false,
  fullHeight = false,
}: {
  title: string
  date?: string
  children: ReactNode
  dark?: boolean
  fullHeight?: boolean
}) {
  const id = `detail-${useId().replace(/[^a-z0-9]/gi, "")}`
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const [sheetElement, setSheetElement] = useState<HTMLDivElement | null>(null)
  const closing = useRef(false)
  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    setExpanded(false)
    setOpen(false)
    if (window.history.state?.detailSheet === id) window.history.back()
  }, [id])
  const expand = useCallback(() => setExpanded(true), [])
  useSheetDismiss(id, open && Boolean(sheetElement), close, {
    expanded,
    onExpand: fullHeight ? expand : undefined,
  })
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
      if (window.history.state?.detailSheet === id)
        window.history.replaceState(previous, "")
    }
  }, [open, id])
  return (
    <div className="detail-sheet-row">
      <button
        ref={trigger}
        type="button"
        onClick={() => {
          closing.current = false
          setExpanded(false)
          setOpen(true)
        }}
        className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold ${dark ? "bg-muted" : "bg-background"}`}
      >
        {title}
        <ChevronRight className="size-[18px] text-muted-foreground" />
      </button>
      <Dialog open={open} onOpenChange={(value) => { if (!value) close() }}>
          <DialogContent
            ref={setSheetElement}
            id={id}
            fullscreen
            data-app-dialog-layout="sheet"
            className={`terms-metric-sheet sheet-modal detail-row-sheet ${fullHeight ? `detail-sheet-expandable ${expanded ? "detail-sheet-expanded" : ""}` : ""}`}
            overlayClassName="detail-row-sheet-backdrop"
            showCloseButton={false}
            initialFocus={closeButton}
            finalFocus={trigger}
            aria-label={title}
          >
            <div
              className="terms-metric-sheet-handle detail-sheet-handle"
              aria-hidden="true"
            >
              <span />
            </div>
            <div className="terms-metric-sheet-heading">
              <DialogTitle render={<h2 />}>
                <span className={date ? "sr-only" : undefined}>{title}</span>
                {date && <span aria-hidden="true">{date}</span>}
              </DialogTitle>
              <div className="flex items-center">
                <button
                  ref={closeButton}
                  type="button"
                  className="terms-metric-sheet-close"
                  aria-label={`Close ${title}`}
                  onClick={close}
                >
                  <X />
                </button>
              </div>
            </div>
            <div
              className="terms-metric-sheet-scroll report-reader-scroll"
              data-sheet-scroll
            >
              {open && children}
            </div>
          </DialogContent>
      </Dialog>
    </div>
  )
}
