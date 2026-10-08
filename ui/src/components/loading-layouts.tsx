import type { ReactNode } from "react"
import { Toolbar, ToolbarPane } from "framework7-react"
import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { appRouteItem } from "@/lib/app-route"
import { restoreReportReader } from "@/lib/report-navigation"

/** Keep placeholders in the same flow as the content they replace. */
export function LoadingRegion({
  children,
  className,
  label = "Loading content",
}: {
  children: ReactNode
  className?: string
  label?: string
}) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className={className}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">{children}</div>
    </div>
  )
}

function Lines({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      {Array.from({ length: count }, (_, i) => (
        <Skeleton
          key={i}
          className={cn("h-3", i === count - 1 ? "w-3/5" : "w-full")}
        />
      ))}
    </div>
  )
}

export function ChartSkeleton({ className }: { className?: string }) {
  return (
    <LoadingRegion label="Loading chart" className={className}>
      <div className="space-y-5 p-4 md:p-6">
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-56 max-w-full" />
        <div className="flex h-52 items-end gap-3 border-b pb-2">
          {[42, 65, 53, 82, 58, 72, 92].map((h, i) => (
            <Skeleton
              key={i}
              className="min-w-0 flex-1 rounded-t-md rounded-b-none"
              style={{ height: `${h}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-3 w-9" />
          ))}
        </div>
      </div>
    </LoadingRegion>
  )
}

export function FitnessHistorySkeleton() {
  return (
    <LoadingRegion label="Loading fitness history">
      <Card className="fitness-history-card dashboard-fitness-history-card m-0 h-[390px] min-w-0 shrink-0 px-4 md:h-[448px]">
        <Skeleton className="h-5 w-32" />
        <div className="flex gap-2">
          {[0, 1, 2].map((index) => <Skeleton key={index} className="h-7 w-16" />)}
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-hidden">
          {Array.from({ length: 16 }, (_, index) => <Skeleton key={index} className="h-3 w-full" />)}
        </div>
      </Card>
    </LoadingRegion>
  )
}

export function ListSkeleton({
  rows = 5,
  food = false,
}: {
  rows?: number
  food?: boolean
}) {
  return (
    <LoadingRegion label={food ? "Searching foods" : "Loading list"}>
      <div
        className={
          food
            ? "nutrition-result-list"
            : "overflow-hidden rounded-2xl border bg-card"
        }
      >
        {Array.from({ length: rows }, (_, i) => (
          <div
            key={i}
            className={
              food
                ? "nutrition-result"
                : "flex items-center gap-3 border-b p-4 last:border-b-0"
            }
          >
            <Skeleton
              className={cn(
                "shrink-0",
                food ? "size-12 rounded-xl" : "size-8 rounded-lg"
              )}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              {food && <Skeleton className="h-3 w-2/3" />}
            </div>
            <Skeleton
              className={food ? "size-8 rounded-full" : "size-4 rounded-full"}
            />
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}

export function WorkoutGridSkeleton() {
  return (
    <LoadingRegion label="Loading saved workouts">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Card key={i} className="gap-3 rounded-lg px-2.5 py-3">
            <Skeleton className="size-5" />
            <Skeleton className="h-5 w-3/4" />
            <Lines count={2} />
            <Skeleton className="h-14 w-full" />
            <div className="flex gap-3">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-3 w-16" />
            </div>
          </Card>
        ))}
      </div>
    </LoadingRegion>
  )
}

export function TableSkeleton({
  rows = 8,
  columns = 5,
}: {
  rows?: number
  columns?: number
}) {
  return (
    <LoadingRegion
      label="Loading table"
      className="w-full overflow-hidden rounded-xl border bg-card"
    >
      <div className="divide-y">
        {Array.from({ length: rows + 1 }, (_, row) => (
          <div
            key={row}
            className={cn("grid gap-4 px-4", row ? "py-4" : "bg-muted/30 py-3")}
            style={{
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: columns }, (_, col) => (
              <Skeleton
                key={col}
                className={cn("h-4", col ? "w-2/3" : "w-full")}
              />
            ))}
          </div>
        ))}
      </div>
    </LoadingRegion>
  )
}

export function NutritionDashboardSkeleton() {
  return (
    <LoadingRegion label="Loading nutrition" className="space-y-5">
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1.15fr_1fr]">
          <Card className="min-h-[368px] gap-5 p-5">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="space-y-[7px]">
                <div className="flex gap-2">
                  <Skeleton className="h-[21.428571px] w-20" />
                  <Skeleton className="h-3 w-24 self-center" />
                </div>
                <div className="flex items-center gap-4">
                  <Skeleton className="h-2 flex-1 rounded-full" />
                  <Skeleton className="h-5 w-24" />
                </div>
              </div>
            ))}
          </Card>
          <Card className="min-h-[383px] gap-4 p-5">
            <div className="space-y-1">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-4 w-24" />
            </div>
            <div className="flex h-40 items-end justify-between gap-4">
              {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="flex h-full flex-1 flex-col items-center justify-end gap-2"
                >
                  <Skeleton className="h-3 w-5" />
                  <Skeleton className="h-28 w-full max-w-6 rounded-full" />
                  <Skeleton className="h-3 w-5" />
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t pt-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-5 w-14" />
                  <Skeleton className="h-3 w-28 max-w-full" />
                </div>
              ))}
            </div>
          </Card>
        </div>
        <div className="grid gap-3 lg:grid-cols-2 lg:gap-5">
          <Skeleton className="h-7 w-28 lg:col-span-2" />
          {[0, 1, 2, 3].map((i) => (
            <Card key={i} className="gap-4 p-4">
              <div className="flex justify-between">
                <Skeleton className="h-7 w-24" />
                <Skeleton className="size-8 rounded-full" />
              </div>
              <div className="grid w-48 grid-cols-2 gap-2">
                <Skeleton className="h-3" />
                <Skeleton className="h-3" />
                <Skeleton className="h-3" />
                <Skeleton className="h-3" />
              </div>
              <Skeleton className="h-12 w-full" />
            </Card>
          ))}
        </div>
      </div>
    </LoadingRegion>
  )
}

export function HomeCardsSkeleton() {
  return (
    <LoadingRegion label="Loading dashboard">
      <div className="dashboard-card-grid grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-16">
        <Card className="dashboard-session-card col-span-2 justify-between p-4 lg:col-span-8 lg:row-span-2 lg:col-start-1 lg:row-start-1">
          <div className="space-y-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-3/4" />
          </div>
          <Skeleton className="h-20 w-full" />
          <div className="grid grid-cols-3 gap-4 border-t pt-4">
            {[0, 1, 2].map((i) => (
              <Lines key={i} count={2} />
            ))}
          </div>
        </Card>
        <Card className="dashboard-events-card col-span-2 justify-between p-4 lg:col-span-4 lg:col-start-9 lg:row-start-1">
          <div className="flex justify-between">
            <Skeleton className="size-14" />
            <Skeleton className="h-12 w-16" />
          </div>
          <Lines count={2} />
        </Card>
        {[0, 1].map((i) => (
          <Card
            key={i}
            className={cn(
              "dashboard-recovery-card justify-between p-4 lg:col-span-2 lg:row-start-1",
              i === 0 ? "lg:col-start-13" : "lg:col-start-15"
            )}
          >
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-14 w-full" />
            <div className="flex gap-3">
              <Skeleton className="h-3 flex-1" />
              <Skeleton className="h-3 flex-1" />
            </div>
          </Card>
        ))}
        <Card className="dashboard-nutrition-card col-span-2 justify-between p-4 lg:col-span-4 lg:col-start-13 lg:row-start-2">
          <Skeleton className="h-5 w-28" />
          <div className="flex justify-between">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[0, 1, 2].map((i) => (
              <Lines key={i} count={3} />
            ))}
          </div>
        </Card>
        <div className="col-span-2 grid grid-cols-2 gap-3 sm:gap-4 lg:col-span-4 lg:col-start-9 lg:row-start-2">
          {[0, 1].map((i) => (
            <Card
              key={i}
              className={cn(
                i ? "dashboard-fitness-card" : "dashboard-sleep-card",
                "justify-between p-4"
              )}
            >
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-8 w-20" />
              <Lines count={2} />
            </Card>
          ))}
        </div>
      </div>
    </LoadingRegion>
  )
}

function HeaderSkeleton({ filters = false }: { filters?: boolean }) {
  return (
    <div className="shrink-0 md:hidden" aria-hidden="true">
      <div className="flex h-14 items-center justify-between px-4">
        <Skeleton className="size-[43px] rounded-full" />
        <Skeleton className="h-5 w-28" />
        <Skeleton className="size-[43px] rounded-full" />
      </div>
      {filters && (
        <div className="px-4 pb-4">
          <Skeleton className="h-10 w-full rounded-full" />
        </div>
      )}
    </div>
  )
}

export function CalendarSkeleton() {
  return (
    <div className="w-full">
      <HeaderSkeleton />
      <LoadingRegion label="Loading calendar">
        <div className="hidden h-14 items-center justify-between px-4 md:flex">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-9 w-24" />
        </div>
        <div className="hidden grid-cols-7 border-y px-2 py-3 md:grid">
          {Array.from({ length: 7 }, (_, i) => (
            <Skeleton key={i} className="mx-auto h-3 w-6" />
          ))}
        </div>
        <div className="space-y-8 px-4 md:hidden">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-4">
              <div className="border-b py-3">
                <Skeleton className="h-5 w-44" />
              </div>
              <div className="flex gap-3">
                <Skeleton className="size-8 shrink-0 rounded-full" />
                <div className="flex-1 space-y-3">
                  <Skeleton className="h-5 w-2/3" />
                  <Lines count={2} />
                  <Skeleton className="h-14 w-full" />
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden grid-cols-7 md:grid">
          {Array.from({ length: 21 }, (_, i) => (
            <div key={i} className="h-40 space-y-3 border-r border-b p-3">
              <Skeleton className="h-4 w-6" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))}
        </div>
      </LoadingRegion>
    </div>
  )
}

export function AnnualPlanSkeleton() {
  return (
    <div className="w-full overflow-hidden">
      <HeaderSkeleton />
      <div className="hidden md:block">
        <ChartSkeleton />
      </div>
      <div className="space-y-6 p-4 md:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-5 w-24" />
            <ListSkeleton rows={3} />
          </div>
        ))}
      </div>
      <div className="hidden md:block">
        <TableSkeleton rows={10} columns={6} />
      </div>
    </div>
  )
}

export function ArticleSkeleton() {
  return (
    <LoadingRegion
      label="Loading report"
      className="mx-auto w-full max-w-4xl space-y-6 p-4 md:p-8"
    >
      <div className="space-y-6">
        <Skeleton className="h-8 w-3/4" />
        <Lines count={4} />
        <ChartSkeleton />
        <Lines count={6} />
      </div>
    </LoadingRegion>
  )
}

export function PageSkeleton({ page }: { page: string }) {
  if (page === "Home")
    return (
      <div className="mobile-dashboard flex w-full min-w-0 flex-1 flex-col gap-3 p-4 sm:gap-4 md:gap-6 md:p-6">
        <HomeCardsSkeleton />
        <div className="dashboard-history-grid grid w-full min-w-0 grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
          <ChartSkeleton className="dashboard-history-card training-history-card rounded-2xl border bg-card" />
          <FitnessHistorySkeleton />
        </div>
      </div>
    )
  if (page === "Nutrition")
    return (
      <div className="nutrition-dashboard w-full">
        <HeaderSkeleton />
        <div className="mobile-dashboard mx-auto w-full max-w-7xl px-4 pt-4 pb-8 md:px-8 lg:pt-6">
          <NutritionDashboardSkeleton />
        </div>
      </div>
    )
  if (page === "Calendar") return <CalendarSkeleton />
  if (page === "Annual Plan") return <AnnualPlanSkeleton />
  if (page === "Settings")
    return (
      <div className="w-full">
        <HeaderSkeleton />
        <div className="mx-auto max-w-4xl space-y-8 px-4 py-5 md:px-8 md:py-14">
          {[3, 4, 3].map((rows, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-5 w-28" />
              <ListSkeleton rows={rows} />
            </div>
          ))}
        </div>
      </div>
    )
  if (page === "Report")
    return (
      <div className="w-full">
        <HeaderSkeleton />
        <ArticleSkeleton />
      </div>
    )
  if (page === "Workout")
    return (
      <div className="w-full">
        <HeaderSkeleton />
        <Skeleton className="h-[300px] w-full rounded-none" />
        <div className="space-y-6 p-4">
          <Skeleton className="h-8 w-2/3" />
          <TableSkeleton rows={3} columns={2} />
          <ChartSkeleton />
        </div>
      </div>
    )
  return (
    <div className="w-full">
      <HeaderSkeleton filters={page === "Coach" || page === "Library"} />
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-5 md:px-8 md:py-14">
        <div className="hidden space-y-4 md:block">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-[72px] w-full rounded-xl" />
        </div>
        {page === "Library" ? (
          <>
            <div className="md:hidden">
              <ListSkeleton rows={7} />
            </div>
            <div className="hidden md:block">
              <WorkoutGridSkeleton />
            </div>
          </>
        ) : page === "Workout Reports" ? (
          <TableSkeleton />
        ) : (
          <ListSkeleton rows={7} />
        )}
      </div>
    </div>
  )
}

/** No private data is rendered until authentication finishes. */
export function AppStartupSkeleton() {
  const page = new URLSearchParams(location.search).get("workout")
    ? "Workout"
    : restoreReportReader()
      ? "Report"
      : appRouteItem()
  return (
    <div className="flex min-h-svh bg-background text-foreground">
      <aside
        className="hidden w-[72px] shrink-0 space-y-7 border-r p-4 md:block"
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Skeleton key={i} className="size-10 rounded-xl" />
        ))}
      </aside>
      <main
        className={cn(
          "min-w-0 flex-1 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0",
          (page === "Home" || page === "Nutrition") && "home-dashboard-shell"
        )}
      >
        <div className="hidden h-14 items-center border-b px-4 md:flex">
          <Skeleton className="h-5 w-32" />
        </div>
        {page === "Home" && <HeaderSkeleton />}
        <PageSkeleton page={page} />
      </main>
      <div aria-hidden="true" inert className="md:hidden">
        <Toolbar bottom tabbar icons className="mobile-navbar">
          <ToolbarPane>
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="tab-link">
                <Skeleton className="size-6 rounded-md" />
                <Skeleton className="mt-1 h-2 w-8" />
              </span>
            ))}
          </ToolbarPane>
        </Toolbar>
      </div>
    </div>
  )
}
