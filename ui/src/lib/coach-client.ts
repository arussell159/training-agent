import { apiFetch } from "@/lib/api-client"
import { withRequestDeadline } from "./request-deadline"

export type CoachSource = {
  dataRevision: string
  protocolRevision: string
  lastSynced: string | null
  checkedAt: string
  freshness: "recent" | "delayed" | "unknown"
}
export type CoachProgressStep = {
  id: string
  label: string
  description?: string
  status: "complete" | "active" | "pending"
}
export type CoachMessage = {
  role: "user" | "assistant"
  content: string
  progress?: CoachProgressStep[]
  source?: CoachSource
}
export type CalendarProposal = {
  id: string
  state:
    | "preview_pending"
    | "ready"
    | "queued"
    | "applied"
    | "declined"
    | "not_applied"
    | "unknown"
    | "expired"
    | "preview_failed"
  phase: "preview" | "push"
  createdAt: number
  expiresAt: number
  timeZone: string
  error: string | null
  runUrl: string | null
  workouts: {
    name: string
    date: string
    type: string
    description: string
    duration_minutes?: number
    tss?: number
    target?: string
    indoor?: boolean
  }[]
}
export type CoachAnswer = {
  text: string
  source: CoachSource
  model: string
  calendarProposals?: CalendarProposal[]
}
export type CoachSession = {
  configured: boolean
  authenticated: boolean
  missing: string[]
  calendar?: { available: boolean; error?: string; timeZone?: string }
}

export class CoachRequestError extends Error {
  status: number
  constructor(message: string, status = 502) {
    super(message)
    this.status = status
  }
}

export async function coachRequest(
  path: string,
  data?: unknown,
  signal?: AbortSignal
) {
  const response = await apiFetch(`/api/coach/${path}`, {
    method: data === undefined ? "GET" : "POST",
    credentials: "same-origin",
    cache: "no-store",
    signal,
    headers: { "Content-Type": "application/json", "X-Coach-Request": "1" },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  })
  if (!response.ok) {
    const result = await response.json().catch(() => ({}))
    throw new CoachRequestError(
      typeof result?.error === "string"
        ? result.error
        : "The coach could not connect. Please try again.",
      response.status
    )
  }
  return response
}

export async function askCoach(
  messages: CoachMessage[],
  signal: AbortSignal,
  onStatus: (status: string) => void,
  onToken: (text: string) => void = () => {}
): Promise<CoachAnswer> {
  return withRequestDeadline(
    async (requestSignal) => {
      const response = await coachRequest(
        "message",
        { messages: messages.map(({ role, content }) => ({ role, content })) },
        requestSignal
      )
      if (!response.headers.get("content-type")?.includes("text/event-stream"))
        throw new CoachRequestError(
          "The chat endpoint is unavailable. Check that the backend is running."
        )
      const reader = response.body?.getReader()
      if (!reader)
        throw new CoachRequestError("The coach returned an empty response.")
      const decoder = new TextDecoder()
      let buffer = ""
      let trailingCarriageReturn = false
      let answer: CoachAnswer | undefined
      const processBlock = (block: string) => {
        const lines = block.split("\n")
        const event = lines
          .find((line) => line.startsWith("event:"))
          ?.slice(6)
          .trim()
        if (!event || !["error", "status", "token", "answer"].includes(event))
          return
        const raw = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).replace(/^ /, ""))
          .join("\n")
        if (!raw) return
        let data
        try {
          data = JSON.parse(raw)
        } catch {
          throw new CoachRequestError(
            "The coach sent an incomplete response. Your question is ready to retry."
          )
        }
        if (!data || typeof data !== "object")
          throw new CoachRequestError("The coach sent an incomplete response.")
        if (event === "error")
          throw new CoachRequestError(
            typeof data.error === "string"
              ? data.error
              : "The coach could not complete this answer."
          )
        if (typeof data.text !== "string")
          throw new CoachRequestError("The coach sent an incomplete response.")
        if (event === "status") onStatus(data.text)
        if (event === "token") onToken(data.text)
        if (event === "answer") {
          if (!data.source || typeof data.source !== "object")
            throw new CoachRequestError("The coach sent an incomplete answer.")
          answer = data
        }
      }
      const cancelReader = () => {
        void reader.cancel().catch(() => {})
      }
      requestSignal.addEventListener("abort", cancelReader, { once: true })
      try {
        requestSignal.throwIfAborted()
        while (true) {
          const { value, done } = await reader.read()
          requestSignal.throwIfAborted()
          let decoded: string =
            (trailingCarriageReturn ? "\r" : "") +
            decoder.decode(value, { stream: !done })
          trailingCarriageReturn = !done && decoded.endsWith("\r")
          if (trailingCarriageReturn) decoded = decoded.slice(0, -1)
          buffer += decoded.replace(/\r\n?/g, "\n")
          if (buffer.length > 1024 * 1024)
            throw new CoachRequestError(
              "The coach response was too large. Please retry."
            )
          let boundary
          while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            processBlock(block)
          }
          if (done && buffer.trim()) processBlock(buffer)
          if (done || answer) break
        }
      } finally {
        requestSignal.removeEventListener("abort", cancelReader)
        void reader.cancel().catch(() => {})
      }
      if (!answer?.text)
        throw new CoachRequestError(
          "The connection ended before the answer arrived. Your question is ready to retry."
        )
      return answer
    },
    180_000,
    signal,
    "The coach took too long to answer. Your question is ready to retry."
  )
}
