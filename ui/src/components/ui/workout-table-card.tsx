import type { ReactNode } from "react"
import { Card, CardHeader } from "framework7-react"
import { useIsMobile } from "@/hooks/use-mobile"

export function WorkoutTableCard({
  children,
  title,
  subtitle,
}: {
  children: ReactNode
  title?: string
  subtitle?: string
}) {
  const mobile = useIsMobile()
  if (!mobile) return children
  return (
    <Card className="workout-data-card">
      {title && (
        <CardHeader>
          <div>
            <h2 className="font-semibold">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
            )}
          </div>
        </CardHeader>
      )}
      {children}
    </Card>
  )
}
