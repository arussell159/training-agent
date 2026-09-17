import { useEffect, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { coachRequest, type CalendarProposal } from "@/lib/coach-client"

const labels: Record<CalendarProposal["state"], string> = {
  preview_pending: "Checking workout preview…",
  ready: "Ready to add",
  queued: "Adding workouts…",
  applied: "Added to Intervals.icu",
  declined: "Declined",
  not_applied: "Workouts were not added",
  unknown: "Outcome needs checking",
  expired: "Preview expired",
  preview_failed: "Preview needs correction",
}

export function CoachCalendar({ refreshKey }: { refreshKey: number }) {
  const [proposals, setProposals] = useState<CalendarProposal[]>([])
  const [busy, setBusy] = useState<{
    id: string
    action: "confirm" | "decline"
  } | null>(null)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function refresh() {
      try {
        if (document.hidden) return
        const response = await coachRequest("calendar", undefined, abort.signal)
        const result: { proposals: CalendarProposal[] } = await response.json()
        const pending = result.proposals
          .filter((p) =>
            ["preview_pending", "queued", "unknown"].includes(p.state)
          )
          .slice(0, 4)
        const updated = await Promise.allSettled(
          pending.map(async (p) => {
            const response = await coachRequest(
              `calendar/${p.id}`,
              undefined,
              abort.signal
            )
            return (await response.json()) as CalendarProposal
          })
        )
        if (abort.signal.aborted) return
        const fresh = new Map(
          updated
            .filter((r) => r.status === "fulfilled")
            .map((r) => [r.value.id, r.value])
        )
        setProposals(result.proposals.map((p) => fresh.get(p.id) || p))
        const failed = updated.find((r) => r.status === "rejected")
        setError(
          failed?.status === "rejected"
            ? failed.reason instanceof Error
              ? failed.reason.message
              : "Unable to check calendar status."
            : ""
        )
      } catch (problem) {
        if (!abort.signal.aborted)
          setError(
            problem instanceof Error
              ? problem.message
              : "Unable to check calendar proposals."
          )
      } finally {
        if (!abort.signal.aborted)
          timer = setTimeout(() => void refresh(), 15000)
      }
    }
    void refresh()
    return () => {
      abort.abort()
      clearTimeout(timer)
    }
  }, [refreshKey, revision])

  async function decide(
    proposal: CalendarProposal,
    action: "confirm" | "decline"
  ) {
    if (busy) return
    setBusy({ id: proposal.id, action })
    setError("")
    try {
      const response = await coachRequest(
        `calendar/${proposal.id}/${action}`,
        {}
      )
      const updated = (await response.json()) as CalendarProposal
      setProposals((current) =>
        current.map((p) => (p.id === updated.id ? updated : p))
      )
    } catch (problem) {
      setError(
        problem instanceof Error
          ? problem.message
          : action === "decline"
            ? "Unable to dismiss this workout. Please try again."
            : "Unable to confirm the push. Check its status before retrying."
      )
    } finally {
      setBusy(null)
      setRevision((value) => value + 1)
    }
  }

  const visible = proposals.filter(
    (proposal) => !["queued", "applied", "declined"].includes(proposal.state)
  )
  if (!visible.length && !error) return null
  return (
    <section aria-label="Calendar proposals" className="mt-6 space-y-6">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {visible.map((proposal) => (
        <article key={proposal.id} className="space-y-4 border-t pt-5">
          <h3 className="text-sm font-semibold">
            {proposal.workouts.length}{" "}
            {proposal.workouts.length === 1 ? "workout" : "workouts"}{" "}
            {labels[proposal.state].toLowerCase()}
          </h3>
          {proposal.workouts.map((workout, index) => (
            <div key={index} className="space-y-2">
              <h4 className="text-sm font-medium">{workout.name}</h4>
              <p className="text-xs text-muted-foreground">
                {[
                  workout.date,
                  workout.type,
                  workout.indoor ? "Indoor" : null,
                  workout.duration_minutes != null
                    ? workout.duration_minutes + " min"
                    : null,
                  workout.tss != null ? workout.tss + " TSS" : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              <p className="text-sm leading-6 wrap-anywhere whitespace-pre-wrap">
                {workout.description}
              </p>
            </div>
          ))}
          {proposal.error && (
            <p role="status" className="text-sm text-muted-foreground">
              {proposal.error}
            </p>
          )}
          {proposal.phase === "preview" && (
            <div className="flex items-center justify-between gap-3">
              <Button
                type="button"
                variant="outline"
                className="h-11 flex-1"
                disabled={busy !== null}
                onClick={() => void decide(proposal, "decline")}
              >
                {busy?.id === proposal.id && busy.action === "decline" && (
                  <LoaderCircle className="size-4 animate-spin" />
                )}
                Deny
              </Button>
              <Button
                type="button"
                className="h-11 flex-1"
                disabled={busy !== null || proposal.state !== "ready"}
                onClick={() => void decide(proposal, "confirm")}
              >
                {busy?.id === proposal.id && busy.action === "confirm" && (
                  <LoaderCircle className="size-4 animate-spin" />
                )}
                Approve
              </Button>
            </div>
          )}
          {proposal.runUrl &&
            ["unknown", "not_applied", "preview_failed"].includes(
              proposal.state
            ) && (
              <a
                href={proposal.runUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline underline-offset-4"
              >
                View push result
              </a>
            )}
        </article>
      ))}
    </section>
  )
}
