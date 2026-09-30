import { useEffect, useState } from "react"
import { FlaskConical, LockKeyhole, RefreshCw, Search } from "lucide-react"
import { Button } from "@/components/ui/button"

type LabResult = {
  id: string
  name: string
  section: string
  value: number | string
  unit: string
  reference: string
  flag: "H" | "L" | null
  risk_ranges: string | null
  population_reference: string | null
  notes: string | null
  source_page: number
}
type LabReport = {
  id: string
  title: string
  laboratory: string
  collected_date: string
  reported_date: string
  fasting: boolean | null
  source_filename: string
  results: LabResult[]
}
type LabPayload = { schema_version: number; reports: LabReport[]; error?: string }

function formatDate(value: string) {
  // These are collection/report dates, not UTC instants. Never shift their day.
  return new Date(`${value}T12:00:00`).toLocaleDateString(undefined, {
    year: "numeric", month: "short", day: "numeric",
  })
}
function formatValue(value: number | string) {
  return typeof value === "number"
    ? value.toLocaleString(undefined, { maximumFractionDigits: 10 })
    : value
}
function Flag({ value }: { value: LabResult["flag"] }) {
  return (
    <span className={`inline-flex whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium ${
      value ? "border-destructive/20 bg-destructive/5 text-destructive" : "border-border bg-muted/40 text-muted-foreground"
    }`}>
      {value === "H" ? "↑ High" : value === "L" ? "↓ Low" : "Not flagged"}
    </span>
  )
}
function LabDetails({ result }: { result: LabResult }) {
  if (!result.risk_ranges && !result.population_reference && !result.notes) return null
  return (
    <details className="mt-2 max-w-xl text-xs font-normal leading-relaxed text-muted-foreground">
      <summary className="w-fit cursor-pointer rounded-sm text-foreground/70 outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring">
        Report ranges &amp; notes
      </summary>
      <div className="mt-2 space-y-2 rounded-lg bg-muted/40 p-3">
        {result.risk_ranges && <p><span className="font-medium text-foreground">Report categories{result.unit ? ` (${result.unit})` : ""}: </span>{result.risk_ranges}</p>}
        {result.population_reference && <p><span className="font-medium text-foreground">Additional population interval: </span>{result.population_reference}</p>}
        {result.notes && <p>{result.notes}</p>}
        <p>Source: report page {result.source_page}. Category bands are separate from the High/Low flag.</p>
      </div>
    </details>
  )
}

