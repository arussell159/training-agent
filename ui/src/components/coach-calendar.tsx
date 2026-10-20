import { useEffect, useRef, useState } from "react"
import { LoaderCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { coachRequest, type CalendarProposal } from "@/lib/coach-client"
import {
  acceptCoachSchedulingReceipt,
  confirmCoachWorkouts,
} from "@/lib/training-context"
import { withRequestDeadline } from "@/lib/request-deadline"

const readProposal = <T,>(path: string, signal?: AbortSignal, data?: object) =>
  withRequestDeadline(
    async (requestSignal) =>
      (await coachRequest(path, data, requestSignal)).json() as Promise<T>,
    30_000,
    signal,
    "The calendar status could not be loaded. Try checking it again."
  )

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
const validProposal = (p: CalendarProposal) =>
  p &&
  typeof p.id === "string" &&
  Object.hasOwn(labels, p.state) &&
  Array.isArray(p.workouts) &&
  p.workouts.every(
    (w) =>
      w &&
      typeof w.name === "string" &&
      typeof w.date === "string" &&
      typeof w.description === "string"
  )

export function CoachCalendar({ refreshKey }: { refreshKey: number }) {
  const [proposals, setProposals] = useState<CalendarProposal[]>([])
  const [busy, setBusy] = useState<{
    id: string
    action: "confirm" | "decline"
  } | null>(null)
  const [error, setError] = useState("")
  const [revision, setRevision] = useState(0)
  const latest = useRef<CalendarProposal[]>([])
  const deciding = useRef(false)

  useEffect(() => {
    const abort = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    let reading = false
    async function refresh() {
      if (reading || abort.signal.aborted) return
      reading = true
      clearTimeout(timer)
      let polling = false
      try {
        if (document.hidden) return
        const result = await readProposal<{ proposals: CalendarProposal[] }>(
          "calendar",
          abort.signal
        )
        if (!Array.isArray(result.proposals))
          throw Error("Calendar proposals could not be loaded.")
        if (!result.proposals.every(validProposal))
          throw Error("Calendar proposals could not be loaded.")
        const pending = result.proposals
          .filter((p) =>
            ["preview_pending", "queued", "unknown"].includes(p.state)
          )
          .slice(0, 4)
        const updated = await Promise.allSettled(
          pending.map(async (p) => {
            return readProposal<CalendarProposal>(
              `calendar/${p.id}`,
              abort.signal
            )
          })
        )
        if (abort.signal.aborted) return
        if (
          updated.some(
            (r) => r.status === "fulfilled" && !validProposal(r.value)
          )
        )
          throw Error("Calendar status could not be verified.")
        const fresh = new Map(
          updated
            .filter((r) => r.status === "fulfilled")
            .map((r) => [r.value.id, r.value])
        )
        const next = result.proposals.map((p) => fresh.get(p.id) || p)
        for (const proposal of next) {
          const previous = latest.current.find(
            (item) => item.id === proposal.id
          )
          if (
            previous &&
            previous.state !== "applied" &&
            proposal.state === "applied" &&
            proposal.transport === "direct"
          )
            acceptCoachSchedulingReceipt(proposal)
        }
        latest.current = next
        setProposals(next)
        polling = next.some((p) =>
          ["preview_pending", "queued", "unknown"].includes(p.state)
        )
        const failed = updated.find((r) => r.status === "rejected")
        setError(
          failed?.status === "rejected"
            ? failed.reason instanceof Error
              ? failed.reason.message
              : "Unable to check calendar status."
            : ""
        )
      } catch (problem) {
        if (
          !abort.signal.aborted &&
          (problem as { status?: number }).status !== 503
        )
          setError(
            problem instanceof Error
              ? problem.message
              : "Unable to check calendar proposals."
          )
      } finally {
        reading = false
        if (!abort.signal.aborted && polling)
          timer = setTimeout(() => void refresh(), 15000)
      }
    }
    void refresh()
    const visible = () => {
      if (!document.hidden) void refresh()
    }
    document.addEventListener("visibilitychange", visible)
    return () => {
      abort.abort()
      clearTimeout(timer)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [refreshKey, revision])

  async function decide(
    proposal: CalendarProposal,
    action: "confirm" | "decline"
  ) {
    if (deciding.current) return
    deciding.current = true
    setBusy({ id: proposal.id, action })
    setError("")
    try {
      const updated =
        action === "confirm"
          ? await confirmCoachWorkouts(proposal)
          : await readProposal<CalendarProposal>(
              `calendar/${proposal.id}/decline`,
              undefined,
              {}
            )
      setProposals((current) =>
        current.map((p) => (p.id === updated.id ? updated : p))
      )
    } catch (problem) {
      const updated = (problem as { proposal?: CalendarProposal }).proposal
      if (updated)
        setProposals((current) =>
          current.map((p) => (p.id === updated.id ? updated : p))
        )
      setError(
        problem instanceof Error
          ? problem.message
          : action === "decline"
            ? "Unable to dismiss this workout. Please try again."
            : "Unable to confirm the push. Check its status before retrying."
      )
    } finally {
      setBusy(null)
      deciding.current = false
      setRevision((value) => value + 1)
    }
  }

  const visible = proposals.filter(
    (proposal) => !["applied", "declined"].includes(proposal.state)
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
          {proposal.transport === "direct" &&
            proposal.phase === "push" &&
            proposal.state === "unknown" && (
              <Button
                type="button"
                disabled={busy !== null}
                onClick={() => void decide(proposal, "confirm")}
              >
                {busy?.id === proposal.id ? "Checking…" : "Recheck & finish"}
              </Button>
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
