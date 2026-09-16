import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { activeConversations, normalizeConversation } from "./conversation-history.mjs"
import {readDurableState,writeDurableState} from './durable-state.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dataPath = path.join(root, "local-data.json")
let writeQueue = Promise.resolve()


function seed() { return { athlete:{id:"default",name:"Alex Russell",race:"IRONMAN 70.3 Waco",race_date:"2026-10-04",phase:"race-specific",time_zone:"America/Chicago",zones:{bike_ftp:278,run_threshold_pace:"7:12/mi",swim_css:"1:38/100yd",threshold_hr:168}},metrics:{fitness:71,fatigue:67,form:4,recovery:62,compliance_30d:91,readiness:78},history:[],planned:[],comments:[{id:"comment-1",workout_id:"history-2",type:"post",body:"Final reps faded. Legs were the limiter, not breathing.",created_at:"2026-09-12T15:30:00Z"}],library:[{id:"lib1",sport:"Bike",title:"Controlled race power",duration:"75 min",purpose:"Race-specific power without residual fatigue",tags:["Taper","70.3"]},{id:"lib2",sport:"Run",title:"Threshold cruise intervals",duration:"55 min",purpose:"Accumulate controlled sub-threshold volume",tags:["Threshold","Repeatable"]},{id:"lib3",sport:"Swim",title:"CSS rhythm + form",duration:"50 min",purpose:"Hold form while accumulating steady CSS work",tags:["CSS","Technique"]}],notification_preferences:{enabled:false,review_time:"06:00",time_zone:"America/Chicago",subscriptions:[]},daily_reviews:[],coach_conversations:[],updated_at:new Date().toISOString()} }

async function readData() {
  try {
    const data = await readDurableState('APP_DATA',dataPath,seed)
    data.athlete = { id:"default", time_zone:"America/Chicago", ...(data.athlete || {}) }
    // Training load metrics are owned exclusively by Intervals, never seeded
    // or restored from application preferences / legacy TrainingPeaks data.
    data.metrics = {...data.metrics,fitness:null,fatigue:null,form:null}
    data.history=[]
    data.planned=[]
    data.workouts=[]
    data.notification_preferences = {
      enabled:false,
      review_time:"06:00",
      time_zone:data.athlete.time_zone || "America/Chicago",
      subscriptions:[],
      ...(data.notification_preferences || {}),
    }
    data.daily_reviews = Array.isArray(data.daily_reviews) ? data.daily_reviews : []
    data.coach_conversations = activeConversations(data.coach_conversations)
    return data
  } catch (error) {
    // Local development must remain usable when Supabase is temporarily
    // unreachable. The JSON file is a read-only recovery snapshot here.
    try {
      const data = JSON.parse(await fs.readFile(dataPath, 'utf8'))
      data.athlete = { id:"default", time_zone:"America/Chicago", ...(data.athlete || {}) }
      data.metrics = {...data.metrics,fitness:null,fatigue:null,form:null}
      data.history=[]
      data.planned=[]
      data.workouts=[]
      data.notification_preferences = { enabled:false, review_time:"06:00", time_zone:data.athlete.time_zone || "America/Chicago", subscriptions:[], ...(data.notification_preferences || {}) }
      data.daily_reviews = Array.isArray(data.daily_reviews) ? data.daily_reviews : []
      data.coach_conversations = activeConversations(data.coach_conversations)
      return data
    } catch {
      throw new Error(`Database state unavailable: ${error.message}`)
    }
  }
}

async function mutateData(mutator) {
  const operation = writeQueue.then(async () => {
    const data = await readData()
    const result = await mutator(data)
    data.updated_at = new Date().toISOString()
    await writeDurableState('APP_DATA',data,dataPath)
    return result
  })
  writeQueue = operation.catch(() => {})
  return operation
}

export async function readLocalContext() { return readData() }

export async function updateLocalWorkout(id, change) {
  return mutateData(data => {
    const updated_at=new Date().toISOString()
    const workout=data.planned.find(item=>item.id===id)
    if(workout) { workout.changed=true; workout.recommendation=change; workout.updated_at=updated_at; return workout }
    const approval={id,changed:true,recommendation:change,updated_at,source:"coach-approval"}
    data.approved_changes=[approval,...(data.approved_changes || []).filter(item=>item.id!==id)]
    return approval
  })
}

export async function addLocalComment(workoutId, body) {
  return mutateData(data => {
    const comment={id:`comment-${Date.now()}`,workout_id:workoutId,type:"post",body,created_at:new Date().toISOString()}
    data.comments.unshift(comment)
    return comment
  })
}

export async function getNotificationPreferences() {
  const data = await readData()
  return data.notification_preferences
}

export async function updateNotificationPreferences(patch) {
  return mutateData(data => {
    data.notification_preferences = { ...data.notification_preferences, ...patch }
    return data.notification_preferences
  })
}

