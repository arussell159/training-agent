import {formatDuration} from '@/lib/duration'
import {workoutStepLabel, type WorkoutStep} from '@/lib/workout-structure'
import { apiFetch } from "@/lib/api-client"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import {
  AlertCircle,
  Bell,
  Brain,
  Check,
  Dumbbell,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  AssistantRuntimeProvider,
  useExternalStoreRuntime,
  useAuiState,
  type ThreadMessageLike,
} from "@assistant-ui/react"
import { Thread } from "@/components/assistant-ui/elements/thread.aui"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { CoachCitation } from "@/components/coach-citation"
import { Shimmer } from "@/components/ai-elements/shimmer"
import {
  loadCoachConversation,
  loadDailyReview,
  loadTrainingContext,
  type CoachConversationSummary,
  type DailyWorkoutReview,
} from "@/lib/training-context"

type ProposalStatus =
  "pending" | "applying" | "approved" | "rejected" | "failed"

type WorkoutProposal = {
  operation: "create_workout" | "create_workouts" | "update_annual_plan"
  action: Record<string, unknown>
  targetId: string
  targetTitle: string
  current: string
  change: string
  reason: string
  risk: "Low" | "Medium" | "High"
  status: ProposalStatus
}

type CoachMessage = {
  id: string
  role: "assistant" | "user"
  content: string
  created_at: string
  proposal?: WorkoutProposal
  error?: boolean
  contextReviewStartedAt?: number
  contextReviewSeconds?: number
  contextReviewStatus?: string
  contextReviewProgress?: number
  contextReviewKind?: "coach" | "formatter"
}

const CoachActionsContext = createContext<{
  messages: CoachMessage[]
  streamingMessageId: string | null
  approve: (message: CoachMessage) => Promise<void>
  reject: (id: string) => void
  createFromFeedback: (
    message: CoachMessage,
    actionMode: "workouts" | "annual_plan"
  ) => Promise<void>
} | null>(null)

function CoachContextStatus() {
  const id = useAuiState((state) => state.message.id)
  const actions = useContext(CoachActionsContext)
  const message = actions?.messages.find((item) => item.id === id)
  if (
    !message ||
    (message.contextReviewStartedAt === undefined &&
      message.contextReviewSeconds === undefined)
  )
    return null

  const isReviewing = actions?.streamingMessageId === id
  return (
    <div className="mb-4 py-1.5 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <Brain className="size-4 shrink-0" />
        {isReviewing ? (
          <Shimmer duration={1}>
            {message.contextReviewStatus ?? "Reviewing workout context…"}
          </Shimmer>
        ) : (
          <span>
            {message.contextReviewKind === "formatter"
              ? "Prepared the application change"
              : "Reviewed Section 11 training context"}{" "}
            in {message.contextReviewSeconds ?? 1}s
          </span>
        )}
      </div>
      {isReviewing && (
        <div
          className="mt-2 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-label="Section 11 coaching progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={message.contextReviewProgress ?? 5}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
            style={{ width: `${message.contextReviewProgress ?? 5}%` }}
          />
        </div>
      )}
    </div>
  )
}

function CoachMessageFooter() {
  const id = useAuiState((state) => state.message.id)
  const actions = useContext(CoachActionsContext)
  const message = actions?.messages.find((message) => message.id === id)
  if (!actions || !message) return null
  if (message.proposal)
    return (
      <ProposalCard
        proposal={message.proposal}
        onApprove={() => void actions.approve(message)}
        onReject={() => actions.reject(id)}
      />
    )
  const latestAssistant = [...actions.messages]
    .reverse()
    .find((item) => item.role === "assistant")
  if (
    message.role !== "assistant" ||
    message.error ||
    !message.content.trim() ||
    latestAssistant?.id !== message.id ||
    actions.streamingMessageId === message.id
  )
    return null
  return (
    <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void actions.createFromFeedback(message, "workouts")}
      >
        Create structured workouts from this feedback
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => void actions.createFromFeedback(message, "annual_plan")}
      >
        Update annual plan from this feedback
      </Button>
    </div>
  )
}

function messageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

