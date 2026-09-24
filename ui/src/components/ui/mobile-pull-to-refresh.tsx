import { useContext, useEffect, useRef, useState, type ReactNode, type Ref } from "react"
import { f7, f7ready } from "framework7-react"
import { MobileHeaderNavigation } from "@/components/ui/mobile-header-navigation"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"

export function MobilePullToRefresh({
  children,
  className,
  enabled = true,
  disableWhenWindowScrolled = false,
  ref: forwardedRef,
  "aria-label": ariaLabel,
}: {
  children: ReactNode
  className?: string
  enabled?: boolean
  disableWhenWindowScrolled?: boolean
  ref?: Ref<HTMLElement>
  "aria-label"?: string
}) {
  const refresh = useContext(MobileHeaderNavigation)
  const mobile = useIsMobile()
  const [error, setError] = useState("")
  const element = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let destroyed = false
    let ptr: { destroy: () => void } | undefined
    const target = element.current
    if (!target) return
    if (!enabled || !mobile) return
    if (typeof forwardedRef === "function") forwardedRef(target)
    else if (forwardedRef) forwardedRef.current = target
    const onRefresh = (event: Event) => {
      const done = (event as CustomEvent<() => void>).detail
      setError("")
      void refresh()
        .catch((failure: unknown) => {
          setError(failure instanceof Error ? failure.message : "Training refresh failed.")
        })
        .finally(() => done?.())
    }
    target.addEventListener("ptr:refresh", onRefresh)
    const syncWindowScroll = () => {
      target.classList.toggle(
        "ptr-ignore",
        disableWhenWindowScrolled && window.scrollY > 0
      )
    }
    syncWindowScroll()
    if (disableWhenWindowScrolled)
      window.addEventListener("scroll", syncWindowScroll, { passive: true })
    void f7ready(() => {
      if (destroyed || !f7.ptr) return
      ptr = f7.ptr.create(target)
    })
    return () => {
      destroyed = true
      target.removeEventListener("ptr:refresh", onRefresh)
      window.removeEventListener("scroll", syncWindowScroll)
      ptr?.destroy()
      if (typeof forwardedRef === "function") forwardedRef(null)
      else if (forwardedRef) forwardedRef.current = null
    }
  }, [refresh, enabled, forwardedRef, mobile, disableWhenWindowScrolled])

  if (!enabled) return <>{children}</>

  return (
    <div ref={element} aria-label={ariaLabel} className={cn("mobile-ptr-content ptr-content", className)}>
      <div className="ptr-preloader" aria-hidden="true">
        <div className="preloader"><span className="preloader-inner"><span className="preloader-inner-circle" /></span></div>
        <div className="ptr-arrow" />
      </div>
      {error && <p role="alert" className="mobile-ptr-error">{error}</p>}
      {children}
    </div>
  )
}
