import {
  ClipboardList,
  Folder,
  MessageCircle,
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

function formatConversationDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}),
  })
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
  return (
    <div
      data-active={active || undefined}
      className="group relative flex min-w-0 items-center rounded-md data-[active]:bg-sidebar-accent"
    >
      <button
        type="button"
        className="flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-md px-2 pr-10 text-left text-sm outline-none hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring"
        onClick={onOpen}
      >
        {conversation.kind === "daily_review" ? (
          <ClipboardList className="size-4 shrink-0 text-primary" />
        ) : (
          <MessageCircle className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="block truncate font-medium">{conversation.title}</span>
            {conversation.pinned && <Pin className="size-3 shrink-0 fill-current text-primary" aria-label="Pinned" />}
          </span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {formatConversationDate(conversation.updated_at)} · {conversation.preview}
          </span>
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`Actions for ${conversation.title}`}
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
    <section aria-label={label} className="space-y-1">
      <div className="flex h-8 items-center gap-2 px-2 text-xs font-medium text-muted-foreground">
        <Folder className="size-4" />
        <span>{label}</span>
        <span className="ml-auto tabular-nums">{items.length}</span>
      </div>
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
    </section>
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
        label="Daily reviews"
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
