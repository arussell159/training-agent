import { useEffect, useState } from "react"
import { CalendarPlus, LoaderCircle } from "lucide-react"
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
  const [busy, setBusy] = useState<string | null>(null)
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
    setBusy(proposal.id)
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
    <section aria-label="Calendar proposals" className="mt-7 space-y-4">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <CalendarPlus className="size-4" /> Calendar proposals
      </h3>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {visible.map((proposal) => (
        <details
          key={proposal.id}
          open={
            !["applied", "expired", "not_applied", "preview_failed"].includes(
              proposal.state
            )
          }
          className="rounded-2xl border bg-muted/10 p-4"
        >
          <summary className="cursor-pointer text-sm font-medium">
            {proposal.workouts.length}{" "}
            {proposal.workouts.length === 1 ? "workout" : "workouts"} ·{" "}
            {labels[proposal.state]}
          </summary>
          <div className="mt-4 space-y-4">
            <p className="text-xs text-muted-foreground">
              Dates use {proposal.timeZone}. Existing calendar workouts are
              kept.
            </p>
            {proposal.workouts.map((workout, index) => (
              <article
                key={index}
                className="rounded-xl border bg-background p-4"
              >
                <p className="text-xs text-muted-foreground">
                  {workout.date} · {workout.type}
                  {workout.indoor ? " · Indoor" : ""}
                </p>
                <h4 className="mt-1 text-sm font-medium">{workout.name}</h4>
                <p className="mt-1 text-xs text-muted-foreground">
                  {[
                    workout.duration_minutes != null
                      ? `${workout.duration_minutes} min`
                      : null,
                    workout.tss != null ? `${workout.tss} TSS` : null,
                    workout.target ? `${workout.target} targets` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <pre className="mt-3 font-sans text-sm leading-6 wrap-anywhere whitespace-pre-wrap">
                  {workout.description}
                </pre>
              </article>
            ))}
            {proposal.error && (
              <p role="status" className="text-sm text-muted-foreground">
                {proposal.error}
              </p>
            )}
            {proposal.state === "ready" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Review the dates and every step above. Clicking below adds
                  this exact plan to your Intervals.icu calendar.
                </p>
                <Button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void decide(proposal, "confirm")}
                >
                  {busy === proposal.id ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <CalendarPlus className="size-4" />
                  )}{" "}
                  Add to Intervals.icu
                </Button>
              </div>
            )}
            {["preview_pending", "queued"].includes(proposal.state) && (
              <p
                role="status"
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <LoaderCircle className="size-4 animate-spin" />
                {proposal.state === "preview_pending"
                  ? "Validating in GitHub. Nothing has been added yet."
                  : "GitHub is running the push. You can leave this page and check back."}
              </p>
            )}
            {proposal.phase === "preview" && (
              <Button
                type="button"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void decide(proposal, "decline")}
              >
                Don’t add workout{proposal.workouts.length === 1 ? "" : "s"}
              </Button>
            )}
            {proposal.runUrl && (
              <a
                href={proposal.runUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline underline-offset-4"
              >
                View GitHub run and result
              </a>
            )}
          </div>
        </details>
      ))}
    </section>
  )
}
