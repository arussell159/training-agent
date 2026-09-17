import { apiFetch } from "@/lib/api-client"

export type CoachSource = {
  dataRevision: string
  protocolRevision: string
  lastSynced: string | null
  checkedAt: string
  freshness: "recent" | "delayed" | "unknown"
}
export type CoachMessage = { role: "user" | "assistant"; content: string }
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
      result.error || "The coach could not connect. Please try again.",
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
  const response = await coachRequest("message", { messages }, signal)
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    throw new CoachRequestError(
      "The chat endpoint is unavailable. Check that the backend is running."
    )
  const reader = response.body?.getReader()
  if (!reader)
    throw new CoachRequestError("The coach returned an empty response.")
  const decoder = new TextDecoder()
  let buffer = ""
  let answer: CoachAnswer | undefined
  const cancelReader = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener("abort", cancelReader, { once: true })
  try {
    signal.throwIfAborted()
    while (true) {
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      buffer += decoder.decode(value, { stream: !done })
      let boundary
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        const event = block
          .split("\n")
          .find((line) => line.startsWith("event: "))
          ?.slice(7)
        const raw = block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice(6))
          .join("\n")
        if (!raw) continue
        const data = JSON.parse(raw)
        if (event === "error") throw new CoachRequestError(data.error)
        if (event === "status") onStatus(data.text)
        if (event === "token") onToken(data.text)
        if (event === "answer") answer = data
      }
      if (done) break
    }
  } finally {
    signal.removeEventListener("abort", cancelReader)
    void reader.cancel().catch(() => {})
  }
  if (!answer?.text)
    throw new CoachRequestError(
      "The connection ended before the answer arrived. Your question is ready to retry."
    )
  return answer
}
