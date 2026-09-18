import { useEffect, useState } from "react"
import { Block, BlockTitle } from "framework7-react"
import { FileText } from "lucide-react"

import { Section11Report } from "@/components/section11-report"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useIsMobile } from "@/hooks/use-mobile"
import { coachRequest } from "@/lib/coach-client"

type WeekPeriod = {
  kind: "weekly"
  startDate: string
  endDate: string
}

type Catalog = {
  weeks: WeekPeriod[]
}

export function CoachPage() {
  const isMobile = useIsMobile()
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await coachRequest(
          "reports/catalog",
          {},
          controller.signal
        )
        const value = (await response.json()) as Catalog
        if (!controller.signal.aborted) {
          setCatalog({ weeks: value.weeks || [] })
          setError("")
        }
      } catch (problem) {
        if (!controller.signal.aborted) {
          setError(
            problem instanceof Error
              ? problem.message
              : "Unable to load weekly reports."
          )
        }
      }
    }

    void load()
    window.addEventListener("training-context-updated", load)
    window.addEventListener("annual-plan-updated", load)

    return () => {
      controller.abort()
      window.removeEventListener("training-context-updated", load)
      window.removeEventListener("annual-plan-updated", load)
    }
  }, [revision])

  const body = error ? (
    <div
      role="alert"
      className="space-y-3 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
    >
      <p>{error}</p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setRevision((value) => value + 1)}
      >
        Retry
      </Button>
    </div>
  ) : !catalog ? (
    <p className="text-sm text-muted-foreground">Loading weekly reports…</p>
  ) : catalog.weeks.length === 0 ? (
    <div className="rounded-xl border bg-muted/20 p-5 text-sm text-muted-foreground">
      No completed weeks are available yet.
    </div>
  ) : isMobile ? (
    <div className="pb-6">
      <BlockTitle>Weekly reports</BlockTitle>
      {catalog.weeks.map((week) => (
        <Block key={week.startDate} className="my-3">
          <Section11Report
            unframed
            target={{ kind: "weekly", startDate: week.startDate }}
            dateRange={week}
          />
        </Block>
      ))}
    </div>
  ) : (
    <div className="space-y-3">
      {catalog.weeks.map((week) => (
        <Card key={week.startDate} className="p-3 shadow-sm">
          <Section11Report
            unframed
            target={{ kind: "weekly", startDate: week.startDate }}
            dateRange={week}
          />
        </Card>
      ))}
    </div>
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto w-full max-w-4xl px-4 py-5 md:px-6 md:py-8">
        <div className="mb-5 hidden items-start gap-3 md:flex">
          <div className="rounded-lg border bg-muted/30 p-2.5">
            <FileText className="size-5 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Weekly Reports
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Section 11 reports for completed training weeks.
            </p>
          </div>
        </div>
        {body}
      </div>
    </div>
  )
}