function storageKey(conversationTitle: string, reviewId?: string | null) {
  const suffix = reviewId || conversationTitle
  return `training-coach:${suffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
}

function loadMessages(conversationTitle: string, reviewId?: string | null) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(storageKey(conversationTitle, reviewId)) ?? "null"
    )
    if (Array.isArray(saved) && saved.length) return saved as CoachMessage[]
  } catch {
    // Start a clean local conversation if saved data is invalid.
  }
  return []
}

function conversationTitleFromPrompt(prompt: string) {
  const compact = prompt.trim().replace(/\s+/g, " ")
  const firstPhrase = compact.split(/[.!?]/)[0]?.trim() || compact
  return firstPhrase.slice(0, 56) || "New conversation"
}

function normalizeRecoveryWording(value: string) {
  const allowance = value.match(
    /(?:add no more than|allow up to\s*\+?)\s*(\d+)\s*(?:seconds?|secs?|sec)\s*(?:of\s*)?(?:recovery|rest)\b/i
  )
  if (!allowance) return value
  const seconds = Number(allowance[1])
  const base = value
    .replace(
      /\s*\(\s*allow up to\s*\+?\s*\d+\s*(?:seconds?|secs?|sec)\s*(?:recovery|rest)\s*\)/i,
      ""
    )
    .replace(
      /;\s*maintain the target and\s*(?:add no more than|allow up to\s*\+?)\s*\d+\s*(?:seconds?|secs?|sec)\s*(?:of\s*)?(?:recovery|rest)?(?:\s*if needed)?\s*[.;]?$/i,
      ""
    )
    .replace(/[.;\s]+$/, "")
  return `${base}; maintain the target and increase rest by no more than ${seconds} seconds if needed.`
}

function structuredWorkoutLines(value: unknown, sport: string) {
  if (!value || typeof value !== "object") return []
  const steps = (value as { steps?: WorkoutStep[] }).steps
  if (!Array.isArray(steps)) return []
  const render = (step: WorkoutStep, depth = 0): string[] => {
    if (depth > 8) return []
    if (Array.isArray(step.steps) && step.steps.length) {
      const repetitions = Math.max(1, Number(step.reps || 1))
      const children = step.steps.flatMap((child) => render(child, depth + 1))
      return [`${repetitions}× ${children.join(" / ")}`]
    }
    const label = workoutStepLabel(step, sport)
    return [step.text ? `${label} — ${step.text}` : label]
  }
  return steps.flatMap((step) => render(step))
}

function workoutPreviewText(workout: Record<string, unknown>) {
  const seconds = Number(workout.moving_time || 0)
  const sport = String(workout.type || "Workout")
  const structure = structuredWorkoutLines(workout.workout_doc, sport)
  if (!structure.length) return undefined
  return `${String(workout.date || "Date not set")} · ${sport} · ${formatDuration(Math.round(seconds / 60))}\n${String(workout.name || "Planned workout")}\n\n${String(workout.description || "")}\n\nStructured steps\n${structure.join("\n")}`.trim()
}

function actionProposal(action: Record<string, unknown>): WorkoutProposal | undefined {
  if (action.operation === "create_workout") {
    const workout = action.workout as Record<string, unknown> | undefined
    if (!workout) return undefined
    const change = workoutPreviewText(workout)
    if (!change) return undefined
    return {
      operation: "create_workout",
      action,
      targetId: String(workout.external_id || workout.date || "new-workout"),
      targetTitle: String(workout.name || "Planned workout"),
      current: "No new workout has been uploaded.",
      change,
      reason: "Approval uploads this complete structured workout directly to Intervals.icu.",
      risk: /\b(threshold|vo2|max|all-out)\b/i.test(String(workout.description || "")) ? "Medium" : "Low",
      status: "pending",
    }
  }
  if (action.operation === "create_workouts") {
    const workouts = Array.isArray(action.workouts)
      ? action.workouts as Array<Record<string, unknown>>
      : []
    if (workouts.length < 2) return undefined
    const previews = workouts.map(workoutPreviewText)
    if (previews.some((preview) => !preview)) return undefined
    const dates = workouts.map((workout) => String(workout.date || "")).sort()
    return {
      operation: "create_workouts",
      action,
      targetId: `workout-batch:${dates[0]}:${dates.at(-1)}`,
      targetTitle: `${workouts.length} structured workouts · ${dates[0]}–${dates.at(-1)}`,
      current: "None of these new workouts has been uploaded.",
      change: previews.map((preview, index) => `Workout ${index + 1}\n${preview}`).join("\n\n——————————\n\n"),
      reason: String(action.reason || "Approval uploads this complete workout batch directly to Intervals.icu."),
      risk: workouts.some((workout) => /\b(threshold|vo2|max|all-out)\b/i.test(String(workout.description || ""))) ? "Medium" : "Low",
      status: "pending",
    }
  }
  if (action.operation === "update_annual_plan") {
    const changes = Array.isArray(action.changes) ? action.changes as Array<Record<string, unknown>> : []
    return {
      operation: "update_annual_plan",
      action,
      targetId: String(action.plan_id || "annual-plan"),
      targetTitle: "Annual training plan",
      current: "Your saved annual training plan remains unchanged.",
      change: changes.map((change) => {
        const { week_id: weekId, ...fields } = change
        return `${String(weekId)}: ${Object.entries(fields).map(([key, value]) => `${key.replaceAll("_", " ")} ${typeof value === "object" ? JSON.stringify(value) : String(value)}`).join(" · ")}`
      }).join("\n"),
      reason: String(action.reason || "Apply the requested annual training plan change."),
      risk: "Low",
      status: "pending",
    }
  }
  return undefined
}

function ProposalCard({
  proposal,
  onApprove,
  onReject,
}: {
  proposal: WorkoutProposal
  onApprove: () => void
  onReject: () => void
}) {
  const resolved =
    proposal.status === "approved" || proposal.status === "rejected"

  return (
    <Card className="mt-3 border-primary/20 bg-background" size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Dumbbell className="size-4 text-primary" /> {proposal.targetTitle}
          </CardTitle>
          <Badge variant="outline">{proposal.risk} risk</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Current</p>
          <p className="mt-1 text-sm">{proposal.current}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Proposed</p>
          <p className="mt-1 text-sm leading-6 whitespace-pre-wrap">{proposal.change}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Why</p>
          <p className="mt-1 text-sm leading-6">{proposal.reason}</p>
        </div>

        {resolved ? (
          <div className="flex items-center gap-2 border-t pt-3 text-sm font-medium">
            {proposal.status === "approved" ? (
              <Check className="size-4 text-emerald-600" />
            ) : (
              <X className="size-4 text-muted-foreground" />
            )}
            {proposal.status === "approved"
              ? proposal.operation === "create_workout" || proposal.operation === "create_workouts" ? "Approved and uploaded to Intervals.icu" : "Approved and saved in the application"
              : "Denied — no changes made"}
          </div>
        ) : (
          <div className="flex gap-2 border-t pt-3">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={proposal.status === "applying"}
              onClick={onReject}
            >
              Deny
            </Button>
            <Button
              type="button"
              className="flex-1"
              disabled={proposal.status === "applying"}
              onClick={onApprove}
            >
              {proposal.status === "applying" ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Approve
            </Button>
          </div>
        )}

        {proposal.status === "failed" && (
          <p className="flex items-center gap-2 text-xs text-destructive">
            <AlertCircle className="size-3.5" /> Could not save the adjustment.
            Try again.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function DailyReviewCard({
  review,
  busy,
  message,
  onApprove,
  onDeny,
}: {
  review: DailyWorkoutReview
  busy: boolean
  message: string | null
  onApprove: () => void
  onDeny: () => void
}) {
  const canResolve = false

  if (review.advisory)
    return (
      <section className="space-y-4 px-1 py-2 text-sm leading-6">
        <h2 className="text-xl font-semibold">{review.summary}</h2>
        <p>{review.advisory.condition}</p>
        {review.advisory.suggestions.length > 0 && (
          <div>
            <h3 className="mb-2 font-medium">Possible adjustments</h3>
            <ul className="list-disc space-y-2 pl-5">
              {review.advisory.suggestions.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ul>
          </div>
        )}
        {review.advisory.uncertainty && (
          <p className="text-muted-foreground">{review.advisory.uncertainty}</p>
        )}
      </section>
    )
  return (
    <div className="space-y-8 py-1 text-[15px] leading-7 sm:text-base">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          Today’s recommendation: {review.evidence_status === "insufficient" ? "Wait for more data" : review.changes_proposed ? "Modify" : "Go"}
        </h2>
        <p className="font-semibold">{review.summary}</p>
        <p className="text-muted-foreground">{review.reason}</p>
        {review.evidence_status === "insufficient" ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-foreground">
            No prescription is being presented. Missing evidence is not evidence
            that everything is normal.
          </p>
        ) : null}
      </div>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          Athlete metrics
        </h2>
        <dl className="mt-3 space-y-2 text-muted-foreground">
          <div>
            <dt className="inline font-semibold text-foreground">
              Training-load estimates:{" "}
            </dt>
            <dd className="inline">
              Fitness{" "}
              {review.athlete_metrics?.fitness?.replace(
                /\s*\(training-load estimate\)$/i,
                ""
              ) || "unavailable"}
              ; fatigue{" "}
              {review.athlete_metrics?.fatigue?.replace(
                /\s*\(training-load estimate\)$/i,
                ""
              ) || "unavailable"}
              ; form{" "}
              {review.athlete_metrics?.form?.replace(
                /\s*\(training-load estimate\)$/i,
                ""
              ) || "unavailable"}
              .
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-foreground">Recovery: </dt>
            <dd className="inline">
              {review.athlete_metrics?.recovery || "Unavailable"}
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-foreground">HRV: </dt>
            <dd className="inline">
              {review.athlete_metrics?.hrv || "Unavailable"}
            </dd>
          </div>
          <div>
            <dt className="inline font-semibold text-foreground">
              Resting heart rate:{" "}
            </dt>
            <dd className="inline">
              {review.athlete_metrics?.resting_heart_rate || "Unavailable"}
            </dd>
          </div>
        </dl>
      </div>

      {review.relevant_observations.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">
            Relevant observations
          </h2>
          <ul className="mt-3 list-disc space-y-3 pl-5">
            {review.relevant_observations.map((observation, index) => (
              <li key={index}>{observation}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-9">
        {review.workouts.map((workout) => {
          const targetRanges = workout.execution_guidance.target_ranges?.length
            ? workout.execution_guidance.target_ranges
            : workout.execution_guidance.target_range
              ? [workout.execution_guidance.target_range]
              : []
          return (
            <section
              key={workout.workout_id}
              className="space-y-5 [overflow-wrap:anywhere]"
            >
              <h2 className="text-lg leading-7 font-semibold tracking-tight sm:text-xl">
                {workout.title}
              </h2>
              <div className="space-y-4">
                <div>
                  <h3 className="font-semibold">Proposed change</h3>
                  <p className="mt-1 text-muted-foreground">
                    {workout.proposed_change ||
                      "Follow the session as planned."}
                  </p>
                </div>
                {workout.action !== "follow_as_written" && (
                  <div>
                    <h3 className="font-semibold">Why</h3>
                    <p className="mt-1 text-muted-foreground">
                      {workout.reason}
                    </p>
                  </div>
                )}
                <div>
                  <h3 className="font-semibold">How to approach it</h3>
                  <p className="mt-1 text-muted-foreground">
                    {workout.target_flexibility}
                  </p>
                </div>
                {review.evidence_status === "verified" &&
                  targetRanges.length > 0 && (
                    <div>
                      <h3 className="font-semibold">Pace and rest guidance</h3>
                      <ul className="mt-3 list-disc space-y-3 pl-5 text-muted-foreground marker:text-foreground">
                        {targetRanges.map((range, index) => {
                          const cleanedRange = normalizeRecoveryWording(
                            range.replace(
                              /,\s*\((build|steady|strong)\),/i,
                              ","
                            )
                          )
                          const parts = cleanedRange.match(
                            /^(\d+\s*[x×]\s*\d+\s*(?:yds?|yards?|m|meters?|km|min|minutes?|sec|seconds?)?)\s*(?:[,—–-]\s*)?(.*)$/i
                          )
                          const set = parts?.[1] || cleanedRange
                          const guidance = parts?.[2]
                          return (
                            <li key={index}>
                              <strong className="text-foreground">{set}</strong>
                              {guidance ? (
                                <span className="mt-0.5 block">
                                  — {guidance}
                                </span>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )}
                {workout.evidence ? (
                  <Reasoning className="rounded-lg border bg-muted/25 px-4 py-3 text-sm">
                    <ReasoningTrigger
                      getThinkingMessage={() =>
                        "Evidence and coaching judgment"
                      }
                    />
                    <ReasoningContent>
                      <div className="mt-3 space-y-3 text-muted-foreground">
                        <p>{workout.evidence.reasoning}</p>
                        <p>
                          <span className="font-semibold text-foreground">
                            Coaching judgment:{" "}
                          </span>
                          {workout.evidence.coaching_judgment}
                        </p>
                        <p>
                          <span className="font-semibold text-foreground">
                            Applicability:{" "}
                          </span>
                          {workout.evidence.applicability}
                        </p>
                        {!workout.evidence.published.length ? (
                          <p className="text-xs">
                            No published source was applied; this recommendation
                            is identified as coaching judgment.
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2">
                          {workout.evidence.published.map((source) =>
                            source.url ? (
                              <CoachCitation
                                key={`${source.source_id}:${source.passage_id}`}
                                url={source.url}
                                title={source.title || source.source_id}
                                description={source.locator}
                              />
                            ) : null
                          )}
                        </div>
                      </div>
                    </ReasoningContent>
                  </Reasoning>
                ) : null}
              </div>
            </section>
          )
        })}
      </div>

      {canResolve && (
        <div className="flex gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={busy}
            onClick={onDeny}
          >
            <X className="size-4" /> Deny
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={busy}
            onClick={onApprove}
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}{" "}
            Approve
          </Button>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-xs leading-5 text-muted-foreground">
        <span className="flex items-center gap-1.5 font-semibold">
          <Bell className="size-3.5" /> Notification
        </span>
        <span>
          Daily workout review —{" "}
          {review.notification_summary ||
            (review.changes_proposed
              ? "Workout adjustment suggested."
              : "Proceed as planned.")}
        </span>
      </p>
      {(message || review.apply_error) && (
        <p
          role="status"
          className={`text-sm ${review.status === "apply_failed" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {message || review.apply_error}
        </p>
      )}
    </div>
  )
}

