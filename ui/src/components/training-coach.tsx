import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  AlertCircle,
  Bell,
  Check,
  Dumbbell,
  LoaderCircle,
  Send,
  Sparkles,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Textarea } from "@/components/ui/textarea"
import {
  fallbackTrainingContext,
  loadCoachConversation,
  loadDailyReview,
  loadTrainingContext,
  type CoachConversationSummary,
  type DailyWorkoutReview,
  type PlannedWorkout,
  type TrainingContext,
} from "@/lib/training-context"

type ProposalStatus = "pending" | "applying" | "approved" | "rejected" | "failed"

type WorkoutProposal = {
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
}

function inlineMarkdown(value: string): ReactNode[] {
  return value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <strong key={index}>{part.slice(2, -2)}</strong>
      : part
  )
}

function FormattedCoachText({ content }: { content: string }) {
  const blocks: ReactNode[] = []
  let paragraph: string[] = []
  let bullets: string[] = []
  const flushParagraph = () => {
    if (!paragraph.length) return
    blocks.push(<p key={`p-${blocks.length}`} className="whitespace-pre-wrap">{inlineMarkdown(paragraph.join("\n"))}</p>)
    paragraph = []
  }
  const flushBullets = () => {
    if (!bullets.length) return
    blocks.push(<ul key={`ul-${blocks.length}`} className="list-disc space-y-2 pl-5">{bullets.map((item, index) => <li key={index}>{inlineMarkdown(item)}</li>)}</ul>)
    bullets = []
  }
  for (const line of content.split(/\r?\n/)) {
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)
    if (bullet) {
      flushParagraph()
      bullets.push(bullet[1])
    } else if (!line.trim()) {
      flushParagraph()
      flushBullets()
    } else {
      flushBullets()
      paragraph.push(line.replace(/^#{1,6}\s+/, "**") + (/^#{1,6}\s+/.test(line) ? "**" : ""))
    }
  }
  flushParagraph()
  flushBullets()
  return <div className="space-y-3">{blocks}</div>
}

function messageId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

function initialMessage(conversationTitle: string): CoachMessage {
  return {
    id: messageId(),
    role: "assistant",
    created_at: new Date().toISOString(),
    content:
      conversationTitle === "Coach"
        ? "Tell me what’s going on. I’ll use your recent training, recovery, comments, current plan, and race context—not generic advice."
        : `Continuing “${conversationTitle}.” What do you want to work through?`,
  }
}

function storageKey(conversationTitle: string, reviewId?: string | null) {
  const suffix = reviewId || conversationTitle
  return `training-coach:${suffix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`
}

function loadMessages(conversationTitle: string, reviewId?: string | null) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(conversationTitle, reviewId)) ?? "null")
    if (Array.isArray(saved) && saved.length) return saved as CoachMessage[]
  } catch {
    // Start a clean local conversation if saved data is invalid.
  }
  return reviewId ? [] : [initialMessage(conversationTitle)]
}

function conversationTitleFromPrompt(prompt: string) {
  const compact = prompt.trim().replace(/\s+/g, " ")
  const firstPhrase = compact.split(/[.!?]/)[0]?.trim() || compact
  return firstPhrase.slice(0, 56) || "New conversation"
}

function selectTargetWorkout(context: TrainingContext, prompt: string) {
  const normalized = prompt.toLowerCase()
  const candidates = [...context.planned]
    .filter((workout) => workout.status !== "completed")
    .sort((a, b) => String(a.workout_date).localeCompare(String(b.workout_date)))
  if (!candidates.length) return undefined

  const today = context.planned.find((workout) => workout.status === "today")
  if (normalized.includes("today") && today) return today

  const dayNames: Array<[string, string]> = [
    ["monday", "MON"],
    ["tuesday", "TUE"],
    ["wednesday", "WED"],
    ["thursday", "THU"],
    ["friday", "FRI"],
    ["saturday", "SAT"],
    ["sunday", "SUN"],
  ]
  const requestedDay = dayNames.find(([name]) => normalized.includes(name))?.[1]
  const dayMatch = requestedDay
    ? candidates.find((workout) => workout.day.toUpperCase() === requestedDay)
    : undefined
  if (dayMatch) return dayMatch

  const requestedSport = ["swim", "bike", "run", "brick", "strength"].find(
    (sport) => normalized.includes(sport)
  )
  const sportMatch = requestedSport
    ? candidates.find((workout) => workout.sport.toLowerCase().includes(requestedSport))
    : undefined
  if (sportMatch) return sportMatch

  if (normalized.includes("tomorrow") && today?.workout_date) {
    const todayDate = today.workout_date
    return candidates.find((workout) => Boolean(workout.workout_date && workout.workout_date > todayDate)) ?? candidates[0]
  }
  return today ?? candidates[0]
}

