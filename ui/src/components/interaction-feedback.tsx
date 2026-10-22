import { useEffect } from "react"
import { installInteractionFeedback } from "@/lib/interaction-feedback"
import "@/styles/interaction-feedback.css"

export function InteractionFeedback() {
  useEffect(() => installInteractionFeedback(document, window), [])
  return null
}
