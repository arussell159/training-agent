export const CONVERSATION_RETENTION_DAYS = 90

const DAY_MS = 86_400_000

export function conversationRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - CONVERSATION_RETENTION_DAYS * DAY_MS).toISOString()
}

function validDate(value, fallback) {
  const parsed = new Date(value || fallback)
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString()
}

export function normalizeConversation(input, now = new Date()) {
  const timestamp = now.toISOString()
  const createdAt = validDate(input?.created_at, timestamp)
  const updatedAt = validDate(input?.updated_at, createdAt)
  const cutoff = conversationRetentionCutoff(now)
  const messages = (Array.isArray(input?.messages) ? input.messages : [])
    .filter(message => message && ["assistant", "user"].includes(message.role) && typeof message.content === "string")
    .map((message, index) => ({
      ...message,
      id:String(message.id || `${input?.id || "conversation"}:message:${index}`),
      role:message.role,
      content:message.content.slice(0, 20_000),
      created_at:validDate(message.created_at, updatedAt),
    }))
    .filter(message => message.created_at >= cutoff)

  return {
    id:String(input?.id || ""),
    athlete_id:String(input?.athlete_id || "default"),
    title:String(input?.title || "New conversation").trim().slice(0, 100) || "New conversation",
    kind:input?.kind === "daily_review" || input?.review_id ? "daily_review" : "conversation",
    review_id:input?.review_id ? String(input.review_id) : null,
    pinned:Boolean(input?.pinned),
    messages,
    created_at:createdAt,
    updated_at:updatedAt,
    deleted_at:input?.deleted_at ? validDate(input.deleted_at, timestamp) : null,
  }
}

export function activeConversations(conversations, now = new Date()) {
  const cutoff = conversationRetentionCutoff(now)
  return (Array.isArray(conversations) ? conversations : [])
    .map(conversation => normalizeConversation(conversation, now))
    .filter(conversation => !conversation.deleted_at && conversation.updated_at >= cutoff)
    .sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.updated_at.localeCompare(left.updated_at))
}

export function conversationSummary(conversation) {
  const lastMessage = [...(conversation.messages || [])].reverse().find(message => message.content.trim())
  return {
    id:conversation.id,
    title:conversation.title,
    kind:conversation.kind,
    review_id:conversation.review_id,
    pinned:conversation.pinned,
    created_at:conversation.created_at,
    updated_at:conversation.updated_at,
    preview:lastMessage?.content.trim().replace(/\s+/g, " ").slice(0, 120) || "No messages yet",
  }
}

export function conversationContext(conversations, { excludeId = null, maxMessages = 60, now = new Date() } = {}) {
  const recent = activeConversations(conversations, now)
    .filter(conversation => conversation.id !== excludeId)
    .flatMap(conversation => [...conversation.messages].reverse().map(message => ({
      conversation_id:conversation.id,
      conversation_title:conversation.title,
      conversation_type:conversation.kind,
      role:message.role,
      content:message.content,
      created_at:message.created_at,
    })))
    .slice(0, maxMessages)

  return recent.reverse()
}
