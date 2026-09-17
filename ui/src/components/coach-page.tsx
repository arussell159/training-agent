import { useEffect, useRef, useState } from "react"
import {
  ArrowUp,
  LoaderCircle,
  LockKeyhole,
  Square,
} from "lucide-react"
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
  }, [messages, status])

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
      setDraft(question)
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
        input.current?.focus()
      }
    }
  }

  function stopResponse() {
    controller.current?.abort()
    controller.current = null
    const pending = messages.at(-1)
    if (pending?.role === "user") {
      setDraft(pending.content)
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
    <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 py-6 md:px-8 md:py-10">
      {!session ? (
        <div className="space-y-4 text-sm text-muted-foreground">
          {errorNotice || <p role="status">Checking the coach connection…</p>}
          {error && (
            <Button variant="outline" onClick={() => void checkSession()}>
              Try again
            </Button>
          )}
        </div>
      ) : !session.configured ? (
        <div className="rounded-2xl border bg-muted/20 p-6">
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
            Keep your GitHub and OpenAI keys in
            server settings.
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
            className="flex-1 space-y-7"
            role="log"
            aria-label="Coach conversation"
            aria-busy={busy}
          >
            {!messages.length && (
              <div className="py-10 md:py-16">
                <h2 className="text-xl font-medium tracking-tight">
                  What would you like to work on?
                </h2>
                <p className="mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
                  Ask about a session, your recovery, or the week ahead. Each
                  question starts with a fresh read of your GitHub training data
                  and athlete dossier.
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
                  <p className="text-sm leading-7 text-foreground wrap-anywhere whitespace-pre-wrap">
                    {message.content}
                  </p>
                ) : (
                  <div className="coach-prose text-sm leading-7 text-foreground wrap-anywhere">
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
            <div ref={bottom} className="scroll-mb-56" />
          </div>
          {session.calendar?.error && <p className="mt-4 text-xs text-muted-foreground">Calendar push: {session.calendar.error}</p>}
          <CoachCalendar refreshKey={calendarRevision} />
          <div className="sticky bottom-0 mt-7 space-y-3 bg-background pt-3 pb-2">
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
              className="flex items-end gap-2 rounded-2xl border bg-background p-3 shadow-sm focus-within:ring-1 focus-within:ring-ring"
            >
              <label htmlFor="coach-question" className="sr-only">
                Message your coach
              </label>
              <textarea
                ref={input}
                id="coach-question"
                rows={2}
                maxLength={12000}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={busy}
                placeholder="Message your coach…"
                className="max-h-48 min-h-14 flex-1 resize-y bg-transparent px-1 py-2 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground"
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
                  key="send"
                  disabled={!draft.trim()}
                >
                  <ArrowUp />
                </Button>
              )}
            </form>
            <p className="text-center text-[11px] text-muted-foreground">
              Conversation stays on this page. Leaving or reloading clears it.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
