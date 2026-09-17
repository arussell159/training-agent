import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ArrowUp, LoaderCircle, LockKeyhole, Square } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import "./coach-prose.css"
import { Button } from "@/components/ui/button"
import { CoachCalendar } from "@/components/coach-calendar"
import {
  askCoach,
  coachRequest,
  type CoachMessage,
  type CoachSession,
  type CoachSource,
} from "@/lib/coach-client"

const suggestions = [
  "How was today’s workout?",
  "Am I ready for tomorrow’s session?",
  "Review my training this week.",
]

export function CoachPage() {
  const [session, setSession] = useState<CoachSession | null>(null)
  const [messages, setMessages] = useState<CoachMessage[]>([])
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState("")
  const [source, setSource] = useState<CoachSource | null>(null)
  const [calendarRevision, setCalendarRevision] = useState(0)
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
    setStatus("Connecting to your coach…")
    streamedAnswer.current = ""
    try {
      const answer = await askCoach(
        next,
        abort.signal,
        (text) => {
          if (controller.current === abort && !abort.signal.aborted)
            setStatus(text)
        },
        (text) => {
          if (controller.current !== abort || abort.signal.aborted) return
          streamedAnswer.current += text
          setMessages([
            ...next,
            { role: "assistant", content: streamedAnswer.current },
          ])
        }
      )
      if (controller.current !== abort || abort.signal.aborted) return
      setMessages([...next, { role: "assistant", content: answer.text }])
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
    const pending = messages.at(-1)
    if (pending?.role === "user") {
      setDraft((current) => current || pending.content)
      setMessages(messages.slice(0, -1))
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
                <article
                  key={index}
                  className={
                    message.role === "user"
                      ? "ml-8 rounded-2xl bg-muted px-5 py-4 md:ml-20"
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
                    <div className="coach-prose text-sm leading-7 wrap-anywhere text-foreground">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        skipHtml
                        components={{
                          img: () => null,
                          a: ({ children }) => <span>{children}</span>,
                          table: ({ children }) => (
                            <div className="overflow-x-auto">
                              <table>{children}</table>
                            </div>
                          ),
                        }}
                      >
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  )}
                </article>
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
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void send()
              }}
              className="flex items-end gap-2 rounded-2xl border bg-background p-2 shadow-sm focus-within:ring-1 focus-within:ring-ring"
            >
              <label htmlFor="coach-question" className="sr-only">
                Message your coach
              </label>
              <textarea
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
                <Button
                  type="submit"
                  size="icon"
                  aria-label="Send message"
                  onPointerDown={(event) => {
                    if (document.activeElement === input.current)
                      event.preventDefault()
                  }}
                  key="send"
                  disabled={!draft.trim()}
                >
                  <ArrowUp />
                </Button>
              )}
            </form>
          </div>
        </>
      )}
    </div>
  )
}
