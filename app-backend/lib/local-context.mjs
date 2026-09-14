import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { activeConversations, normalizeConversation } from "./conversation-history.mjs"

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dataPath = path.join(root, "local-data.json")
const DAY = 86_400_000
const sports = ["Run", "Bike", "Swim", "Run", "Bike", "Recovery", "Swim"]
const titles = { Run:"Aerobic run", Bike:"Endurance ride", Swim:"Technique + aerobic", Recovery:"Rest day" }
let writeQueue = Promise.resolve()

function dateAt(offset) { return new Date(Date.UTC(2026, 8, 14) + offset * DAY).toISOString().slice(0, 10) }
function buildHistory() {
  return Array.from({ length:90 }, (_, index) => {
    const daysAgo = 89 - index, sport = sports[index % sports.length]
    const completed = sport !== "Recovery" && index % 13 !== 0
    const duration = sport === "Bike" ? 75 + index % 35 : sport === "Run" ? 38 + index % 25 : sport === "Swim" ? 45 + index % 15 : 0
    const compliance = completed ? Math.min(108, 87 + index % 18) : sport === "Recovery" ? 100 : 0
    return {
      id:`history-${daysAgo}`, athlete_id:"default", workout_date:dateAt(-daysAgo), sport,
      title:titles[sport], planned:{ duration_minutes:duration, tss:Math.round(duration * (sport === "Bike" ? .82 : .72)), purpose:sport === "Recovery" ? "Absorb training" : "Build repeatable aerobic fitness" },
      completed:completed ? { duration_minutes:Math.round(duration * compliance / 100), distance: sport === "Bike" ? Math.round(duration * .48 * 10) / 10 : sport === "Run" ? Math.round(duration * .115 * 10) / 10 : Math.round(duration * 45), avg_hr: sport === "Swim" ? 128 : 136 + index % 9, normalized_power:sport === "Bike" ? 201 + index % 24 : null, rpe:4 + index % 4 } : {},
      recovery:{ score:58 + index % 31, sleep_hours:Math.round((6.4 + index % 13 / 10) * 10) / 10, hrv:47 + index % 16, resting_hr:46 + index % 7 },
      compliance, risk_level:index % 17 === 0 ? "medium" : "low", failure_signals:index % 29 === 0 ? ["late_interval_fade","elevated_rpe"] : [],
      post_comment:index % 29 === 0 ? "Legs faded late; breathing stayed controlled." : index % 11 === 0 ? "Felt smooth and controlled." : ""
    }
  })
}

const planned = [
  {id:"mon",day:"MON",date:"Sep 14",workout_date:"2026-09-14",sport:"Swim",title:"Swim – 6x100 Aerobic + 4x50 Build",duration:"45 min",goal:"Stay relaxed and sharpen feel for the water.",details:"Warm Up:\n1 x (200 FS in Z2 + 100 Drill in Z2 + 20 secs rest).\n\nMain Set:\n6 x (100 FS in Z2 + 20 secs rest),\n4 x (50 Build in Z3 + 20 secs rest).\n\nWarm Down:\n1 x (200 Choice in Z2).",status:"completed",risk:"low",load:31},
  {id:"tue",day:"TUE",date:"Sep 15",workout_date:"2026-09-15",sport:"Bike",title:"Bike – 3x8min 70.3 Pace",duration:"1h 05m",goal:"Keep race power familiar without carrying fatigue forward.",details:"15 min easy · 3 × 8 min @ 240–250W · 4 min easy · 10 min cool down",status:"today",risk:"medium",load:54,recommendation:"Drop the three blocks by 10–15 watts after yesterday’s poor recovery score."},
  {id:"wed",day:"WED",date:"Sep 16",workout_date:"2026-09-16",sport:"Run",title:"Run – Aerobic",duration:"40 min",goal:"Keep cadence sharp while protecting freshness.",details:"30 min Z2 · 4 × 20 sec strides · full easy recovery",status:"upcoming",risk:"low",load:36},
  {id:"thu",day:"THU",date:"Sep 17",workout_date:"2026-09-17",sport:"Swim",title:"Swim – 8x100 70.3 Pace",duration:"50 min",goal:"Rehearse smooth race rhythm with controlled breathing.",details:"400 easy · 8 × 100 race rhythm · 200 choice",status:"upcoming",risk:"low",load:42},
  {id:"fri",day:"FRI",date:"Sep 18",workout_date:"2026-09-18",sport:"Recovery",title:"Rest day",duration:"—",goal:"Absorb the week and arrive fresh for Saturday.",details:"Walk and mobility only.",status:"upcoming",risk:"low",load:0},
  {id:"sat",day:"SAT",date:"Sep 19",workout_date:"2026-09-19",sport:"Bike",title:"Brick – 2x15min 70.3 Pace + 20min Easy",duration:"1h 40m",goal:"Confirm pacing and fueling; finish with more available.",details:"Bike 75 min with 2 × 15 min race power · Run 20 min easy",status:"upcoming",risk:"medium",load:86},
  {id:"sun",day:"SUN",date:"Sep 20",workout_date:"2026-09-20",sport:"Run",title:"Run – Aerobic",duration:"50 min",goal:"Keep this easy and finish the week feeling better.",details:"50 min Z2. No fast finish.",status:"upcoming",risk:"low",load:44}
]

function seed() { return { athlete:{id:"default",name:"Alex Russell",race:"IRONMAN 70.3 Waco",race_date:"2026-09-27",phase:"taper",time_zone:"America/Chicago",zones:{bike_ftp:278,run_threshold_pace:"7:12/mi",swim_css:"1:38/100yd",threshold_hr:168}},metrics:{fitness:71,fatigue:67,form:4,recovery:62,compliance_30d:91,readiness:78},history:buildHistory(),planned,comments:[{id:"comment-1",workout_id:"history-2",type:"post",body:"Final reps faded. Legs were the limiter, not breathing.",created_at:"2026-09-12T15:30:00Z"}],library:[{id:"lib1",sport:"Bike",title:"Controlled race power",duration:"75 min",purpose:"Race-specific power without residual fatigue",tags:["Taper","70.3"]},{id:"lib2",sport:"Run",title:"Threshold cruise intervals",duration:"55 min",purpose:"Accumulate controlled sub-threshold volume",tags:["Threshold","Repeatable"]},{id:"lib3",sport:"Swim",title:"CSS rhythm + form",duration:"50 min",purpose:"Hold form while accumulating steady CSS work",tags:["CSS","Technique"]}],notification_preferences:{enabled:false,review_time:"06:00",time_zone:"America/Chicago",subscriptions:[]},daily_reviews:[],coach_conversations:[],updated_at:new Date().toISOString()} }

async function readData() {
  try {
    const data = JSON.parse(await fs.readFile(dataPath,"utf8"))
    data.athlete = { id:"default", time_zone:"America/Chicago", ...(data.athlete || {}) }
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
  } catch {
    const data=seed()
    await fs.writeFile(dataPath,JSON.stringify(data,null,2))
    return data
  }
}

async function mutateData(mutator) {
  const operation = writeQueue.then(async () => {
    const data = await readData()
    const result = await mutator(data)
    data.updated_at = new Date().toISOString()
    await fs.writeFile(dataPath,JSON.stringify(data,null,2))
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
      title:`Daily workout review — ${review.local_date}`,
      kind:"daily_review",
      review_id:review.id,
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
