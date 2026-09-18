import { parseBlockReportPresentation } from "../../../app-backend/lib/block-report-presentation.mjs"
import { parseWeeklyReportPresentation } from "../../../app-backend/lib/weekly-report-presentation.mjs"

export type ReportKind = "weekly" | "block"
export type CatalogReport = {
  id: string
  kind: ReportKind
  title: string
  startDate: string
  endDate: string
  text: string
  source: "intervals"
}
export type Catalog = { reports: CatalogReport[] }
export type Filter = "all" | ReportKind

export function periodLabel(report: CatalogReport) {
  const shortDate = (value: string) => {
    const [year, month, day] = value.split("-")
    return `${month}/${day}/${year.slice(-2)}`
  }
  return `${shortDate(report.startDate)} to ${shortDate(report.endDate)}`
}

type ReportEntry = { label: string; value: string }
type PresentationSection = {
  title: string
  entries: ReportEntry[]
  prose: string[]
}

const key = (value: string) => value.trim().toLowerCase()
const displayValue = (value: string) =>
  key(value) === "unavailable" ? "Unavailable" : value
const entryMap = (entries: ReportEntry[]) =>
  new Map(entries.map((entry) => [key(entry.label), entry.value]))

function ReportSection({
  title,
  rows,
  headers = ["Metric", "Result"],
  prose = [],
  table = false,
}: {
  title: string
  rows: string[][]
  headers?: string[]
  prose?: string[]
  table?: boolean
}) {
  if (!rows.length && !prose.length) return null
  return (
    <section className="space-y-3">
      <h3 className="text-base font-semibold tracking-tight">{title}</h3>
      {rows.length > 0 && (table || rows.length > 2) ? (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                {headers.map((header, index) => (
                  <th
                    key={header}
                    className={`px-3 py-2 font-medium ${index ? "text-right" : ""}`}
                  >
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.join("|")} className="border-t">
                  {row.map((value, index) => (
                    <td
                      key={`${index}:${value}`}
                      className={`px-3 py-2 ${index ? "text-right tabular-nums" : "font-medium"}`}
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-1.5 text-sm">
          {rows.map(([label, ...values]) => (
            <p key={`${label}:${values.join(":")}`}>
              <strong className="font-semibold">{label}:</strong>{" "}
              {values.join(" · ")}
            </p>
          ))}
        </div>
      )}
      {prose.map((paragraph, index) => (
        <p key={index} className="text-sm leading-relaxed">
          {paragraph}
        </p>
      ))}
    </section>
  )
}

export function WeeklyReportBody({
  report,
  hideHeading = false,
}: {
  report: CatalogReport
  hideHeading?: boolean
}) {
  const parsed = parseWeeklyReportPresentation(report.text) as {
    heading: string
    startDate: string | null
    endDate: string | null
    summary: string[]
    sections: PresentationSection[]
  }
  const section = (title: string) =>
    parsed.sections.find((item) => item.title === title)
  const training = section("Training Load")
  const trainingNames = new Map([
    ["hours", "Training Time"],
    ["ctl (week end)", "CTL"],
    ["atl (week end)", "ATL"],
    ["tsb (week end)", "TSB"],
    ["ramp rate", "Ramp Rate"],
    ["acwr", "ACWR"],
    ["monotony", "Monotony"],
  ])
  const trainingRows = (training?.entries || []).map((entry) => [
    trainingNames.get(key(entry.label)) || entry.label,
    displayValue(entry.value),
  ])

  const sport = section("Sport Load")
  const sportRows = (sport?.entries || [])
    .filter(
      (entry) => /\sTSS$/i.test(entry.label) && !/primary/i.test(entry.label)
    )
    .map((entry) => [
      entry.label.replace(/\sTSS$/i, "").replace(/^Cycling$/i, "Bike"),
      displayValue(entry.value),
    ])
  const sportContext = (sport?.entries || [])
    .filter(
      (entry) => !/\sTSS$/i.test(entry.label) || /primary/i.test(entry.label)
    )
    .map((entry) => {
      const label = new Map([
        ["primary sport", "Primary Sport"],
        ["primary-sport tss", "Primary-Sport TSS"],
        ["longest ride", "Longest Ride"],
      ]).get(key(entry.label))
      return [label || entry.label, displayValue(entry.value)]
    })

  const intensity = section("Intensity Distribution")
  const intensityNames = new Map([
    ["easy time (z1+z2)", "Easy — Z1–Z2"],
    ["grey zone (z3)", "Grey Zone — Z3"],
    ["quality (z4+)", "Quality — Z4+"],
  ])
  const intensityRows = (intensity?.entries || [])
    .filter((entry) => key(entry.label) !== "hard days")
    .map((entry) => [
      intensityNames.get(key(entry.label)) || entry.label,
      displayValue(entry.value),
    ])
  const hardDays = (intensity?.entries || []).filter(
    (entry) => key(entry.label) === "hard days"
  )

  const recovery = section("Recovery & Durability")
  const recoveryValues = entryMap(recovery?.entries || [])
  const recoveryDefinitions = [
    ["Average HRV", "HRV", null],
    ["Average resting HR", "Resting HR", null],
    ["Average sleep", "Sleep", null],
    [
      "Durability mean decoupling",
      "Durability / Decoupling",
      "Durability qualifying sessions",
    ],
    ["Efficiency factor mean", "Efficiency Factor", "EF qualifying sessions"],
    ["HR recovery mean", "HR Recovery", "HRRc qualifying sessions"],
  ] as const
  const usedRecovery = new Set(
    recoveryDefinitions.flatMap(([value, , samples]) =>
      samples ? [key(value), key(samples)] : [key(value)]
    )
  )
  const recoveryRows = recoveryDefinitions
    .filter(([source]) => recoveryValues.has(key(source)))
    .map(([source, label, samples]) => [
      label,
      displayValue(recoveryValues.get(key(source))!),
      samples ? recoveryValues.get(key(samples)) || "—" : "—",
    ])
    .concat(
      (recovery?.entries || [])
        .filter((entry) => !usedRecovery.has(key(entry.label)))
        .map((entry) => [entry.label, displayValue(entry.value), "—"])
    )

  const body = section("Body & Subjective")
  const bodyNames = new Map([
    ["average feel", "Feel"],
    ["average rpe", "RPE"],
  ])
  const bodyRows = (body?.entries || []).map((entry) => [
    bodyNames.get(key(entry.label)) || entry.label,
    displayValue(entry.value),
  ])
  const known = new Set([
    "Training Load",
    "Sport Load",
    "Intensity Distribution",
    "Recovery & Durability",
    "Body & Subjective",
  ])

  return (
    <article className="min-w-0 space-y-6 text-left">
      <header className={hideHeading ? "hidden" : "space-y-1 border-b pb-4"}>
        <h2 className="text-xl font-semibold tracking-tight">Weekly Report</h2>
        <p className="text-sm font-medium text-muted-foreground">
          {periodLabel({
            ...report,
            startDate: parsed.startDate || report.startDate,
            endDate: parsed.endDate || report.endDate,
          })}
        </p>
      </header>
      {parsed.summary.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold tracking-tight">
            Coach Summary
          </h3>
          {parsed.summary.map((paragraph, index) => (
            <p key={index} className="text-sm leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      )}
      <ReportSection title="Training Load" rows={trainingRows} />
      <ReportSection
        title="Sport Load"
        headers={["Sport", "TSS"]}
        rows={sportRows}
      />
      {sportContext.length > 0 && (
        <div className="-mt-3 space-y-1.5 text-sm">
          {sportContext.map(([label, value]) => (
            <p key={label}>
              <strong className="font-semibold">{label}:</strong> {value}
            </p>
          ))}
        </div>
      )}
      <ReportSection
        title="Intensity Distribution"
        headers={["Intensity", "Time"]}
        rows={intensityRows}
      />
      {hardDays.map((entry) => (
        <p key={entry.label} className="-mt-3 text-sm">
          <strong className="font-semibold">Hard Days:</strong> {entry.value}
        </p>
      ))}
      <ReportSection
        title="Recovery & Durability"
        headers={["Metric", "Result", "Samples"]}
        rows={recoveryRows}
      />
      <ReportSection title="Body & Subjective" rows={bodyRows} />
      {parsed.sections
        .filter((item) => !known.has(item.title))
        .map((item) => (
          <ReportSection
            key={item.title}
            title={item.title}
            rows={item.entries.map((entry) => [
              entry.label,
              displayValue(entry.value),
            ])}
            prose={item.prose}
          />
        ))}
    </article>
  )
}

export function BlockReportBody({ report }: { report: CatalogReport }) {
  const parsed = parseBlockReportPresentation(report.text)
  return (
    <article className="min-w-0 space-y-6 text-left">
      {parsed.summary.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-base font-semibold tracking-tight">
            Coach Summary
          </h3>
          {parsed.summary.map((paragraph, index) => (
            <p key={index} className="text-sm leading-relaxed">
              {paragraph}
            </p>
          ))}
        </section>
      )}
      {parsed.sections.map((section, index) => (
        <ReportSection
          key={index}
          title={section.title}
          table
          headers={section.headers}
          rows={section.rows}
          prose={section.prose}
        />
      ))}
    </article>
  )
}
