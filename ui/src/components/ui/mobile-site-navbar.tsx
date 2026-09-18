import { useEffect, useRef, type ReactNode, type ComponentProps } from "react"
import { f7, Navbar, NavLeft, NavRight, NavTitle } from "framework7-react"
import { ChevronLeft } from "lucide-react"
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"

export function MobileSiteNavbar({
  title,
  titleLabel,
  actions,
  onBack,
  backLabel = "Back",
  onEditWorkout,
  left,
  right,
  children,
  showMenu = true,
  className,
  fixed = false,
}: {
  title: ReactNode
  titleLabel?: string
  actions?: ComponentProps<typeof MobileActionMenu>["actions"]
  onBack?: () => void
  backLabel?: string
  onEditWorkout?: () => void
  left?: ReactNode
  right?: ReactNode
  children?: ReactNode
  showMenu?: boolean
  className?: string
  fixed?: boolean
}) {
  const mobile = useIsMobile()
  const header = useRef<HTMLElement>(null)
  useEffect(() => {
    const navbar = header.current?.querySelector<HTMLElement>(".navbar")
    if (!mobile || !navbar) return
    // Re-center after fonts, page content or viewport changes alter available width.
    const observer = new ResizeObserver(() => f7?.navbar.size(navbar))
    observer.observe(navbar)
    navbar
      .querySelectorAll(".title, .left, .right")
      .forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [mobile])
  if (!mobile) return null

  return (
    <header
      ref={header}
      className={cn(
        "mobile-site-navbar",
        className,
        fixed && "mobile-site-navbar-fixed"
      )}
    >
      <Navbar>
        {(onBack || left) && (
          <NavLeft>
            {onBack && (
              <button
                type="button"
                className="mobile-navbar-action"
                aria-label={backLabel}
                onClick={onBack}
              >
                <ChevronLeft aria-hidden="true" />
              </button>
            )}
            {left}
          </NavLeft>
        )}
        <NavTitle>
          <h1 aria-label={titleLabel}>{title}</h1>
        </NavTitle>
        <NavRight>
          {right}
          {showMenu &&
            (actions ? (
              <MobileActionMenu
                label="Page menu"
                actions={actions}
                className="size-11 p-0"
              />
            ) : (
              <MobileHeaderMenu onEditWorkout={onEditWorkout} />
            ))}
        </NavRight>
        {children}
      </Navbar>
    </header>
  )
}
