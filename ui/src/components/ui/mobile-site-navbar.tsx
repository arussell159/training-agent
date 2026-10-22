import { type ReactNode, type ComponentProps } from "react"
import { ChevronLeft } from "lucide-react"
import { MobileHeaderMenu } from "@/components/ui/mobile-header-menu"
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { MobileActionMenu } from "@/components/ui/mobile-native-controls"
import { LiquidGlassLayer } from "@/components/ui/liquid-glass-layer"

export function MobileSiteNavbar({
  title,
  titleLabel,
  actions,
  onBack,
  backLabel = "Back",
  backText,
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
  backText?: ReactNode
  onEditWorkout?: () => void
  left?: ReactNode
  right?: ReactNode
  children?: ReactNode
  showMenu?: boolean
  className?: string
  fixed?: boolean
}) {
  const mobile = useIsMobile()
  if (!mobile) return null

  return (
    <header
      className={cn(
        "mobile-site-navbar",
        className,
        fixed && "mobile-site-navbar-fixed"
      )}
    >
      <div className="navbar">
        <div className="navbar-bg" />
        <div className="navbar-inner">
          {(onBack || left) && (
            <div className="left">
              {onBack && (
                <button
                  type="button"
                  className={cn(
                    "mobile-navbar-action liquid-glass-button",
                    backText != null && "mobile-navbar-action-with-text"
                  )}
                  aria-label={backLabel}
                  onClick={onBack}
                >
                  <LiquidGlassLayer />
                  <ChevronLeft aria-hidden="true" />
                  {backText != null && (
                    <span aria-hidden="true">{backText}</span>
                  )}
                </button>
              )}
              {left}
            </div>
          )}
          <div className="title">
            <h1 aria-label={titleLabel}>{title}</h1>
          </div>
          {(right || showMenu) && (
            <div className="right">
              {right}
              {showMenu && (
                <MobileHeaderMenu
                  actions={actions}
                  onEditWorkout={onEditWorkout}
                />
              )}
            </div>
          )}
          {children}
        </div>
      </div>
    </header>
  )
}