export function LabResultsPage() {
  const [reports, setReports] = useState<LabReport[] | null>(null)
  const [selectedId, setSelectedId] = useState("")
  const [query, setQuery] = useState("")
  const [flaggedOnly, setFlaggedOnly] = useState(false)
  const [error, setError] = useState("")
  const [reload, setReload] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    async function load() {
      setError("")
      setReports(null)
      try {
        const response = await fetch("/api/labs", {
          credentials: "same-origin", cache: "no-store", signal: abort.signal,
          headers: { Accept: "application/json" },
        })
        const payload: LabPayload = await response.json()
        if (!response.ok) throw new Error(payload.error || "Laboratory results could not be loaded.")
        if (payload.schema_version !== 1 || !Array.isArray(payload.reports))
          throw new Error("The laboratory response has an unsupported format.")
        if (!abort.signal.aborted) setReports(payload.reports)
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure instanceof Error ? failure.message : "Laboratory results could not be loaded.")
      }
    }
    void load()
    return () => abort.abort()
  }, [reload])

  const report = reports?.find(item => item.id === selectedId) || reports?.[0]
  const flaggedCount = report?.results.filter(result => result.flag !== null).length || 0
  const search = query.trim().toLowerCase()
  const rows = report?.results.filter(result =>
    (!flaggedOnly || result.flag !== null) &&
    (!search || `${result.name} ${result.section}`.toLowerCase().includes(search))
  ) || []
  const loading = reports === null && !error

  return (
    <section className="mx-auto w-full min-w-0 max-w-6xl space-y-5 p-4 md:p-6" aria-label="Laboratory results">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            <FlaskConical className="size-4" aria-hidden="true" /> Health records
          </div>
          <h2 className="text-2xl font-semibold tracking-tight">Lab Results</h2>
          <p className="mt-1 text-sm text-muted-foreground">Your results and the ranges printed on your laboratory report.</p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => setReload(value => value + 1)} aria-label="Refresh laboratory results">
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
          <span className="hidden sm:inline">Refresh</span>
        </Button>
      </div>

      {loading && <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground" role="status">Loading your private laboratory records…</div>}
      {error && (
        <div className="space-y-3 rounded-xl border bg-card p-5" role="alert">
          <p className="text-sm">{error}</p>
          <Button variant="outline" size="sm" onClick={() => setReload(value => value + 1)}>Try again</Button>
        </div>
      )}
      {reports?.length === 0 && !error && (
        <div className="rounded-xl border bg-card p-8 text-sm text-muted-foreground">No laboratory reports have been saved to your private training-data source yet.</div>
      )}

      {report && !error && (
        <>
          <div className="rounded-xl border bg-card p-4 md:p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h3 className="font-semibold">{report.title}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{report.laboratory}</p>
              </div>
              {reports && reports.length > 1 && (
                <label className="space-y-1 text-xs text-muted-foreground">
                  <span className="block">Collection date</span>
                  <select className="h-9 max-w-full rounded-md border bg-background px-3 text-sm text-foreground" value={report.id} onChange={event => {
                    setSelectedId(event.target.value); setQuery(""); setFlaggedOnly(false)
                  }}>
                    {reports.map(item => <option key={item.id} value={item.id}>{formatDate(item.collected_date)} — {item.title}</option>)}
                  </select>
                </label>
              )}
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 border-t pt-4 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-muted-foreground">Collected</dt><dd className="mt-1 font-medium">{formatDate(report.collected_date)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Reported</dt><dd className="mt-1 font-medium">{formatDate(report.reported_date)}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Fasting</dt><dd className="mt-1 font-medium">{report.fasting === null ? "Not recorded" : report.fasting ? "Yes" : "No"}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Results</dt><dd className="mt-1 font-medium">{report.results.length} tests · {flaggedCount} flagged</dd></div>
            </dl>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative block sm:max-w-sm sm:flex-1">
              <span className="sr-only">Search laboratory tests</span>
              <Search className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground" aria-hidden="true" />
              <input className="h-10 w-full rounded-lg border bg-background pr-3 pl-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring" type="search" placeholder="Search tests…" value={query} onChange={event => setQuery(event.target.value)} />
            </label>
            <div className="flex items-center gap-2" role="group" aria-label="Filter laboratory results">
              <Button size="sm" variant={flaggedOnly ? "outline" : "secondary"} aria-pressed={!flaggedOnly} onClick={() => setFlaggedOnly(false)}>All results</Button>
              <Button size="sm" variant={flaggedOnly ? "secondary" : "outline"} aria-pressed={flaggedOnly} onClick={() => setFlaggedOnly(true)}>Flagged ({flaggedCount})</Button>
            </div>
          </div>

          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{report.title}, collected {formatDate(report.collected_date)}. Reference ranges and flags copied from the laboratory report.</caption>
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr><th scope="col" className="px-5 py-3 font-medium">Test</th><th scope="col" className="px-5 py-3 font-medium">Result</th><th scope="col" className="px-5 py-3 font-medium">Lab reference</th><th scope="col" className="px-5 py-3 font-medium">Report flag</th></tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map(result => (
                    <tr key={`${report.id}-${result.id}`} className="align-top hover:bg-muted/20">
                      <th scope="row" className="px-5 py-4 font-medium"><span>{result.name}</span><LabDetails result={result} /></th>
                      <td className="whitespace-nowrap px-5 py-4 tabular-nums"><span className="font-semibold">{formatValue(result.value)}</span>{result.unit && <span className="ml-1.5 text-xs text-muted-foreground">{result.unit}</span>}</td>
                      <td className="whitespace-nowrap px-5 py-4 tabular-nums">{result.reference}</td>
                      <td className="px-5 py-4"><Flag value={result.flag} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="divide-y md:hidden">
              {rows.map(result => (
                <article key={`${report.id}-${result.id}`} className="p-4">
                  <div className="flex items-start justify-between gap-3"><h4 className="min-w-0 text-sm font-medium">{result.name}</h4><Flag value={result.flag} /></div>
                  <dl className="mt-3 grid grid-cols-2 gap-4">
                    <div><dt className="text-xs text-muted-foreground">Result</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{formatValue(result.value)}{result.unit && <span className="ml-1.5 text-xs font-normal text-muted-foreground">{result.unit}</span>}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">Lab reference{result.unit ? ` (${result.unit})` : ""}</dt><dd className="mt-1 text-sm font-medium tabular-nums">{result.reference}</dd></div>
                  </dl>
                  <LabDetails result={result} />
                </article>
              ))}
            </div>
            {rows.length === 0 && <p className="p-6 text-sm text-muted-foreground" role="status">No tests match these filters.</p>}
          </div>
          <div className="space-y-2 text-xs leading-relaxed text-muted-foreground">
            <p>High and Low are the report’s above/below-reference flags, not cardiovascular risk categories. Expand a test to see its separate category ranges and notes. Lab references are not personalized treatment targets.</p>
            <p>Source: {report.source_filename}. Results remain dated to collection; they are not live training metrics.</p>
            <p className="flex items-center gap-1.5"><LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" /> Private source · Sign-in required · No AI-generated interpretation</p>
          </div>
        </>
      )}
    </section>
  )
}
