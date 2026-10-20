import { LoadingRegion } from "./loading-layouts"
import { Skeleton } from "./ui/skeleton"

function SignalPlaceholder({ height = 160 }: { height?: number }) {
  return (
    <div className="overflow-hidden rounded border p-3" style={{ height }}>
      <div className="mb-4 flex items-center justify-between">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-12" />
      </div>
      <div className="flex h-[calc(100%-36px)] gap-5">
        <div className="flex w-16 shrink-0 flex-col justify-between py-1">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-2 w-14" />
          ))}
        </div>
        <Skeleton className="h-full min-w-0 flex-1 rounded" />
      </div>
    </div>
  )
}

export function Analysis360ChartsSkeleton() {
  return (
    <LoadingRegion
      label="Loading Analyze 360 charts"
      className="min-h-0 flex-1 overflow-hidden p-4"
    >
      <div className="space-y-4">
        <SignalPlaceholder />
        <SignalPlaceholder />
        <SignalPlaceholder height={480} />
      </div>
    </LoadingRegion>
  )
}

export function Analysis360SummarySkeleton() {
  return (
    <LoadingRegion
      label="Loading workout statistics"
      className="a360-summary min-w-0 overflow-hidden border-r p-4"
    >
      <Skeleton className="mb-7 h-4 w-20" />
      {[0, 1, 2].map((section) => (
        <div key={section} className="mb-8 space-y-4">
          <Skeleton className="h-3 w-28" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 9 }, (_, i) => (
              <Skeleton key={i} className="h-3 w-full" />
            ))}
          </div>
        </div>
      ))}
    </LoadingRegion>
  )
}

export function Analysis360Skeleton() {
  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
      aria-busy="true"
    >
      <div className="flex h-[68px] shrink-0 items-center gap-3 border-b px-6">
        <Skeleton className="size-6" />
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-3 w-28" />
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-[74px_280px_minmax(0,1fr)_74px] xl:grid-cols-[74px_320px_minmax(0,1fr)_74px]">
        <div className="border-r p-5">
          <Skeleton className="size-7" />
        </div>
        <Analysis360SummarySkeleton />
        <div className="flex min-h-0 min-w-0 flex-col">
          <div className="flex h-12 shrink-0 gap-8 px-8 py-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-3 w-16" />
            ))}
          </div>
          <Analysis360ChartsSkeleton />
        </div>
        <div className="space-y-8 border-l p-5">
          <Skeleton className="size-7" />
          <Skeleton className="size-7" />
        </div>
      </div>
    </div>
  )
}

export function WorkoutAnalysisSkeleton() {
  return (
    <LoadingRegion
      label="Loading workout analysis"
      className="min-h-0 min-w-0 overflow-hidden py-4"
    >
      <div className="grid grid-cols-[minmax(0,1fr)_300px] gap-4">
        <div className="min-w-0 space-y-3">
          <Skeleton className="h-[clamp(100px,17dvh,170px)] w-full rounded" />
          <div className="flex gap-2 py-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-5 w-12" />
            ))}
          </div>
          <SignalPlaceholder
            height={Math.max(
              180,
              Math.min(
                480,
                typeof window === "undefined" ? 280 : window.innerHeight - 470
              )
            )}
          />
        </div>
        <div className="space-y-7 border-t p-4">
          <Skeleton className="mx-auto h-3 w-28" />
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="flex justify-between gap-4">
              <Skeleton className="h-2.5 w-20" />
              <Skeleton className="h-2.5 w-10" />
              <Skeleton className="h-2.5 w-10" />
            </div>
          ))}
        </div>
      </div>
    </LoadingRegion>
  )
}
