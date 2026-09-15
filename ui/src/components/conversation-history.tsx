import {



  MoreHorizontal,
  Pin,
  PinOff,
  Trash2,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { CoachConversationSummary } from "@/lib/training-context"

function displayConversationTitle(conversation: CoachConversationSummary) {
  if (conversation.kind !== "daily_review") return conversation.title
  const localDate = conversation.review_id?.match(/(\d{4}-\d{2}-\d{2})$/)?.[1]
    || conversation.title.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
  if (!localDate) return conversation.title
  const date = new Date(`${localDate}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return conversation.title
  return `${date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })} ${date.getUTCDate()} Review`
}

function ConversationRow({
  conversation,
  active,
  onOpen,
  onPin,
  onDelete,
}: {
  conversation: CoachConversationSummary
  active: boolean
  onOpen: () => void
  onPin: () => void
  onDelete: () => void
}) {
  const title = displayConversationTitle(conversation)
  return (
    <div
      data-active={active || undefined}
      className="group relative flex min-w-0 items-center rounded-md data-[active]:bg-sidebar-accent"
    >
      <button
        type="button"
        className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md pl-4 pr-10 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        onClick={onOpen}
      >
        <span className="block min-w-0 flex-1 truncate font-normal">{title}</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Actions for ${title}`}
              className="absolute right-1 size-8 opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100"
            />
          }
        >
          <MoreHorizontal />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" className="w-40">
          <DropdownMenuItem onClick={onPin}>
            {conversation.pinned ? <PinOff /> : <Pin />}
            {conversation.pinned ? "Unpin" : "Pin"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function ConversationFolder({
  label,
  kind,
  conversations,
  activeConversationId,
  onOpen,
  onPin,
  onDelete,
}: {
  label: string
  kind: CoachConversationSummary["kind"]
  conversations: CoachConversationSummary[]
  activeConversationId?: string | null
  onOpen: (conversation: CoachConversationSummary) => void
  onPin: (conversation: CoachConversationSummary) => void
  onDelete: (conversation: CoachConversationSummary) => void
}) {
  const items = conversations.filter((conversation) => conversation.kind === kind)
  return (
    <details open aria-label={label} className="group/history space-y-1">
      <summary className="flex h-9 cursor-pointer list-none items-center justify-between px-2 text-xs font-medium text-muted-foreground md:text-sm [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span aria-hidden="true" className="transition-transform group-open/history:rotate-90">›</span>
      </summary>
      {items.length ? (
        items.map((conversation) => (
          <ConversationRow
            key={conversation.id}
            conversation={conversation}
            active={activeConversationId === conversation.id}
            onOpen={() => onOpen(conversation)}
            onPin={() => onPin(conversation)}
            onDelete={() => onDelete(conversation)}
          />
        ))
      ) : (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          {kind === "daily_review" ? "Daily reviews will appear here." : "Your coach conversations will appear here."}
        </p>
      )}
    </details>
  )
}

export function ConversationHistory({
  conversations,
  activeConversationId,
  onOpen,
  onPin,
  onDelete,
}: {
  conversations: CoachConversationSummary[]
  activeConversationId?: string | null
  onOpen: (conversation: CoachConversationSummary) => void
  onPin: (conversation: CoachConversationSummary) => void
  onDelete: (conversation: CoachConversationSummary) => void
}) {
  return (
    <div className="space-y-4">
      <ConversationFolder
        label="Daily Reviews"
        kind="daily_review"
        conversations={conversations}
        activeConversationId={activeConversationId}
        onOpen={onOpen}
        onPin={onPin}
        onDelete={onDelete}
      />
      <ConversationFolder
        label="Conversations"
        kind="conversation"
        conversations={conversations}
        activeConversationId={activeConversationId}
        onOpen={onOpen}
        onPin={onPin}
        onDelete={onDelete}
      />
    </div>
  )
}