function isWorkoutChangeRequest(prompt: string, response: string) {
  const asksForChange =
    /\b(adjust|change|shorten|reduce|increase|replace|swap|move|skip|cancel|make|create|build|write|plan)\b/i.test(
      prompt
    ) && /\b(workout|session|swim|bike|ride|run|brick|strength)\b/i.test(prompt)
  const proposesChange =
    /\b(propose|recommend|adjust|change|replace|swap|shorten|reduce|increase|workout)\b/i.test(
      response
    )
  return asksForChange && proposesChange
}

function proposalRisk(response: string): WorkoutProposal["risk"] {
  if (/\b(max|all-out|very high risk|race simulation)\b/i.test(response)) return "High"
  if (/\b(threshold|vo2|hard|longer|increase|medium risk)\b/i.test(response)) return "Medium"
  return "Low"
}

function createProposal(
  workout: PlannedWorkout,
  response: string,
  context: TrainingContext
): WorkoutProposal {
  return {
    targetId: workout.id,
    targetTitle: workout.title,
    current: `${workout.date} · ${workout.title} · ${workout.duration}`,
    change: response,
    reason: `Based on your request, recent execution and recovery, and the ${context.athlete.phase ?? "current"} phase for ${context.athlete.race ?? "your goal event"}.`,
    risk: proposalRisk(response),
    status: "pending",
  }
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
  const resolved = proposal.status === "approved" || proposal.status === "rejected"

  return (
    <Card className="mt-3 border-primary/20 bg-background" size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Dumbbell className="size-4 text-primary" /> Proposed workout change
          </CardTitle>
          <Badge variant="outline">{proposal.risk} risk</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">Current plan</p>
          <p className="mt-1 text-sm">{proposal.current}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Proposed change</p>
          <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{proposal.change}</p>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Reason</p>
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
              ? "Approved and saved"
              : "Rejected — original workout kept"}
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
            <AlertCircle className="size-3.5" /> Could not save the adjustment. Try again.
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
  const canResolve = review.changes_proposed && ["pending_approval", "apply_failed"].includes(review.status)

  return (
    <div className="space-y-8 py-1 text-[15px] leading-7 sm:text-base">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">{review.summary}</h2>
        <p className="text-muted-foreground">{review.reason}</p>
      </div>

      <div>
        <h2 className="text-lg font-semibold tracking-tight">Athlete metrics</h2>
        <dl className="mt-3 space-y-2 text-muted-foreground">
          <div><dt className="inline font-semibold text-foreground">Training-load estimates: </dt><dd className="inline">Fitness {review.athlete_metrics?.fitness?.replace(/\s*\(training-load estimate\)$/i, "") || "unavailable"}; fatigue {review.athlete_metrics?.fatigue?.replace(/\s*\(training-load estimate\)$/i, "") || "unavailable"}; form {review.athlete_metrics?.form?.replace(/\s*\(training-load estimate\)$/i, "") || "unavailable"}.</dd></div>
          <div><dt className="inline font-semibold text-foreground">Recovery: </dt><dd className="inline">{review.athlete_metrics?.recovery || "Unavailable"}</dd></div>
          <div><dt className="inline font-semibold text-foreground">HRV: </dt><dd className="inline">{review.athlete_metrics?.hrv || "Unavailable"}</dd></div>
          <div><dt className="inline font-semibold text-foreground">Resting heart rate: </dt><dd className="inline">{review.athlete_metrics?.resting_heart_rate || "Unavailable"}</dd></div>
        </dl>
      </div>

      {review.relevant_observations.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Relevant observations</h2>
          <ul className="mt-3 list-disc space-y-3 pl-5">
            {review.relevant_observations.map((observation, index) => <li key={index}>{observation}</li>)}
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
            <section key={workout.workout_id} className="space-y-5 [overflow-wrap:anywhere]">
              <h2 className="text-lg font-semibold leading-7 tracking-tight sm:text-xl">{workout.title}</h2>
              <div className="space-y-4">
                <div><h3 className="font-semibold">Proposed change</h3><p className="mt-1 text-muted-foreground">{workout.proposed_change || "Follow the session as planned."}</p></div>
                {workout.action !== "follow_as_written" && <div><h3 className="font-semibold">Why</h3><p className="mt-1 text-muted-foreground">{workout.reason}</p></div>}
                <div><h3 className="font-semibold">How to approach it</h3><p className="mt-1 text-muted-foreground">{workout.target_flexibility}</p></div>
                {targetRanges.length > 0 && (
                  <div>
                    <h3 className="font-semibold">Pace and rest guidance</h3>
                    <ul className="mt-3 list-disc space-y-3 pl-5 text-muted-foreground marker:text-foreground">
                      {targetRanges.map((range, index) => {
                        const cleanedRange = range.replace(/,\s*\((build|steady|strong)\),/i, ",")
                        const parts = cleanedRange.match(/^(\d+\s*[x×]\s*\d+\s*(?:yds?|yards?|m|meters?|km|min|minutes?|sec|seconds?)?)\s*(?:[,—–-]\s*)?(.*)$/i)
                        const set = parts?.[1] || cleanedRange
                        const guidance = parts?.[2]
                        return <li key={index}><strong className="text-foreground">{set}</strong>{guidance ? <span className="mt-0.5 block">— {guidance}</span> : null}</li>
                      })}
                    </ul>
                  </div>
                )}
              </div>
            </section>
          )
        })}
      </div>

      {canResolve && (
        <div className="flex gap-2 pt-2">
          <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={onDeny}>
            <X className="size-4" /> Deny
          </Button>
          <Button type="button" className="flex-1" disabled={busy} onClick={onApprove}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />} Approve
          </Button>
        </div>
      )}
      <p className="flex flex-wrap items-center gap-x-2 text-xs leading-5 text-muted-foreground">
        <span className="flex items-center gap-1.5 font-semibold"><Bell className="size-3.5" /> Notification</span>
        <span>Daily workout review — {review.notification_summary || (review.changes_proposed ? "Workout adjustment suggested." : "Proceed as planned.")}</span>
      </p>
      {(message || review.apply_error) && (
        <p role="status" className={`text-sm ${review.status === "apply_failed" ? "text-destructive" : "text-muted-foreground"}`}>
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
    loadMessages(conversationId || conversationTitle, reviewId)
  )
  const [localConversationId] = useState(() => conversationId || messageId())
  const [resolvedTitle, setResolvedTitle] = useState(conversationTitle)
  const [context, setContext] = useState(fallbackTrainingContext)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null)
  const [dailyReview, setDailyReview] = useState<DailyWorkoutReview | null>(null)
  const [reviewBusy, setReviewBusy] = useState(false)
  const [reviewMessage, setReviewMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const lastSavedMessages = useRef("")
  const shouldPersistMessages = useRef(false)
  const reviewViewportRef = useRef<HTMLDivElement>(null)
  const persistentConversationId = conversationId || dailyReview?.conversation_id || localConversationId
  const dailyReviewRevision = dailyReview?.revision

  useEffect(() => {
    setResolvedTitle(conversationTitle)
  }, [conversationTitle])

  useEffect(() => {
    void loadTrainingContext().then(setContext)
  }, [])

  useEffect(() => {
    if (!reviewId) {
      setDailyReview(null)
      return
    }
    setReviewMessage(null)
    void loadDailyReview(reviewId)
      .then(setDailyReview)
      .catch(() => setReviewMessage("This daily review could not be loaded. It may no longer be available."))
  }, [reviewId])

  useEffect(() => {
    if (!reviewId || dailyReviewRevision == null) return
    const startedAt = performance.now()
    let frame = 0
    const scrollToStart = () => {
      if (reviewViewportRef.current) reviewViewportRef.current.scrollTop = 0
      if (performance.now() - startedAt < 1000) frame = window.requestAnimationFrame(scrollToStart)
    }
    frame = window.requestAnimationFrame(scrollToStart)
    return () => {
      window.cancelAnimationFrame(frame)
    }
  }, [reviewId, dailyReviewRevision])

  useEffect(() => {
    if (!conversationId && !(reviewId && dailyReview?.conversation_id)) {
      setMessages(loadMessages(conversationTitle, reviewId))
      return
    }
    let cancelled = false
    const id = conversationId || dailyReview?.conversation_id
    if (!id) return
    void loadCoachConversation(id)
      .then((conversation) => {
        if (cancelled) return
        const reviewMessageId = conversation.review_id ? `${conversation.review_id}:coach` : null
        const savedMessages = conversation.messages.filter((message) => message.id !== reviewMessageId) as CoachMessage[]
        lastSavedMessages.current = JSON.stringify(savedMessages)
        setMessages(savedMessages)
        setResolvedTitle(conversation.title)
        setSaveError(null)
      })
      .catch(() => {
        if (!cancelled) setSaveError("Saved messages could not be loaded. New messages are still available on this device.")
      })
    return () => { cancelled = true }
  }, [conversationId, conversationTitle, dailyReview?.conversation_id, reviewId])

  useEffect(() => {
    localStorage.setItem(storageKey(persistentConversationId, reviewId), JSON.stringify(messages))
  }, [messages, persistentConversationId, reviewId])

  useEffect(() => {
    if (sending || !shouldPersistMessages.current || !messages.some((message) => message.role === "user")) return
    const messageSignature = JSON.stringify(messages)
    if (messageSignature === lastSavedMessages.current) return
    const controller = new AbortController()
    void fetch("/api/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal:controller.signal,
      body: JSON.stringify({ id:persistentConversationId, title:resolvedTitle, reviewId, messages }),
    })
      .then(async (response) => {
        const data = (await response.json().catch(() => null)) as (CoachConversationSummary & { error?: string }) | null
        if (!response.ok || !data) throw new Error(data?.error || "Supabase did not confirm the conversation save.")
        lastSavedMessages.current = messageSignature
        setSaveError(null)
        onConversationSaved?.(data)
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return
        setSaveError(error instanceof Error ? error.message : "Supabase did not confirm the conversation save.")
      })
    return () => controller.abort()
  }, [messages, onConversationSaved, persistentConversationId, resolvedTitle, reviewId, sending])

  async function sendMessage(value: string) {
    const prompt = value.trim()
    if (!prompt || sending) return
    shouldPersistMessages.current = true

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
    }
    if (!reviewId && resolvedTitle === "Coach") setResolvedTitle(conversationTitleFromPrompt(prompt))
    const reviewContext = dailyReview ? [{ role:"assistant" as const, content:dailyReview.conversation_text }] : []
    const recentHistory = [...reviewContext, ...messages.slice(-9).map(({ role, content }) => ({ role, content }))]
    setMessages((current) => [...current, userMessage, assistantMessage])
    setDraft("")
    setSending(true)
    setStreamingMessageId(assistantMessage.id)

    try {
      const response = await fetch("/api/coach", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify({ message: prompt, history: recentHistory, conversationId:persistentConversationId }),
      })
      if (!response.ok) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        throw new Error(data?.error || `Coach request failed (${response.status})`)
      }
      if (!response.body) throw new Error("The coach returned an empty response.")

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
          response?: { error?: { message?: string } }
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
        buffer += decoder.decode(chunk, { stream: true })
        const frames = buffer.split(/\r?\n\r?\n/)
        buffer = frames.pop() ?? ""
        frames.forEach(applyFrame)
      }
      buffer += decoder.decode()
      if (buffer.trim()) applyFrame(buffer)

      content = content.trim() || "I couldn’t generate a coaching response."
      const target = selectTargetWorkout(context, prompt)
      const proposal =
        target && isWorkoutChangeRequest(prompt, content)
          ? createProposal(target, content, context)
          : undefined
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantMessage.id
            ? { ...message, content, proposal }
            : message
        )
      )
    } catch (error) {
      setMessages((current) => [
        ...current.map((message) =>
          message.id === assistantMessage.id
            ? {
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
      const response = await fetch(
        `/api/workouts/${encodeURIComponent(message.proposal.targetId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            change: message.proposal.change,
            title: message.proposal.targetTitle,
          }),
        }
      )
      if (!response.ok) throw new Error(`Workout update failed (${response.status})`)
      updateProposal(message.id, "approved")
    } catch {
      updateProposal(message.id, "failed")
    }
  }

  async function resolveDailyReview(action: "approve" | "deny") {
    if (!dailyReview || reviewBusy) return
    setReviewBusy(true)
    setReviewMessage(null)
    if (action === "approve") setDailyReview((current) => current ? { ...current, status:"applying" } : current)
    try {
      const response = await fetch(`/api/daily-reviews/${encodeURIComponent(dailyReview.id)}/${action}`, {
        method:"POST",
        headers:{ Accept:"application/json" },
      })
      const data = (await response.json().catch(() => null)) as { review?: DailyWorkoutReview; error?: string; refreshed?: boolean } | null
      if (data?.review) setDailyReview(data.review)
      if (!response.ok) {
        setReviewMessage(data?.error || `The daily review could not be ${action === "approve" ? "applied" : "denied"}.`)
        return
      }
      setReviewMessage(action === "approve" ? "TrainingPeaks confirmed the displayed changes." : "Decision recorded. The existing workout remains unchanged.")
      if (action === "approve") void loadTrainingContext(true).then(setContext)
    } catch (error) {
      setDailyReview(dailyReview)
      setReviewMessage(error instanceof Error ? error.message : "The daily review could not be updated.")
    } finally {
      setReviewBusy(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden bg-background">
      <MessageScrollerProvider
        autoScroll={!reviewId || messages.length > 0 || sending}
        defaultScrollPosition={reviewId ? "start" : "last-anchor"}
        scrollPreviousItemPeek={56}
      >
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport
            ref={reviewViewportRef}
            aria-label="Coach conversation"
            className="[scrollbar-gutter:auto] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <MessageScrollerContent
              aria-busy={sending}
              className="mx-auto w-full max-w-3xl px-3 py-5 sm:px-5 md:px-8 md:py-8"
            >
              {reviewId && !dailyReview && !reviewMessage && (
                <MessageScrollerItem messageId="daily-review-loading">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" /> Loading the saved daily review…
                  </div>
                </MessageScrollerItem>
              )}
              {reviewId && !dailyReview && reviewMessage && (
                <MessageScrollerItem messageId="daily-review-error">
                  <p className="text-sm text-destructive">{reviewMessage}</p>
                </MessageScrollerItem>
              )}
              {dailyReview && (
                <MessageScrollerItem messageId={dailyReview.id}>
                  <div className="mr-auto w-full max-w-none sm:max-w-2xl">
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                      <Sparkles className="size-3.5 text-primary" /> AR Performance · {dailyReview.local_date}
                    </div>
                    <DailyReviewCard
                      review={dailyReview}
                      busy={reviewBusy}
                      message={reviewMessage}
                      onApprove={() => void resolveDailyReview("approve")}
                      onDeny={() => void resolveDailyReview("deny")}
                    />
                  </div>
                </MessageScrollerItem>
              )}
              {messages.map((message) => (
                <MessageScrollerItem
                  key={message.id}
                  messageId={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <div
                    className={
                      message.role === "user"
                        ? "ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-3 text-primary-foreground"
                        : "mr-auto max-w-[92%] sm:max-w-[85%]"
                    }
                  >
                    {message.role === "assistant" && (
                      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
                        <Sparkles className="size-3.5 text-primary" /> AR Performance
                      </div>
                    )}
                    <div
                      aria-live={message.role === "assistant" ? "polite" : undefined}
                      className={`text-sm leading-6 ${message.error ? "text-destructive" : ""}`}
                    >
                      {message.role === "assistant" ? <FormattedCoachText content={message.content} /> : <p className="whitespace-pre-wrap">{message.content}</p>}
                      {message.id === streamingMessageId && (
                        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-current align-[-2px]" />
                      )}
                    </div>
                    {message.proposal && (
                      <ProposalCard
                        proposal={message.proposal}
                        onApprove={() => void approveProposal(message)}
                        onReject={() => updateProposal(message.id, "rejected")}
                      />
                    )}
                  </div>
                </MessageScrollerItem>
              ))}

              {sending && !messages.some((message) => message.id === streamingMessageId && message.content) && (
                <MessageScrollerItem messageId="coach-thinking">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" /> Reviewing your training context…
                  </div>
                </MessageScrollerItem>
              )}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>

      <footer className="shrink-0 bg-background px-3 pb-2 pt-2 sm:px-4 sm:pb-3 sm:pt-3">
        <div className="mx-auto w-full max-w-3xl">
          {saveError && <p role="status" className="mb-2 text-xs text-destructive">{saveError}</p>}
          <form
            className="flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm"
            onSubmit={(event) => {
              event.preventDefault()
              void sendMessage(draft)
            }}
          >
            <Textarea
              value={draft}
              rows={1}
              disabled={sending}
              aria-label="Message your coach"
              placeholder="Ask about training..."
              className="max-h-[6.5rem] min-h-10 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2 leading-5 shadow-none focus-visible:ring-0"
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault()
                  void sendMessage(draft)
                }
              }}
            />
            <Button
              type="submit"
              size="icon-lg"
              aria-label="Send message"
              disabled={sending || !draft.trim()}
            >
              {sending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
        </div>
      </footer>
    </div>
  )
}
