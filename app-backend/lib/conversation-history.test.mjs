import assert from "node:assert/strict"
import test from "node:test"

import {
  activeConversations,
  conversationContext,
  conversationSummary,
} from "./conversation-history.mjs"

const now = new Date("2026-09-14T12:00:00.000Z")

function conversation(overrides = {}) {
  return {
    id:"11111111-1111-4111-8111-111111111111",
    athlete_id:"default",
    title:"Race pacing",
    kind:"conversation",
    pinned:false,
    messages:[{ id:"message-1", role:"user", content:"How should I pace it?", created_at:"2026-09-13T12:00:00.000Z" }],
    created_at:"2026-09-13T12:00:00.000Z",
    updated_at:"2026-09-13T12:00:00.000Z",
    ...overrides,
  }
}

test("history keeps the two folders distinct and sorts pinned chats first", () => {
  const rows = activeConversations([
    conversation(),
    conversation({ id:"22222222-2222-4222-8222-222222222222", title:"Daily review", kind:"daily_review", review_id:"review-1", pinned:true }),
  ], now)
  assert.equal(rows[0].kind, "daily_review")
  assert.equal(rows[0].pinned, true)
  assert.equal(conversationSummary(rows[0]).review_id, "review-1")
})

test("deleted and older-than-90-day chats are removed from history and context", () => {
  const rows = [
    conversation(),
    conversation({ id:"22222222-2222-4222-8222-222222222222", deleted_at:"2026-09-14T10:00:00.000Z" }),
    conversation({ id:"33333333-3333-4333-8333-333333333333", created_at:"2026-05-01T12:00:00.000Z", updated_at:"2026-05-01T12:00:00.000Z" }),
  ]
  assert.equal(activeConversations(rows, now).length, 1)
  assert.deepEqual(conversationContext(rows, { now }).map(message => message.conversation_id), ["11111111-1111-4111-8111-111111111111"])
})

test("the active conversation can be excluded from cross-chat coaching memory", () => {
  const current = conversation()
  const other = conversation({ id:"22222222-2222-4222-8222-222222222222", title:"Fueling" })
  const context = conversationContext([current, other], { excludeId:current.id, now })
  assert.equal(context.length, 1)
  assert.equal(context[0].conversation_title, "Fueling")
})
