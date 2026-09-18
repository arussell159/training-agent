import { useEffect, useState } from "react"
import { FileText } from "lucide-react"
import { coachRequest } from "@/lib/coach-client"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { BlockReportBody, WeeklyReportBody, periodLabel, type CatalogReport } from "@/components/catalog-report-body"

let request: Promise<CatalogReport[]> | null = null
let expires = 0
function loadReports() {
  if (!request || Date.now() >= expires) {
    expires = Date.now() + 60_000
    request = coachRequest("reports/catalog", {}).then(response => response.json()).then(value => value.reports || []).catch(error => { request = null; throw error })
  }
  return request
}

// Read-only: a button exists only for a report already stored in Intervals.icu.
export function SavedReportButton({kind, startDate}: {kind: "weekly" | "block"; startDate: string}) {
  const [report, setReport] = useState<CatalogReport | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let active = true
    const load = () => void loadReports().then(reports => { if (active) setReport(reports.find(r => r.kind === kind && r.startDate === startDate) || null) }).catch(() => {})
    load()
    window.addEventListener('training-context-updated', load)
    return () => { active = false; window.removeEventListener('training-context-updated', load) }
  }, [kind, startDate])
  if (!report) return null
  return <>
    <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 gap-1 px-2 text-xs" onClick={() => setOpen(true)}><FileText className="size-3.5" />{kind === 'weekly' ? 'Weekly report' : 'Block report'}</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[86dvh] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{periodLabel(report)}</DialogTitle></DialogHeader><div className="pb-[45vh]">{kind === 'weekly' ? <WeeklyReportBody report={report} hideHeading /> : <BlockReportBody report={report} />}</div></DialogContent></Dialog>
  </>
}
