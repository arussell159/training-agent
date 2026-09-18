import type { MetricDefinition, MetricTone } from "@/lib/terms-reference-data"
import { cn } from "@/lib/utils"

const statusTextClasses: Record<MetricTone, string> = {
  green: "text-emerald-700 dark:text-emerald-300",
  amber: "text-amber-700 dark:text-amber-300",
  red: "text-red-700 dark:text-red-300",
  neutral: "text-muted-foreground",
}

export function MetricDetail({
  metric,
  compact = false,
}: {
  metric: MetricDefinition
  compact?: boolean
}) {
  return (
    <div className={cn("min-w-0", compact ? "space-y-4" : "space-y-5")}>
      <p className="text-sm leading-relaxed text-foreground">
        {metric.definition}
      </p>

      <div
        className="terms-metric-data-card overflow-hidden rounded-xl border bg-card shadow-xs"
        role="region"
        aria-label={`${metric.name} status and range`}
      >
        {metric.bands?.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] border-collapse text-left text-xs sm:text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-muted-foreground">
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Range
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">
                    Meaning / action
                  </th>
                </tr>
              </thead>
              <tbody>
                {metric.bands.map((row) => {
                  const tone = row.tone || "neutral"
                  return (
                    <tr
                      key={`${row.status}-${row.range}`}
                      className="border-b last:border-b-0"
                    >
                      <th
                        scope="row"
                        className={cn(
                          "w-24 px-3 py-2.5 align-top font-semibold",
                          statusTextClasses[tone]
                        )}
                      >
                        {row.status}
                      </th>
                      <td className="w-[38%] px-3 py-2.5 align-top font-medium whitespace-pre-wrap">
                        {row.range}
                      </td>
                      <td className="px-3 py-2.5 align-top leading-relaxed">
                        {row.meaning}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="flex items-start gap-3 p-3.5">
            <span className="mt-0.5 inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Neutral
            </span>
            <div className="min-w-0 text-sm leading-relaxed">
              <p className="font-medium">No fixed range</p>
              <p className="text-muted-foreground">
                Use the metric as context unless an existing supported status is
                available.
              </p>
            </div>
          </div>
        )}
      </div>

      {metric.phase && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Phase adjustments
          </h3>
          <p className="text-sm leading-relaxed">{metric.phase}</p>
        </section>
      )}

      {metric.notes?.length ? (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Essential notes
          </h3>
          <ul className="space-y-1.5 pl-4 text-sm leading-relaxed marker:text-muted-foreground">
            {metric.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
