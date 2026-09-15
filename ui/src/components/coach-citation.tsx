import { useState, type ReactNode } from "react"
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardTrigger,
  InlineCitationCardBody,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation"

export function CoachCitation({
  url,
  title,
  description,
}: {
  url: string
  title: ReactNode
  description?: string
}) {
  const [open, setOpen] = useState(false)
  if (!/^https?:\/\//i.test(url)) return <span>{title}</span>
  return (
    <InlineCitation>
      <InlineCitationCard open={open} onOpenChange={setOpen}>
        <InlineCitationCardTrigger
          sources={[url]}
          render={<button type="button" />}
          aria-label={`Source: ${typeof title === "string" ? title : new URL(url).hostname}`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="cursor-pointer align-baseline"
        />
        <InlineCitationCardBody className="max-w-[calc(100vw-2rem)] p-4">
          <InlineCitationSource
            title={typeof title === "string" ? title : new URL(url).hostname}
            url={url}
            description={description}
          >
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-block text-primary underline underline-offset-2"
            >
              Open source
            </a>
          </InlineCitationSource>
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  )
}
