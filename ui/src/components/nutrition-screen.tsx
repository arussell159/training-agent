import { useEffect, useRef, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft } from "lucide-react"
import { LiquidGlassLayer } from "@/components/ui/liquid-glass-layer"
import { randomId } from "@/lib/random-id"
import { MobileSiteNavbar } from "@/components/ui/mobile-site-navbar"

export const nutritionSaveClass =
  "h-12 w-full rounded-full bg-zinc-950 text-sm text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-950 dark:hover:bg-zinc-200"

export function NutritionScreen({
  title,
  onBack,
  onExit,
  right,
  children,
}: {
  title: string
  onBack: () => void
  onExit?: () => void
  right?: ReactNode
  children: ReactNode
}) {
  const exit = useRef(onExit || onBack),
    back = useRef(onBack),
    mounted = useRef(false),
    markerRef = useRef(randomId()),
    screen = useRef<HTMLElement>(null)
  exit.current = onExit || onBack
  back.current = onBack
  useEffect(() => {
    mounted.current = true
    const root = document.getElementById("root"),
      wasInert = root?.inert
    const overflow = document.body.style.overflow
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    const marker = markerRef.current,
      url = new URL(location.href)
    url.searchParams.set("nutritionView", "food")
    if (history.state?.nutritionScreen !== marker)
      history.pushState({ ...history.state, nutritionScreen: marker }, "", url)
    if (root) root.inert = true
    document.body.classList.add("nutrition-flow-open")
    document.body.style.overflow = "hidden"
    const overlay = screen.current
    let frame = 0
    const positionToast = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const controls = overlay?.querySelector(".nutrition-search-controls")
        const header = overlay?.querySelector(".nutrition-flow-navbar")
        const bottom = (controls || header)?.getBoundingClientRect().bottom
        if (bottom != null) document.body.style.setProperty("--app-toast-reserved-top", `${Math.ceil(bottom + 8)}px`)
        else document.body.style.removeProperty("--app-toast-reserved-top")
      })
    }
    const resize = new ResizeObserver(positionToast)
    if (overlay) resize.observe(overlay)
    const changes = new MutationObserver(positionToast)
    if (overlay) changes.observe(overlay, {childList: true, subtree: true})
    window.addEventListener("resize", positionToast)
    window.visualViewport?.addEventListener("resize", positionToast)
    overlay?.addEventListener("scroll", positionToast, true)
    positionToast()
    if (!screen.current?.contains(document.activeElement))
      screen.current?.focus()
    const pop = () => {
      if (history.state?.nutritionScreen !== marker) exit.current()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        back.current()
      }
    }
    window.addEventListener("popstate", pop)
    window.addEventListener("keydown", key)
    return () => {
      mounted.current = false
      window.removeEventListener("popstate", pop)
      window.removeEventListener("keydown", key)
      document.body.style.overflow = overflow
      document.body.classList.remove("nutrition-flow-open")
      cancelAnimationFrame(frame)
      resize.disconnect()
      changes.disconnect()
      window.removeEventListener("resize", positionToast)
      window.visualViewport?.removeEventListener("resize", positionToast)
      overlay?.removeEventListener("scroll", positionToast, true)
      document.body.style.removeProperty("--app-toast-reserved-top")
      if (root) root.inert = wasInert || false
      queueMicrotask(() => {
        if (!mounted.current && history.state?.nutritionScreen === marker)
          history.back()
      })
      focused?.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <section
      ref={screen}
      tabIndex={-1}
      aria-label={title}
      className="framework7-root nutrition-surface nutrition-screen app-surface-enter"
    >
      <MobileSiteNavbar
        title={title}
        titleLabel={title}
        onBack={onBack}
        showMenu={false}
        right={right}
        className="nutrition-flow-navbar"
      />
      <header className="nutrition-screen-header hidden md:grid">
        <button
          className="mobile-navbar-action liquid-glass-button"
          aria-label="Back"
          onClick={onBack}
        >
          <LiquidGlassLayer />
          <ChevronLeft className="size-5" />
        </button>
        <h1 className="truncate text-base font-semibold">{title}</h1>
        <div className="flex justify-end">{right}</div>
      </header>
      <div className="nutrition-screen-scroll">
        <div className="mx-auto w-full max-w-3xl px-4 pt-2 pb-8 md:px-8">
          {children}
        </div>
      </div>
    </section>,
    document.body
  )
}
