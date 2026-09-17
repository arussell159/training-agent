import { useEffect, useRef, useState } from "react"
import { Check, ChevronRight, FileText, LoaderCircle } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { coachRequest, type CoachSource } from "@/lib/coach-client"
import "./coach-prose.css"
import { cachedTrainingContext } from "@/lib/training-context"
import { shiftReportDate } from "../../../app-backend/lib/report-blocks.mjs"

export type ReportTarget =
  | { kind: "pre" | "post"; workoutId: string }
  | { kind: "weekly"; startDate: string }
  | { kind: "block"; planId: string; startDate: string }
type ReportResult = {
  status: "empty" | "running" | "complete" | "error"
  eligible: boolean
  reason?: string
  error?: string
  text?: string
  summary?: string
  needsCheckIn?: boolean
  target?: { title: string; startDate: string; endDate: string }
  generatedAt?: string
  source?: CoachSource
  sync?: { status: string; url?: string; error?: string; canRetry?: boolean }
}
const labels = {
  pre: "pre-workout",
  post: "post-workout",
  weekly: "weekly",
  block: "block",
}

export function Section11WeeklyReport({ startDate }: { startDate: string }) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: cachedTrainingContext().athlete.time_zone || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
  if (shiftReportDate(startDate, 6) >= today) return null
  return <Section11Report target={{ kind: "weekly", startDate }} />
}

export function Section11Report({
  target,
  savedOnly = false,
}: {
  target: ReportTarget
  savedOnly?: boolean
}) {
  const signature = JSON.stringify(target)
  return (
    <ReportPanel key={signature} signature={signature} savedOnly={savedOnly} />
  )
}