export function TrainingCoach({
  conversationTitle,
  conversationId,
  reviewId,
  onConversationSaved,
}: {
  conversationTitle: string
  conversationId?: string | null
  reviewId?: string | null
  onConversationSaved?: (conversation: CoachConversationSummary) => void
}) {
  const [messages, setMessages] = useState<CoachMessage[]>(() =>
    conversationId || reviewId
      ? loadMessages(conversationId || conversationTitle, reviewId)
      : []
  )
  const [localConversationId] = useState(() => conversationId || messageId())
  const [resolvedTitle, setResolvedTitle] = useState(conversationTitle)
  const [sending, setSending] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(
    null
  )
  const [dailyReview, setDailyReview] = useState<DailyWorkoutReview | null>(
    null
  )
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewMessage, setReviewMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const lastSavedMessages = useRef("")
  const shouldPersistMessages = useRef(false)
  const coachRequest = useRef<AbortController | null>(null)
  const persistentConversationId =
    conversationId || dailyReview?.conversation_id || localConversationId

  useEffect(() => {
    setResolvedTitle(conversationTitle)
  }, [conversationTitle])

  useEffect(() => {
    if (!reviewId) {
      setDailyReview(null)
      return
    }
    setReviewMessage(null)
    void loadDailyReview(reviewId)
      .then(setDailyReview)
      .catch(() =>
        setReviewMessage(
          "This daily review could not be loaded. It may no longer be available."
        )
      )
  }, [reviewId])

  useEffect(() => {
    if (!conversationId && !(reviewId && dailyReview?.conversation_id)) {
      setMessages([])
      return
    }
    let cancelled = false
    const id = conversationId || dailyReview?.conversation_id
    if (!id) return
    void loadCoachConversation(id)
      .then((conversation) => {
        if (cancelled) return
        const reviewMessageId = conversation.review_id
          ? `${conversation.review_id}:coach`
          : null
        const savedMessages = conversation.messages.filter(
          (message) => message.id !== reviewMessageId
        ) as CoachMessage[]
        lastSavedMessages.current = JSON.stringify(savedMessages)
        setMessages(savedMessages)
        setResolvedTitle(conversation.title)
        setSaveError(null)
      })
      .catch((error) => {
        if (!cancelled)
          setSaveError(
            `Saved messages could not be loaded: ${error instanceof Error ? error.message : "Unknown error"}. New messages are still available on this device.`
          )
      })
    return () => {
      cancelled = true
    }
  }, [
    conversationId,
    conversationTitle,
    dailyReview?.conversation_id,
    reviewId,
  ])

  useEffect(() => {
    localStorage.setItem(
      storageKey(persistentConversationId, reviewId),
      JSON.stringify(messages)
    )
  }, [messages, persistentConversationId, reviewId])

  useEffect(() => {
    if (
      sending ||
      !shouldPersistMessages.current ||
      !messages.some((message) => message.role === "user")
    )
      return
    const messageSignature = JSON.stringify(messages)
    if (messageSignature === lastSavedMessages.current) return
    const controller = new AbortController()
    void apiFetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        id: persistentConversationId,
        title: resolvedTitle,
        reviewId,
        messages,
      }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as
          (CoachConversationSummary & { error?: string }) | null
        if (!response.ok || !data)
          throw new Error(
            data?.error || "Supabase did not confirm the conversation save."
          )
        lastSavedMessages.current = messageSignature
        setResolvedTitle(data.title)
        setSaveError(null)
        onConversationSaved?.(data)
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setSaveError(
          error instanceof Error
            ? error.message
            : "Supabase did not confirm the conversation save."
        )
      })
    return () => controller.abort()
  }, [
    messages,
    onConversationSaved,
    persistentConversationId,
    resolvedTitle,
    reviewId,
    sending,
  ])

  async function sendMessage(
    value: string,
    action?: {
      actionMode: "workouts" | "annual_plan"
      sourceFeedback: string
    }
  ) {
    const prompt = value.trim()
    if (!prompt || sending) return
    shouldPersistMessages.current = true
    const request = new AbortController()
    let requestTimeout = window.setTimeout(() => request.abort("coach-timeout"), 45_000)
    const keepRequestAlive = () => {
      window.clearTimeout(requestTimeout)
      requestTimeout = window.setTimeout(
        () => request.abort("coach-timeout"),
        45_000
      )
    }
    coachRequest.current = request

    const userMessage: CoachMessage = {
      id: messageId(),
      role: "user",
      content: prompt,
      created_at: new Date().toISOString(),
    }
    const assistantMessage: CoachMessage = {
      id: messageId(),
      role: "assistant",
      content: "",
      created_at: new Date().toISOString(),
      contextReviewStartedAt: Date.now(),
      contextReviewStatus: action
        ? "Starting the application formatter…"
        : "Starting the official Section 11 coach…",
      contextReviewProgress: 5,
      contextReviewKind: action ? "formatter" : "coach",
    }
    if (!reviewId && resolvedTitle === "Coach")
      setResolvedTitle(conversationTitleFromPrompt(prompt))
    const reviewContext = dailyReview
      ? [{ role: "assistant" as const, content: dailyReview.conversation_text }]
      : []
    const recentHistory = [
      ...reviewContext,
      ...messages.slice(-9).map(({ role, content }) => ({ role, content })),
    ]
    setMessages((current) => [...current, userMessage, assistantMessage])
    setSending(true)
    setStreamingMessageId(assistantMessage.id)

    try {
      const response = await apiFetch("/api/coach", {
        method: "POST",
        signal: request.signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          message: prompt,
          history: action ? [] : recentHistory,
          conversationId: persistentConversationId,
          ...(action ?? {}),
        }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string
        } | null
        throw new Error(
          data?.error || `Coach request failed (${response.status})`
        )
      }
      if (!response.body)
        throw new Error("The coach returned an empty response.")
      keepRequestAlive()

      const contentType = response.headers.get("content-type") || ""
      if (contentType.includes("application/json")) {
        const data = (await response.json()) as {
          message?: string
          error?: string
        }
        if (data.error || !data.message?.trim())
          throw new Error(data.error || "The coach returned an empty response.")
        const content = data.message.trim()
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content }
              : message
          )
        )
        return
      }
      if (!contentType.includes("text/event-stream"))
        throw new Error(
          "The coach API returned an unexpected response. Check the site’s backend deployment."
        )

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let content = ""

      const applyFrame = (frame: string) => {
        const data = frame
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n")
        if (!data || data === "[DONE]") return
        const event = JSON.parse(data) as {
          type?: string
          delta?: string
          message?: string
          proposal?: Record<string, unknown>
          progress?: number
          response?: { error?: { message?: string } }
        }
        if (event.type === "coach.status" && event.message) {
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessage.id
                ? {
                    ...message,
                    contextReviewStatus: event.message,
                    contextReviewProgress:
                      typeof event.progress === "number"
                        ? Math.min(95, Math.max(5, event.progress))
                        : message.contextReviewProgress,
                  }
                : message
            )
          )
        }
        if (event.type === "coach.action.preview" && event.proposal) {
          const proposal = actionProposal(event.proposal)
          if (proposal)
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantMessage.id
                  ? { ...message, proposal }
                  : message
              )
            )
        }
        if (event.type === "response.output_text.delta" && event.delta) {
          content += event.delta
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content }
                : message
            )
          )
        }
        if (
          event.type === "error" ||
          event.type === "response.failed" ||
          event.type === "response.incomplete"
        ) {
          throw new Error(
            event.message ||
              event.response?.error?.message ||
              (event.type === "response.incomplete"
                ? "The coach response was cut off. Please try again."
                : "The coach response failed.")
          )
        }
      }

      while (true) {
        const { value: chunk, done } = await reader.read()
        if (done) break
        keepRequestAlive()
        buffer += decoder.decode(chunk, { stream: true })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ""
        frames.forEach(applyFrame)
      }
      buffer += decoder.decode()
      if (buffer.trim()) applyFrame(buffer)

      content = content.trim()
      if (!content)
        throw new Error(
          "The coach returned an empty response. Please try again."
        )
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? { ...message, content }
            : message
        )
      )
    } catch (error) {
      if (request.signal.aborted) {
        const timedOut=request.signal.reason === "coach-timeout"
        setMessages((current) =>
          current.map((message) =>
            message.id === assistantMessage.id
              ? message.content.trim()
                ? { ...message, error: false }
                : { ...message, content: timedOut ? "The coach took too long to respond. Please try again." : "Response stopped.", error: true }
              : message
          )
        )
        return
      }
      setMessages((current) => [
        ...current.map((message) =>
          message.id === assistantMessage.id
            ? message.content.trim()
              ? { ...message, error: false }
              : {
                  ...message,
                  content:
                    error instanceof Error
                      ? error.message
                      : "The coach is unavailable right now. Please try again.",
                  error: true,
                }
            : message
        ),
      ])
    } finally {
      window.clearTimeout(requestTimeout)
      const contextReviewSeconds = Math.max(
        1,
        Math.ceil((Date.now() - assistantMessage.contextReviewStartedAt!) / 1000)
      )
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? {
                ...message,
                contextReviewStartedAt: undefined,
                contextReviewSeconds,
              }
            : message
        )
      )
      setStreamingMessageId(null)
      setSending(false)
    }
  }

  function updateProposal(messageIdValue: string, status: ProposalStatus) {
    setMessages((current) =>
      current.map((message) =>
        message.id === messageIdValue && message.proposal
          ? { ...message, proposal: { ...message.proposal, status } }
          : message
      )
    )
  }

  async function approveProposal(message: CoachMessage) {
    if (!message.proposal) return
    updateProposal(message.id, "applying")
    try {
      const response = await apiFetch("/api/coach/actions/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          conversationId: persistentConversationId,
          proposal: message.proposal.action,
        }),
      })
      if (!response.ok)
        throw new Error(`Coach action failed (${response.status})`)
      updateProposal(message.id, "approved")
      if (message.proposal.operation === "create_workout" || message.proposal.operation === "create_workouts")
        void loadTrainingContext(true)
      else window.dispatchEvent(new Event("annual-plan-updated"))
    } catch {
      updateProposal(message.id, "failed")
    }
  }

  async function resolveDailyReview(action: "approve" | "deny") {
    if (!dailyReview || reviewBusy) return
    setReviewBusy(true)
    setReviewMessage(null)
    if (action === "approve")
      setDailyReview((current) =>
        current ? { ...current, status: "applying" } : current
      )
    try {
      const response = await apiFetch(
        `/api/daily-reviews/${encodeURIComponent(dailyReview.id)}/${action}`,
        {
          method: "POST",
          headers: { Accept: "application/json" },
        }
      )
      const data = (await response.json().catch(() => null)) as {
        review?: DailyWorkoutReview
        error?: string
        refreshed?: boolean
      } | null
      if (data?.review) setDailyReview(data.review)
      if (!response.ok) {
        setReviewMessage(
          data?.error ||
            `The daily review could not be ${action === "approve" ? "applied" : "denied"}.`
        )
        return
      }
      setReviewMessage(
        action === "approve"
          ? "Intervals.icu confirmed the displayed changes."
          : "Decision recorded. The existing workout remains unchanged."
      )
      if (action === "approve") void loadTrainingContext(true)
    } catch (error) {
      setDailyReview(dailyReview)
      setReviewMessage(
        error instanceof Error
          ? error.message
          : "The daily review could not be updated."
      )
    } finally {
      setReviewBusy(false)
    }
  }

  const runtime = useExternalStoreRuntime<CoachMessage>({
    isRunning: sending,
    messages,
    convertMessage: (message): ThreadMessageLike => ({
      id: message.id,
      role: message.role,
      content: [{ type: "text", text: message.content }],
      createdAt: new Date(message.created_at),
      ...(message.role === "assistant"
        ? {
            status: message.error
              ? {
                  type: "incomplete" as const,
                  reason: "error" as const,
                  error: message.content,
                }
              : message.id === streamingMessageId
                ? { type: "running" as const }
                : { type: "complete" as const, reason: "stop" as const },
          }
        : {}),
    }),
    onNew: async (message) => {
      const text = message.content
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
      await sendMessage(text)
    },
    onCancel: async () => {
      coachRequest.current?.abort()
    },
  })

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <CoachActionsContext.Provider
        value={{
          messages,
          streamingMessageId,
          approve: approveProposal,
          reject: (id) => updateProposal(id, "rejected"),
          createFromFeedback: async (message, actionMode) => {
            await sendMessage(
              actionMode === "workouts"
                ? "Create structured workouts from this feedback"
                : "Update my annual training plan from this feedback",
              { actionMode, sourceFeedback: message.content }
            )
          },
        }}
      >
        <Thread
          autoFocus={false}
          components={{
            MessageHeader: CoachContextStatus,
            MessageFooter: CoachMessageFooter,
          }}
          header={
            reviewId ? (
              <div className="mb-6 px-2">
                {!dailyReview && !reviewMessage && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" /> Loading the
                    saved daily review…
                  </p>
                )}
                {!dailyReview && reviewMessage && (
                  <p className="text-sm text-destructive">{reviewMessage}</p>
                )}
                {dailyReview && (
                  <>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Sparkles className="size-3.5 text-primary" /> AR
                      Performance · {dailyReview.local_date}
                    </div>
                    <DailyReviewCard
                      review={dailyReview}
                      busy={reviewBusy}
                      message={reviewMessage}
                      onApprove={() => void resolveDailyReview("approve")}
                      onDeny={() => void resolveDailyReview("deny")}
                    />
                  </>
                )}
              </div>
            ) : undefined
          }
          notice={
            saveError ? (
              <p role="status" className="px-2 text-xs text-destructive">
                {saveError}
              </p>
            ) : undefined
          }
        />
      </CoachActionsContext.Provider>
    </AssistantRuntimeProvider>
  )
}