export async function upsertPushSubscription(subscription) {
  return mutateData(data => {
    const subscriptions = data.notification_preferences.subscriptions || []
    const index = subscriptions.findIndex(item => item.endpoint === subscription.endpoint)
    const value = { ...subscription, updated_at:new Date().toISOString() }
    if (index >= 0) subscriptions[index] = value
    else subscriptions.push(value)
    data.notification_preferences.subscriptions = subscriptions
    return value
  })
}

export async function removePushSubscription(endpoint) {
  return mutateData(data => {
    data.notification_preferences.subscriptions = (data.notification_preferences.subscriptions || []).filter(item => item.endpoint !== endpoint)
    return true
  })
}

export async function listDailyReviews(limit = 30) {
  const data = await readData()
  return [...data.daily_reviews]
    .sort((a,b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, Math.max(1, Math.min(100, limit)))
}

export async function getDailyReview(id) {
  const data = await readData()
  return data.daily_reviews.find(item => item.id === id) || null
}

export async function getDailyReviewByDate(athleteId, localDate) {
  const data = await readData()
  return data.daily_reviews.find(item => item.athlete_id === athleteId && item.local_date === localDate) || null
}

export async function saveDailyReview(review) {
  return mutateData(data => {
    const existingIndex = data.daily_reviews.findIndex(item => item.id === review.id || (item.athlete_id === review.athlete_id && item.local_date === review.local_date))
    if (existingIndex >= 0) data.daily_reviews[existingIndex] = review
    else data.daily_reviews.unshift(review)

    const existingConversation = data.coach_conversations.find(item => item.id === review.conversation_id || item.review_id === review.id)
    const reviewMessageId = `${review.id}:coach`
    const conversation = normalizeConversation({
      ...existingConversation,
      id:review.conversation_id,
      athlete_id:review.athlete_id,
      title:new Date(`${review.local_date}T12:00:00Z`).toLocaleDateString("en-US", { month:"short", day:"2-digit", timeZone:"UTC" }) + " Review",
      kind:"daily_review",
      review_id:review.id,
      deleted_at:null,
      messages:[
        { id:reviewMessageId, role:"assistant", content:review.conversation_text, created_at:review.created_at },
        ...(existingConversation?.messages || []).filter(message => message.id !== reviewMessageId),
      ],
      created_at:existingConversation?.created_at || review.created_at,
      updated_at:review.updated_at || review.created_at,
    })
    const conversationIndex = data.coach_conversations.findIndex(item => item.id === conversation.id || item.review_id === review.id)
    if (conversationIndex >= 0) data.coach_conversations[conversationIndex] = conversation
    else data.coach_conversations.unshift(conversation)
    return review
  })
}

export async function updateDailyReview(id, updater) {
  return mutateData(async data => {
    const index = data.daily_reviews.findIndex(item => item.id === id)
    if (index < 0) return null
    const next = await updater(data.daily_reviews[index])
    if (!next) return data.daily_reviews[index]
    next.updated_at = new Date().toISOString()
    data.daily_reviews[index] = next
    const conversation = data.coach_conversations.find(item => item.review_id === id)
    if (conversation) {
      conversation.updated_at = next.updated_at
      const reviewMessageId = `${id}:coach`
      conversation.messages = [
        { id:reviewMessageId, role:"assistant", content:next.conversation_text, created_at:next.created_at },
        ...conversation.messages.filter(message => message.id !== reviewMessageId),
      ]
    }
    return next
  })
}

export async function listLocalCoachConversations(athleteId = null) {
  const data = await readData()
  const conversations = activeConversations(data.coach_conversations)
  return athleteId ? conversations.filter(item => item.athlete_id === athleteId) : conversations
}

export async function getLocalCoachConversation(id) {
  const conversations = await listLocalCoachConversations(null)
  return conversations.find(item => item.id === id) || null
}

export async function saveLocalCoachConversation(input) {
  return mutateData(data => {
    const index = data.coach_conversations.findIndex(item => item.id === input.id)
    const existing = index >= 0 ? data.coach_conversations[index] : null
    const updatedAt = input.updated_at || new Date().toISOString()
    const next = normalizeConversation({
      ...existing,
      ...input,
      created_at:existing?.created_at || input.created_at || updatedAt,
      updated_at:updatedAt,
    })
    if (index >= 0) data.coach_conversations[index] = next
    else data.coach_conversations.unshift(next)
    return next
  })
}

export async function setLocalCoachConversationPinned(id, pinned) {
  return mutateData(data => {
    const conversation = data.coach_conversations.find(item => item.id === id)
    if (!conversation) return null
    conversation.pinned = Boolean(pinned)
    conversation.updated_at = new Date().toISOString()
    return normalizeConversation(conversation)
  })
}

export async function deleteLocalCoachConversation(id) {
  return mutateData(data => {
    const conversation = data.coach_conversations.find(item => item.id === id)
    if (!conversation) return null
    conversation.deleted_at = new Date().toISOString()
    conversation.updated_at = conversation.deleted_at
    return conversation
  })
}