function ReportPanel({
  signature,
  savedOnly,
}: {
  signature: string
  savedOnly: boolean
}) {
  const target = JSON.parse(signature) as ReportTarget
  const [result, setResult] = useState<ReportResult | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [checkIn, setCheckIn] = useState("")
  const root = useRef<HTMLDivElement>(null)
  const last = useRef<ReportResult | null>(null)
  const alive = useRef(true)
  const active = useRef(false)
  const submitting = useRef(false)
  const requests = useRef(new Set<AbortController>())
  const update = (value: ReportResult) => {
    last.current = value
    setResult(value)
  }

  async function request(action: "status" | "generate" | "sync") {
    const controller = new AbortController()
    requests.current.add(controller)
    try {
      const response = await coachRequest(
        `reports/${action}`,
        {
          ...JSON.parse(signature),
          ...(action === "generate" && target.kind === "pre" && checkIn.trim()
            ? { checkIn: checkIn.trim() }
            : {}),
        },
        controller.signal
      )
      const value = (await response.json()) as ReportResult
      if (alive.current) {
        update(value)
        setError("")
      }
    } catch (problem) {
      if (alive.current && !controller.signal.aborted)
        setError(
          problem instanceof Error
            ? problem.message
            : "Unable to check this report."
        )
    } finally {
      requests.current.delete(controller)
    }
  }
  useEffect(() => {
    alive.current = true
    let checking = false
    async function check() {
      if (!active.current || checking || last.current?.status === "complete")
        return
      checking = true
      await request("status")
      checking = false
    }
    const observer = new IntersectionObserver(
      (entries) => {
        active.current = entries.some((entry) => entry.isIntersecting)
        if (active.current) void check()
      },
      { rootMargin: "100px" }
    )
    if (root.current) observer.observe(root.current)
    const timer = window.setInterval(() => {
      if (!document.hidden) void check()
    }, 15000)
    const refresh = () => void check()
    window.addEventListener("training-context-updated", refresh)
    const pending = requests.current
    return () => {
      alive.current = false
      observer.disconnect()
      clearInterval(timer)
      window.removeEventListener("training-context-updated", refresh)
      pending.forEach((controller) => controller.abort())
    }
    // A new target remounts this component and cancels the old requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  async function act(action: "generate" | "sync") {
    if (
      submitting.current ||
      (action === "generate" &&
        (!last.current?.eligible || last.current.status === "complete"))
    )
      return
    submitting.current = true
    setBusy(true)
    setError("")
    if (action === "generate")
      update({
        ...last.current!,
        status: "running",
        eligible: false,
        reason: "Section 11 is preparing your report. It will be saved here.",
      })
    await request(action)
    if (alive.current) {
      setBusy(false)
      await request("status")
    }
    submitting.current = false
  }
  const complete = result?.status === "complete"
  const compact = target.kind === "weekly" || target.kind === "block"
  const running = busy || result?.status === "running"
  const runUrl =
    result?.sync?.url &&
    /^https:\/\/github\.com\/[^/]+\/[^/]+\/actions\/runs\/\d+$/.test(
      result.sync.url
    )
      ? result.sync.url
      : null
  if (savedOnly && !complete) return <div ref={root} className="h-px" />
  return (
    <div
      ref={root}
      className="min-w-0 space-y-3 rounded-lg border bg-card p-3 text-left"
      aria-label={`Section 11 ${labels[target.kind]} report`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <FileText className="size-4 shrink-0" />
          Section 11
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-8 text-left whitespace-normal"
          disabled={
            !result?.eligible ||
            running ||
            complete ||
            (result?.needsCheckIn && checkIn.trim().length < 10)
          }
          onClick={() => void act("generate")}
        >
          {running ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : complete ? (
            <Check className="size-4" />
          ) : null}
          {complete
            ? "Report completed"
            : running
              ? "Preparing report…"
              : `Generate ${labels[target.kind]} report`}
        </Button>
      </div>
      {!complete && !running && result?.needsCheckIn && (
        <label className="block space-y-2 text-xs leading-relaxed">
          <span>
            Before your next session: how do you feel now, how sore are you, and
            do you have any new pain or symptoms?
          </span>
          <textarea
            value={checkIn}
            onChange={(event) => setCheckIn(event.target.value)}
            maxLength={2000}
            rows={3}
            className="w-full rounded-md border bg-background p-2 text-sm"
            placeholder="Feel now, soreness, and any new pain or symptoms…"
          />
        </label>
      )}
      {!complete && (
        <p
          className="text-xs leading-relaxed text-muted-foreground"
          role="status"
        >
          {result?.reason ||
            (!result
              ? "Checking report availability…"
              : "Generate once. Your report will be saved here.")}
        </p>
      )}
      {!complete && result?.sync && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          {["dispatching", "checking", "queued", "running"].includes(
            result.sync.status
          ) && (
            <>
              <LoaderCircle className="size-3 animate-spin" />
              <span>Syncing workout with Section 11…</span>
            </>
          )}
          {result.sync.status === "complete" && (
            <span>
              Sync finished; this workout’s report data is not available yet.
            </span>
          )}
          {result.sync.error && <span>{result.sync.error}</span>}
          {runUrl && (
            <a
              href={runUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              View sync
            </a>
          )}
          {result.sync.canRetry && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => void act("sync")}
            >
              Retry sync
            </Button>
          )}
        </div>
      )}
      {(error || result?.error) && !complete && (
        <p role="alert" className="text-xs text-destructive">
          {error || result?.error}
        </p>
      )}
      {complete && (
        <>
          {compact ? (
            <>
              <button
                type="button"
                onClick={() => setOpen(true)}
                className="flex w-full items-center justify-between gap-3 rounded-md p-1 text-left text-sm leading-relaxed hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`Open full ${labels[target.kind]} report`}
              >
                <span>{result.summary || "View saved report."}</span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              </button>
              <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="no-scrollbar max-h-[94vh] gap-0 overflow-y-auto p-0 sm:max-w-5xl">
                  <DialogHeader className="border-b px-5 py-5 pr-12 sm:px-8 sm:pr-12">
                    <DialogTitle>
                      Section 11 · {labels[target.kind]} report
                    </DialogTitle>
                    <DialogDescription>
                      {result.target?.startDate} – {result.target?.endDate}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="min-w-0 px-5 py-6 sm:px-8">
                    <ReportBody text={result.text} />
                  </div>
                </DialogContent>
              </Dialog>
            </>
          ) : (
            <ReportBody text={result.text} />
          )}
          <p className="border-t pt-2 text-[11px] text-muted-foreground">
            Saved{" "}
            {result.generatedAt
              ? new Date(result.generatedAt).toLocaleString()
              : ""}
            {result.source?.lastSynced
              ? ` · Training data synced ${new Date(result.source.lastSynced).toLocaleString()}`
              : ""}
          </p>
        </>
      )}
    </div>
  )
}

function ReportBody({ text }: { text?: string }) {
  return (
    <article className="coach-prose section11-report-body min-w-0 overflow-x-auto text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: () => null,
          a: ({ children }) => <span>{children}</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </article>
  )
}
