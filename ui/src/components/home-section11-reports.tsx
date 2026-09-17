import { useEffect, useState } from "react"
import { Section11Report } from "@/components/section11-report"
import { coachRequest } from "@/lib/coach-client"
import { dateLabel } from "@/lib/annual-plan"
import { Button } from "@/components/ui/button"

type Period = {
  kind: "weekly" | "block"
  startDate: string
  endDate: string
  planId?: string
  title?: string
}
type Catalog = { weeks: Period[]; blocks: Period[] }

export function HomeSection11Reports() {
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
        if (!controller.signal.aborted) {
          setCatalog(await response.json())
          setError("")
        }
      } catch (problem) {
        if (!controller.signal.aborted)
          setError(
            problem instanceof Error
              ? problem.message
              : "Unable to load reports."
          )
      }
    }
    void load()
    window.addEventListener("annual-plan-updated", load)
    window.addEventListener("training-context-updated", load)
    return () => {
      controller.abort()
      window.removeEventListener("annual-plan-updated", load)
      window.removeEventListener("training-context-updated", load)
    }
  }, [revision])
  return (
    <section
      className="space-y-3 pb-3"
      aria-label="Section 11 weekly and block reports"
    >
      <h2 className="text-base font-semibold">Section 11 reports</h2>
      {error ? (
        <div role="alert" className="space-y-2 text-sm text-muted-foreground">
          <p>{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRevision((value) => value + 1)}
          >
            Retry
          </Button>
        </div>
      ) : !catalog ? (
        <p className="text-sm text-muted-foreground">Loading reports…</p>
      ) : (
        <>
          <PeriodReport title="Weekly report" periods={catalog.weeks} />
          <PeriodReport title="Block report" periods={catalog.blocks} />
        </>
      )}
    </section>
  )
}

function PeriodReport({
  title,
  periods,
}: {
  title: string
  periods: Period[]
}) {
  const [selected, setSelected] = useState("")
  const key = (period: Period) =>
    `${period.planId || "week"}:${period.startDate}`
  const period = periods.find((item) => key(item) === selected) || periods[0]
  return (
    <div className="space-y-2">
      <label className="block space-y-2 text-sm font-medium">
        <span>{title}</span>
        {period && (
          <select
            value={key(period)}
            onChange={(event) => setSelected(event.target.value)}
            className="w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm font-normal"
            aria-label={`Choose ${title.toLowerCase()} period`}
          >
            {periods.map((item) => (
              <option key={key(item)} value={key(item)}>
                {item.title ? `${item.title} · ` : ""}
                {dateLabel(item.startDate)} –{" "}
                {dateLabel(item.endDate, {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </option>
            ))}
          </select>
        )}
      </label>
      {period ? (
        <Section11Report
          target={
            period.kind === "weekly"
              ? { kind: "weekly", startDate: period.startDate }
              : {
                  kind: "block",
                  planId: period.planId!,
                  startDate: period.startDate,
                }
          }
        />
      ) : (
        <p className="rounded-lg border p-3 text-xs text-muted-foreground">
          Available when an ATP block is complete.
        </p>
      )}
    </div>
  )
}
