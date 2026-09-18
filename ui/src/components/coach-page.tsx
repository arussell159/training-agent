import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { LoaderCircle, LockKeyhole, Square } from "lucide-react"
import "./coach-prose.css"
import { Button } from "@/components/ui/button"
import {
  ChainOfThought,
  ChainOfThoughtContent,
  ChainOfThoughtHeader,
  ChainOfThoughtStep,
} from "@/components/ai-elements/chain-of-thought"
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationSource,
  InlineCitationText,
} from "@/components/ai-elements/inline-citation"
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message"
import {
  PromptInput,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "@/components/ai-elements/prompt-input"
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning"
import { CoachCalendar } from "@/components/coach-calendar"
import {
  askCoach,
  coachRequest,
  type CoachMessage,
  type CoachProgressStep,
  type CoachSession,
  type CoachSource,
} from "@/lib/coach-client"

const suggestions = [
  "How was today’s workout?",
  "Am I ready for tomorrow’s session?",
  "Review my training this week.",
]

const initialProgress: CoachProgressStep[] = [
  {
    id: "context",
    label: "Read training context",
    description: "Loading the latest training data and Section 11 guidance.",
    status: "active",
  },
]

function progressDescriptor(status: string) {
  const text = status.toLowerCase()
  if (text.includes("section 11")) {
    return {
      id: "protocol",
      label: "Check Section 11 guidance",
      description: status,
    }
  }
  if (text.includes("training details")) {
    return {
      id: "training",
      label: "Read requested training details",
      description: status,
    }
  }
  if (text.includes("calendar")) {
    return {
      id: "calendar",
      label: "Prepare calendar preview",
      description: status,
    }
  }
  if (text.includes("reviewing")) {
    return {
      id: "review",
      label: "Review source details",
      description: status,
    }
  }
  if (text.includes("pause") || text.includes("retry")) {
    return {
      id: "retry",
      label: "Reconnect to the coach",
      description: status,
    }
  }
  return {
    id: "context",
    label: "Read training context",
    description: status,
  }
}

function advanceProgress(steps: CoachProgressStep[], status: string) {
  const descriptor = progressDescriptor(status)
  const next = steps.map((step) =>
    step.status === "active" ? { ...step, status: "complete" as const } : step
  )
  const existing = next.findIndex((step) => step.id === descriptor.id)
  if (existing >= 0) {
    next[existing] = { ...next[existing], ...descriptor, status: "active" }
  } else {
    next.push({ ...descriptor, status: "active" })
  }
  return next
}

function completeProgress(steps: CoachProgressStep[]) {
  return steps.map((step) => ({ ...step, status: "complete" as const }))
}

function progressSummary(steps: CoachProgressStep[]) {
  return (
    steps.find((step) => step.status === "active")?.description ||
    "The coach used the current training context and the official Section 11 guidance."
  )
}

export function CoachPage() {
  const [session, setSession] = useState<CoachSession | null>(null)
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [source, setSource] = useState<CoachSource | null>(null)
  const [calendarRevision, setCalendarRevision] = useState(0)
  const progress = useRef<CoachProgressStep[]>([])
  const streamedAnswer = useRef("")
  const controller = useRef<AbortController | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)
  const input = useRef<HTMLTextAreaElement | null>(null)

  useLayoutEffect(() => {
    const field = input.current
    if (!field) return
    field.style.height = "auto"
    field.style.height = Math.min(144, Math.max(44, field.scrollHeight)) + "px"
  }, [draft])

  async function checkSession(signal?: AbortSignal) {
    try {
      const response = await coachRequest("session", undefined, signal)
      setSession(await response.json())
      setError("")
    } catch (problem) {
      if (!signal?.aborted)
        setError(
          problem instanceof Error
            ? problem.message
            : "Unable to check the coach connection."
        )
    }
  }
  useEffect(() => {
    const check = new AbortController()
    void checkSession(check.signal)
    return () => {
      check.abort()
      controller.current?.abort()
    }
  }, [])
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" })
  }, [messages, status, calendarRevision])

  async function send(text = draft) {
    const question = text.trim()
    if (!question || busy || controller.current || !session?.authenticated)
      return
    const previous = messages
    const next: CoachMessage[] = [
      ...previous,
      { role: "user", content: question },
    ]
    const abort = new AbortController()
    controller.current = abort
    setMessages(next)
    setDraft("")
    setBusy(true)
    setError("")
    setSource(null)
    setStatus("Connecting to your coach…")
    progress.current = initialProgress
    streamedAnswer.current = ""
    setMessages([
      ...next,
      { role: "assistant", content: "", progress: initialProgress },
    ])
    try {
      const answer = await askCoach(
        next,
        abort.signal,
        (text) => {
          if (controller.current === abort && !abort.signal.aborted) {
            progress.current = advanceProgress(progress.current, text)
            setStatus(text)
            setMessages([
              ...next,
              {
                role: "assistant",
                content: streamedAnswer.current,
                progress: progress.current,
              },
            ])
          }
        },
        (text) => {
          if (controller.current !== abort || abort.signal.aborted) return
          streamedAnswer.current += text
          const responseStep = progress.current.find(
            (step) => step.id === "response"
          )
          progress.current = responseStep
            ? progress.current.map((step) =>
                step.id === "response"
                  ? { ...step, status: "active" as const }
                  : step.status === "active"
                    ? { ...step, status: "complete" as const }
                    : step
              )
            : [
                ...completeProgress(progress.current),
                {
                  id: "response",
                  label: "Draft response",
                  description:
                    "Writing the answer from the verified source context.",
                  status: "active" as const,
                },
              ]
          setMessages([
            ...next,
            {
              role: "assistant",
              content: streamedAnswer.current,
              progress: progress.current,
            },
          ])
        }
      )
      if (controller.current !== abort || abort.signal.aborted) return
      setMessages([
        ...next,
        {
          role: "assistant",
          content: answer.text,
          progress: completeProgress(progress.current),
          source: answer.source,
        },
      ])
      setSource(answer.source)
    } catch (problem) {
      if (controller.current !== abort) return
      setMessages(previous)
      setDraft((current) => current || question)
      setError(
        abort.signal.aborted
          ? "Response stopped. Your question is ready to send again."
          : problem instanceof Error
            ? problem.message
            : "The coach could not answer."
      )
    } finally {
      if (controller.current === abort) {
        controller.current = null
        setBusy(false)
        setStatus("")
        setCalendarRevision((value) => value + 1)
      }
    }
  }

  function stopResponse() {
    controller.current?.abort()
    controller.current = null
    const pendingIndex = messages.findLastIndex(
      (message) => message.role === "user"
    )
    const pending = pendingIndex >= 0 ? messages[pendingIndex] : undefined
    if (pending) {
      setDraft((current) => current || pending.content)
      setMessages(messages.slice(0, pendingIndex))
    }
    setBusy(false)
    setStatus("")
    setError("Response stopped. Your question is ready to send again.")
  }

  const errorNotice = error && (
    <div
      role="alert"
      className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm text-destructive"
    >
      {error}
    </div>
  )
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col">
      {!session ? (
        <div className="min-h-0 overflow-y-auto px-4 py-5 text-sm text-muted-foreground">
          {errorNotice || <p role="status">Checking the coach connection…</p>}
          {error && (
            <Button variant="outline" onClick={() => void checkSession()}>
              Try again
            </Button>
          )}
        </div>
      ) : !session.configured ? (
        <div className="m-4 min-h-0 overflow-y-auto rounded-2xl border bg-muted/20 p-6">
          <LockKeyhole className="mb-4 size-6 text-muted-foreground" />
          <h2 className="text-lg font-medium">Finish connecting your coach</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Add these server environment variables, then restart or redeploy the
            app:
          </p>
          <ul className="mt-4 space-y-2 text-sm break-all">
            {session.missing.map((name) => (
              <li key={name}>
                <code>{name}</code>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-sm text-muted-foreground">
            Keep your GitHub and OpenAI keys in server settings.
          </p>
          <Button
            className="mt-5"
            variant="outline"
            onClick={() => void checkSession()}
          >
            Check connection
          </Button>
        </div>
      ) : (
        <>
          <div
            data-coach-scroll
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-5 pb-4 md:px-8"
          >
            <div
              className="space-y-7"
              role="log"
              aria-label="Coach conversation"
              aria-busy={busy}
            >
              {!messages.length && (
                <div className="py-4 md:py-10">
                  <h2 className="text-xl font-medium tracking-tight">
                    What would you like to work on?
                  </h2>
                  <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                    Ask about a session, your recovery, or the week ahead. Each
                    question starts with a fresh read of your GitHub training
                    data and athlete dossier.
                  </p>
                  <div className="mt-6 flex flex-col items-start gap-2">
                    {suggestions.map((question) => (
                      <button
                        key={question}
                        disabled={busy}
                        className="rounded-xl border px-4 py-3 text-left text-sm transition-colors hover:bg-muted disabled:opacity-50"
                        onClick={() => void send(question)}
                      >
                        {question}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {messages.map((message, index) => (
                <Message
                  key={index}
                  from={message.role}
                  className={message.role === "user" ? "ml-8 md:ml-20" : "py-1"}
                >
                  <MessageContent
                    className={
                      message.role === "user"
                        ? "rounded-2xl bg-muted px-5 py-4"
                        : "py-1"
                    }
                  >
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {message.role === "user" ? "You" : "Coach"}
                    </p>
                    {message.role === "user" ? (
                      <p className="text-sm leading-7 wrap-anywhere whitespace-pre-wrap text-foreground">
                        {message.content}
                      </p>
                    ) : (
                      <>
                        {message.progress && message.progress.length > 0 && (
                          <div className="mb-3 space-y-1">
                            <Reasoning
                              isStreaming={
                                busy && index === messages.length - 1
                              }
                              defaultOpen={
                                busy && index === messages.length - 1
                              }
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>
                                {progressSummary(message.progress)}
                              </ReasoningContent>
                            </Reasoning>
                            <ChainOfThought
                              isStreaming={
                                busy && index === messages.length - 1
                              }
                              defaultOpen={
                                busy && index === messages.length - 1
                              }
                            >
                              <ChainOfThoughtHeader />
                              <ChainOfThoughtContent>
                                {message.progress.map((step) => (
                                  <ChainOfThoughtStep key={step.id} {...step} />
                                ))}
                              </ChainOfThoughtContent>
                            </ChainOfThought>
                          </div>
                        )}
                        {message.content && (
                          <MessageResponse className="coach-prose text-sm leading-7">
                            {message.content}
                          </MessageResponse>
                        )}
                        {message.source && (
                          <p className="mt-3 text-xs text-muted-foreground">
                            <InlineCitationText>Based on</InlineCitationText>
                            <InlineCitation>
                              <InlineCitationCard>
                                <InlineCitationCardTrigger
                                  sources={[
                                    "https://github.com/CrankAddict/section-11",
                                  ]}
                                >
                                  Section 11 sources
                                </InlineCitationCardTrigger>
                                <InlineCitationCardBody>
                                  <InlineCitationSource
                                    title="Section 11 protocol and training snapshot"
                                    url="https://github.com/CrankAddict/section-11"
                                    description={`Protocol ${message.source.protocolRevision.slice(0, 12)}… · training snapshot ${message.source.dataRevision.slice(0, 12)}…`}
                                  />
                                </InlineCitationCardBody>
                              </InlineCitationCard>
                            </InlineCitation>
                          </p>
                        )}
                      </>
                    )}
                  </MessageContent>
                </Message>
              ))}
              {busy && (
                <p
                  role="status"
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                >
                  <LoaderCircle className="size-4 animate-spin" />
                  {status}
                </p>
              )}
            </div>
            {session.calendar?.error && (
              <p className="mt-4 text-xs text-muted-foreground">
                Calendar push: {session.calendar.error}
              </p>
            )}
            <CoachCalendar refreshKey={calendarRevision} />
            <div ref={bottom} className="h-1" />
          </div>
          <div
            data-coach-composer
            className="shrink-0 space-y-1 bg-transparent px-4 pt-2 pb-1 md:px-8 md:pb-4"
          >
            {errorNotice}
            {source && (
              <p className="text-xs text-muted-foreground">
                {source.freshness === "delayed"
                  ? "Sync delayed · "
                  : source.freshness === "unknown"
                    ? "Sync time unknown · "
                    : ""}
                {source.lastSynced
                  ? `Data synced ${new Date(source.lastSynced).toLocaleString()}`
                  : "No valid sync timestamp"}
              </p>
            )}
            <PromptInput
              onSubmit={(message: PromptInputMessage) => {
                if (message.text.trim()) void send(message.text)
              }}
              className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring"
            >
              <label htmlFor="coach-question" className="sr-only">
                Message your coach
              </label>
              <PromptInputTextarea
                ref={input}
                id="coach-question"
                rows={1}
                maxLength={12000}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                inputMode="text"
                placeholder="Message your coach…"
                className="max-h-36 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-base leading-6 text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    !window.matchMedia("(pointer: coarse)").matches
                  ) {
                    event.preventDefault()
                    void send()
                  }
                }}
              />
              {busy ? (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Stop response"
                  key="stop"
                  onClick={(event) => {
                    event.preventDefault()
                    stopResponse()
                  }}
                >
                  <Square className="size-3" />
                </Button>
              ) : (
                <PromptInputSubmit
                  onPointerDown={(event) => {
                    if (document.activeElement === input.current)
                      event.preventDefault()
                  }}
                  disabled={!draft.trim()}
                />
              )}
            </PromptInput>
          </div>
        </>
      )}
    </div>
  )
}
