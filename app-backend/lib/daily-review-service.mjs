import webpush from "web-push"
import {
  getDailyReview,
  getDailyReviewByDate,
  getNotificationPreferences,
  listDailyReviews,
  removePushSubscription,
  saveDailyReview,
  updateDailyReview,
  updateNotificationPreferences,
  upsertPushSubscription,
} from "./local-context.mjs"
import {
  createDailyReview,
  dailyReviewSchema,
  evidenceInsufficientDecision,
  fingerprint,
  isReviewDue,
  localClock,
  materiallyChanged,
  reviewConversationText,
  scheduledWorkouts,
  validateWorkoutRecommendation,
  workoutHasStarted,
} from "./daily-review.mjs"
import {
  assertRecommendationEvidence,
  athleteEvidence,
} from "./evidence.mjs"

import { loadCoachingInstructions } from "./coaching-policy.mjs"
import { TRANSPORT_INSTRUCTIONS } from "./triathlon-coach-adapter.mjs"

function enrichDecisionEvidence(decision, passages) {
  const passageMap = new Map(passages.map(item => [`${item.source_id}:${item.passage_id}`, item]))
  return {
    ...decision,
    workouts:(decision.workouts || []).map(workout => ({
      ...workout,
      evidence:workout.evidence ? {
        ...workout.evidence,
        published:(workout.evidence.published || []).map(citation => {
          const passage = passageMap.get(`${citation.source_id}:${citation.passage_id}`)
          return passage ? { ...citation, title:passage.title, url:passage.url, locator:passage.locator, source_kind:passage.source_kind } : citation
        }),
      } : null,
    })),
  }
}

function assertWorkoutPatches(decision, workouts) {
  const byId = new Map(workouts.map(workout => [String(workout.id), workout]))
  const errors = []
  for (const item of decision.workouts || []) {
    const workout = byId.get(String(item.workout_id))
    if (!workout) { errors.push(`unknown workout ${item.workout_id}`); continue }
    const result = validateWorkoutRecommendation(item, workout)
    errors.push(...result.errors.map(error => `${item.workout_id}: ${error}`))
  }
  if (errors.length) throw new Error(`Recommendation workout validation failed: ${errors.join("; ")}`)
}

async function verifiedFollowDecision(context, workouts, localDate) {
  return evidenceInsufficientDecision(context, workouts, localDate, "The coaching model is unavailable. No decision was made using the Endurance Coach AI guide; retry when the connection is restored.")
}
const localStorageAdapter = {
  getDailyReview,
  getDailyReviewByDate,
  getNotificationPreferences,
  listDailyReviews,
  removePushSubscription,
  saveDailyReview,
  updateDailyReview,
  updateNotificationPreferences,
  upsertPushSubscription,
}

const REVIEW_INSTRUCTIONS = `Perform a pre-workout daily endurance coaching review using the primary user-provided framework above and the supplied dated athlete context. Follow its decision hierarchy when feedback, performance, metrics, and the written plan conflict. Determine the phase from the athlete's actual event date and local date. State the purpose of each session and the reasoning for the decision. Treat guide examples as illustrations, never default prescriptions.
Return the required JSON schema. Keep summary and notification_summary concise; proposed changes must sound like suggestions awaiting approval. Report available HRV and resting heart rate with personal trends, and identify fitness/fatigue/form as training-load estimates. Do not invent missing measurements. Include recent observations only when relevant to the decision.
Every recommendation requires dated athlete facts, explicit reasoning, coaching_judgment, applicability limits, and server-verifiable calculations for personalized numerical adjustments. No verified published sources are supplied: leave published empty. The user's guide is a coaching framework, not verified quotations from its named books. Preserve the athlete's recorded zone system.
Choose the supported action that best fits the guide and athlete context. Guidance must describe the actual main-set groups and use verified targets, distance, duration, and recovery with explicit units. Do not restrict decisions to a predetermined recovery-versus-target lever.
The patch is the exact TrainingPeaks change applied only after approval. Use null for unchanged fields and a fully null patch for follow_as_written. totalTimePlanned is decimal hours. Preserve swimming work as distance-based meter lengths converted from prescribed yards with visualizationDistanceUnit yard; seconds are for passive rest. Supply a valid replacement structure when available and keep duration/TSS consistent. Never claim changes have already been applied.`

function outputText(data) {
  return data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text || ""
}

async function requestStructuredDecision(config, context, workouts, localDate) {
  if (!config.OPENAI_API_KEY) return verifiedFollowDecision(context, workouts, localDate)
  const coachingInstructions = await loadCoachingInstructions()
  const retrievedSources = []
  const athleteFacts = athleteEvidence(context, workouts, localDate)
  if (!athleteFacts.length) return evidenceInsufficientDecision(context, workouts, localDate)
  const evidence = {
    local_date:localDate,
    athlete:context.athlete,
    race:context.race,
    phase:context.athlete?.phase || context.coaching?.phase,
    metrics:context.metrics,
    wellness:context.wellness,
    comments:(context.comments || []).slice(0,20),
    scheduled_workouts:workouts,
    recent_history:(context.history || context.workouts || []).slice(-90),
    retrieved_sources:retrievedSources,
    athlete_facts:athleteFacts,
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{ Authorization:`Bearer ${config.OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({
      model:config.OPENAI_MODEL || "gpt-5-mini",
      store:false,
      max_output_tokens:5000,
      reasoning:{ effort:"low" },
      instructions:`${coachingInstructions}\n\n${REVIEW_INSTRUCTIONS}
Use the guide and current athlete context to decide; do not force a legacy metric-based verdict.`,
      input:JSON.stringify(evidence).slice(0,100000),
      text:{
        format:{ type:"json_schema", name:"daily_workout_review", strict:true, schema:dailyReviewSchema },
        verbosity:"low",
      },
    }),
  })
  if (!response.ok) throw new Error(`OpenAI daily review failed (${response.status}): ${(await response.text()).slice(0,300)}`)
  const text = outputText(await response.json())
  if (!text) throw new Error("OpenAI returned an empty daily review")
  const decision = JSON.parse(text)
  assertWorkoutPatches(decision, workouts)
  assertRecommendationEvidence(decision.workouts.map(item => ({ action:item.proposed_change || "Follow the scheduled workout as written.", evidence:item.evidence })), { passages:retrievedSources, athleteFacts })
  return enrichDecisionEvidence(decision, retrievedSources)
}

async function requestStructuredRefinement(config, review, context, workouts, instruction) {
  if (!config.OPENAI_API_KEY) throw new Error("OpenAI is not configured for recommendation refinements")
  const coachingInstructions = await loadCoachingInstructions()
  const retrievedSources = []
  const athleteFacts = athleteEvidence(context, workouts, review.local_date)
  const evidence = {
    athlete_request:instruction,
    athlete:context.athlete,
    metrics:context.metrics,
    wellness:context.wellness,
    current_review:review,
    source_workouts:workouts,
    retrieved_sources:retrievedSources,
    athlete_facts:athleteFacts,
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{ Authorization:`Bearer ${config.OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({
      model:config.OPENAI_MODEL || "gpt-5-mini",
      store:false,
      max_output_tokens:5000,
      reasoning:{ effort:"low" },
      instructions:`${coachingInstructions}\n\n${REVIEW_INSTRUCTIONS}
Revise the unresolved saved review using the athlete's latest reply. Treat that reply as a requested constraint, not approval. Change only the workout, interval group, targets, recovery, or fields explicitly named by the athlete. Preserve every unmentioned workout and main-set group exactly. The patch must contain the complete TrainingPeaks-ready replacement needed to apply the displayed revision, while leaving unmentioned intervals unchanged. Describe the revised workout as a suggestion awaiting approval.`,
      input:JSON.stringify(evidence).slice(0,100000),
      text:{
        format:{ type:"json_schema", name:"daily_workout_review_refinement", strict:true, schema:dailyReviewSchema },
        verbosity:"low",
      },
    }),
  })
  if (!response.ok) throw new Error(`OpenAI review refinement failed (${response.status}): ${(await response.text()).slice(0,300)}`)
  const text = outputText(await response.json())
  if (!text) throw new Error("OpenAI returned an empty review refinement")
  const decision = JSON.parse(text)
  assertWorkoutPatches(decision, workouts)
  assertRecommendationEvidence(decision.workouts.map(item => ({ action:item.proposed_change || "Follow the scheduled workout as written.", evidence:item.evidence })), { passages:retrievedSources, athleteFacts })
  return enrichDecisionEvidence(decision, retrievedSources)
}

function publicPreferences(preferences, config) {
  return {
    enabled:Boolean(preferences.enabled),
    reviewTime:preferences.review_time || "06:00",
    timeZone:preferences.time_zone || "America/Chicago",
    deliveryAvailable:Boolean(config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY),
    hasSubscription:Boolean(preferences.subscriptions?.length),
    subscriptionCount:preferences.subscriptions?.length || 0,
    publicKey:config.VAPID_PUBLIC_KEY || null,
    lastDeliveryError:preferences.last_delivery_error || null,
  }
}
function applyPatchToSnapshot(snapshot, patch) {
  return {
    ...snapshot,
    ...(Object.hasOwn(patch,"title") ? { title:patch.title } : {}),
    ...(Object.hasOwn(patch,"description") ? { description:patch.description } : {}),
    ...(Object.hasOwn(patch,"coachComments") ? { coach_comments:patch.coachComments } : {}),
    ...(Object.hasOwn(patch,"totalTimePlanned") ? { duration_minutes:Math.round(Number(patch.totalTimePlanned) * 60) } : {}),
    ...(Object.hasOwn(patch,"tssPlanned") ? { tss:Number(patch.tssPlanned) } : {}),
    ...(Object.hasOwn(patch,"structure") ? { structure:patch.structure } : {}),
  }
}

async function requestConditionReview(config, context, workouts, localDate) {
  if (!config.OPENAI_API_KEY) throw new Error("OpenAI is not configured")
  const policy = await loadCoachingInstructions()
  const response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{ Authorization:`Bearer ${config.OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({
      model:config.OPENAI_MODEL || "gpt-5-mini", store:false, max_output_tokens:2000, reasoning:{ effort:"low" },
      instructions:`${policy}\n\n${TRANSPORT_INSTRUCTIONS}\nDaily review delivery: return the required JSON with a brief condition assessment and up to three suggestions. This scheduled review is advisory only and does not modify workouts. Analyse the supplied TrainingPeaks snapshot using the upstream coaching policy.`,
      input:JSON.stringify({ local_date:localDate, athlete:context.athlete, metrics:context.metrics, wellness:context.wellness, comments:context.comments, recent_history:(context.history || context.workouts || []).slice(-90), today:workouts, upcoming:context.planned }).slice(0,100000),
      text:{ format:{ type:"json_schema", name:"daily_condition_review", strict:true, schema:{ type:"object", additionalProperties:false, properties:{ summary:{type:"string"}, condition:{type:"string"}, suggestions:{type:"array",maxItems:3,items:{type:"string"}}, uncertainty:{type:"string"} }, required:["summary","condition","suggestions","uncertainty"] } } },
    }),
  })
  if (!response.ok) throw new Error(`OpenAI condition review failed (${response.status})`)
  const assessment = JSON.parse(outputText(await response.json()))
  return { summary:assessment.summary, reason:assessment.condition, advisory:assessment, workouts:[] }
}

export function createDailyReviewService({
  advisoryOnly = false,
  readConfig,
  writeConfig,
  getContext,
  applyWorkoutPatch,
  log = () => {},
  storage = localStorageAdapter,
  hydrateDailyReviewByDate = null,
  decisionProvider = requestStructuredDecision,
  refinementProvider = requestStructuredRefinement,
}) {
  let running = false
  const {
    getDailyReview,
    getDailyReviewByDate,
    getNotificationPreferences,
    listDailyReviews,
    removePushSubscription,
    saveDailyReview,
    updateDailyReview,
    updateNotificationPreferences,
    upsertPushSubscription,
  } = storage

  async function ensureVapid() {
    const config = await readConfig()
    if (config.VAPID_PUBLIC_KEY && config.VAPID_PRIVATE_KEY) return config
    const keys = webpush.generateVAPIDKeys()
    const next = { ...config, VAPID_PUBLIC_KEY:keys.publicKey, VAPID_PRIVATE_KEY:keys.privateKey }
    await writeConfig(next)
    return next
  }

  async function generate(context, workouts, preferences, previous = null, now = new Date()) {
    const athleteId = String(context.athlete?.id || "default")
    const localDate = localClock(now, preferences.time_zone).date
    let decision
    let generationSource = "openai"
    try {
      const config = await readConfig()
      if (!config.OPENAI_API_KEY) generationSource = "rules_fallback"
      decision = advisoryOnly ? await requestConditionReview(config, context, workouts, localDate) : await decisionProvider(config, context, workouts, localDate)
    } catch (error) {
      log(`daily review model fallback: ${error.message}`)
      try {
        decision = await verifiedFollowDecision(context, workouts, localDate)
      } catch (fallbackError) {
        decision = evidenceInsufficientDecision(context, workouts, localDate, `The evidence chain could not be validated: ${error.message}; fallback failed: ${fallbackError.message}`)
      }
      generationSource = "rules_fallback"
    }
    const review = { ...createDailyReview({ athleteId, localDate, timeZone:preferences.time_zone, context, workouts, decision, previous, now }), generation_source:generationSource }
    if (advisoryOnly) {
      review.advisory = decision.advisory || { condition:decision.reason, suggestions:[], uncertainty:"The coaching model is unavailable; this review cannot assess your condition yet." }
      review.changes_proposed = false
      review.workouts = []
      review.status = "proceed_as_planned"
      review.summary = decision.summary || "Daily condition review"
      review.notification_summary = "Daily condition review ready."
      review.conversation_text = [review.summary, review.advisory.condition, ...review.advisory.suggestions.map(item => `- ${item}`), review.advisory.uncertainty].filter(Boolean).join("\n\n")
    }
    return review
  }

  async function deliver(review) {
    const preferences = await getNotificationPreferences()
    if (!preferences.enabled) {
      return updateDailyReview(review.id, current => ({ ...current, notification:{ ...current.notification, state:"disabled", last_error:null } }))
    }
    const subscriptions = preferences.subscriptions || []
    if (!subscriptions.length) {
      await updateNotificationPreferences({ last_delivery_error:"Notifications are enabled, but this device is not subscribed." })
      return updateDailyReview(review.id, current => ({ ...current, notification:{ ...current.notification, state:"unavailable", last_error:"No push subscription is registered." } }))
    }
    if (review.notification?.notified_at) return review

    const config = await ensureVapid()
    webpush.setVapidDetails(config.VAPID_SUBJECT || "mailto:coach@arperformance.local", config.VAPID_PUBLIC_KEY, config.VAPID_PRIVATE_KEY)
    const payload = JSON.stringify({
      title:"Daily workout review",
      body:review.notification_summary || (review.changes_proposed ? "Workout adjustment suggested." : "Proceed as planned."),
      tag:`daily-workout-review-${review.athlete_id}-${review.local_date}`,
      url:`/coach?review=${encodeURIComponent(review.id)}`,
      reviewId:review.id,
    })
    let delivered = 0
    let lastError = null
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(subscription, payload, { TTL:21_600, urgency:"normal" })
        delivered += 1
      } catch (error) {
        lastError = error.message
        if (error.statusCode === 404 || error.statusCode === 410) await removePushSubscription(subscription.endpoint)
      }
    }
    const attempts = Number(review.notification?.attempts || 0) + 1
    if (delivered) {
      await updateNotificationPreferences({ last_delivery_error:lastError })
      return updateDailyReview(review.id, current => ({ ...current, notification:{ state:"sent", attempts, notified_at:new Date().toISOString(), last_error:lastError } }))
    }
    await updateNotificationPreferences({ last_delivery_error:lastError || "Push delivery failed." })
    return updateDailyReview(review.id, current => ({ ...current, notification:{ state:"retry", attempts, notified_at:null, last_error:lastError || "Push delivery failed." } }))
  }

  async function recheckBeforeDelivery(review, preferences, now) {
    const config = await readConfig()
    const latest = await getContext(config, { force:true, strict:true })
    const workouts = scheduledWorkouts(latest, review.local_date)
    if (!advisoryOnly && !workouts.length) {
      return updateDailyReview(review.id, current => ({ ...current, status:"cancelled", changes_proposed:false, notification:{ ...current.notification, state:"cancelled", last_error:"No scheduled workout remained when the calendar was rechecked." } }))
    }
    if (!materiallyChanged(review, latest, workouts)) return review
    const refreshed = await generate(latest, workouts, preferences, review, now)
    refreshed.notification = review.notification
    return saveDailyReview(refreshed)
  }

  async function runDue(now = new Date(), { force = false, refresh = false } = {}) {
    if (running) return null
    running = true
    try {
      const preferences = await getNotificationPreferences()
      const config = await readConfig()
      const context = await getContext(config, { force:true, strict:true })
      const athleteId = String(context.athlete?.id || "default")
      const localDate = localClock(now, preferences.time_zone).date
      const workouts = scheduledWorkouts(context, localDate)
      if ((!advisoryOnly && !workouts.length) || (!force && !isReviewDue({ now, timeZone:preferences.time_zone, configuredTime:preferences.review_time, workouts }))) return null

      let review = await getDailyReviewByDate(athleteId, localDate)
      if (!review && hydrateDailyReviewByDate) {
        review = await hydrateDailyReviewByDate(athleteId, localDate)
        if (review) await saveDailyReview(review)
      }
      const snapshotChanged = review ? materiallyChanged(review, context, workouts) : false
      const needsEvidenceUpgrade = Boolean(review && (advisoryOnly ? !review.advisory : review.evidence_status !== "verified"))
      const policyChanged = Boolean(review && review.snapshot?.coaching_policy_version !== (context.coaching?.version || null))
      if (!review || (refresh && (snapshotChanged || needsEvidenceUpgrade || policyChanged))) {
        if (refresh && review && ["approved","denied","cancelled","expired"].includes(review.status)) return review
        const previousNotification = review?.notification
        review = await generate(context, workouts, preferences, review, now)
        if (previousNotification) review.notification = previousNotification
        await saveDailyReview(review)
      }
      if (["approved","denied","cancelled","expired","evidence_insufficient"].includes(review.status)) return review
      if (!preferences.enabled && review.notification?.state === "disabled") return review
      if (preferences.enabled && !(preferences.subscriptions || []).length && review.notification?.state === "unavailable") return review
      if (review.notification?.notified_at || review.notification?.attempts >= 5) return review
      review = await recheckBeforeDelivery(review, preferences, now)
      if (review.status === "cancelled") return review
      return deliver(review)
    } finally {
      running = false
    }
  }

  async function refine(id, instruction, now = new Date()) {
    if (advisoryOnly) return { status:409, body:{ error:"Daily reviews are advice only. Discuss adjustments in chat; workouts will not be edited." } }
    let review = await getDailyReview(id)
    if (!review) return { status:404, body:{ error:"Daily review not found" } }
    if (!["pending_approval","proceed_as_planned","apply_failed"].includes(review.status)) {
      return { status:409, body:{ error:"This daily review can no longer be revised.", review } }
    }
    if (localClock(now, review.time_zone).date !== review.local_date) {
      review = await updateDailyReview(id, current => ({ ...current, status:"expired", decision:{ type:"expired", decided_at:now.toISOString() } }))
      return { status:409, body:{ error:"This recommendation expired when the workout day ended.", review } }
    }
    const config = await readConfig()
    const latest = await getContext(config, { force:true, strict:true })
    const workouts = scheduledWorkouts(latest, review.local_date)
    const reviewedIds = new Set(review.workouts.map(item => String(item.workout_id)))
    const reviewedWorkouts = workouts.filter(workout => reviewedIds.has(String(workout.id)))
    if (!reviewedWorkouts.length || reviewedWorkouts.some(workout => workoutHasStarted(workout, now)) || reviewedWorkouts.length !== reviewedIds.size) {
      return { status:409, body:{ error:"A reviewed workout has started, completed, moved, or been removed. Nothing was revised.", review } }
    }
    try {
      const decision = await refinementProvider(config, review, latest, workouts, instruction)
      const refined = createDailyReview({
        athleteId:review.athlete_id,
        localDate:review.local_date,
        timeZone:review.time_zone,
        context:latest,
        workouts,
        decision,
        previous:review,
        now,
      })
      refined.notification = review.notification
      refined.refinements = [
        ...(review.refinements || []),
        { instruction:String(instruction), revision:refined.revision, refined_at:now.toISOString() },
      ]
      return { status:200, body:{ review:await saveDailyReview(refined) } }
    } catch (error) {
      log(`daily review refinement failed: ${error.message}`)
      return { status:502, body:{ error:error.message, review } }
    }
  }

  async function approve(id, now = new Date()) {
    if (advisoryOnly) return { status:409, body:{ error:"Daily reviews are advice only and cannot edit workouts." } }
    let review = await getDailyReview(id)
    if (!review) return { status:404, body:{ error:"Daily review not found" } }
    if (review.status === "approved") return { status:200, body:{ review, duplicate:true } }
    if (review.status === "denied") return { status:409, body:{ error:"This proposal was denied and cannot be applied.", review } }
    if (review.evidence_status !== "verified") return { status:409, body:{ error:"This review has no validated evidence chain, so no change can be applied.", review } }
    if (!review.changes_proposed) return { status:409, body:{ error:"This review has no proposed changes.", review } }
    if (localClock(now, review.time_zone).date !== review.local_date) {
      review = await updateDailyReview(id, current => ({ ...current, status:"expired", decision:{ type:"expired", decided_at:now.toISOString() } }))
      return { status:409, body:{ error:"This recommendation expired when the workout day ended.", review } }
    }

    const config = await readConfig()
    if (!config.TP_AUTH_COOKIE) return { status:503, body:{ error:"TrainingPeaks is not connected, so no change was applied.", review } }
    const latest = await getContext(config, { force:true, strict:true })
    const workouts = scheduledWorkouts(latest, review.local_date)
    const currentById = new Map(workouts.map(item => [String(item.id), item]))
    if (review.workouts.some(item => !currentById.has(item.workout_id) || workoutHasStarted(currentById.get(item.workout_id), now))) {
      review = await updateDailyReview(id, current => ({ ...current, status:"expired", decision:{ type:"expired", decided_at:now.toISOString() } }))
      return { status:409, body:{ error:"A reviewed workout has started, completed, moved, or been removed. Nothing was changed.", review } }
    }
    if (materiallyChanged(review, latest, workouts)) {
      const preferences = await getNotificationPreferences()
      const refreshed = await generate(latest, workouts, preferences, review, now)
      refreshed.notification = review.notification
      review = await saveDailyReview(refreshed)
      return { status:409, body:{ error:"The workout, schedule, or recovery context changed. The proposal was refreshed for approval; nothing was applied.", review, refreshed:true } }
    }

    const operationId = `${Date.now()}-${Math.random().toString(16).slice(2)}`
    const claimed = await updateDailyReview(id, current => {
      if (!["pending_approval","apply_failed"].includes(current.status)) return current
      return { ...current, status:"applying", operation_id:operationId, apply_error:null }
    })
    if (claimed.operation_id !== operationId) return { status:409, body:{ error:"This review is already being resolved.", review:claimed } }

    try {
      for (const item of claimed.workouts) {
        if (item.action === "follow_as_written" || !Object.keys(item.patch || {}).length || item.applied_at) continue
        const result = await applyWorkoutPatch(config, item.workout_id, item.patch, { now:new Date(), timeZone:claimed.time_zone })
        review = await updateDailyReview(id, current => {
          const snapshots = current.snapshot.workouts.map(snapshot => snapshot.id === item.workout_id ? applyPatchToSnapshot(snapshot, item.patch) : snapshot)
          return {
            ...current,
            snapshot:{ ...current.snapshot, workouts:snapshots, workout_fingerprint:fingerprint(snapshots) },
            workouts:current.workouts.map(workout => workout.workout_id === item.workout_id ? { ...workout, applied_at:new Date().toISOString(), verification:result } : workout),
          }
        })
      }
      review = await updateDailyReview(id, current => ({ ...current, status:"approved", operation_id:null, decision:{ type:"approved", decided_at:new Date().toISOString() } }))
      review.conversation_text = reviewConversationText(review)
      review = await saveDailyReview(review)
      return { status:200, body:{ review } }
    } catch (error) {
      log(`daily review apply failed: ${error.message}`)
      review = await updateDailyReview(id, current => ({ ...current, status:"apply_failed", operation_id:null, apply_error:error.message }))
      return { status:502, body:{ error:`TrainingPeaks did not confirm every change: ${error.message}`, review } }
    }
  }

  async function deny(id, now = new Date()) {
    const review = await updateDailyReview(id, current => {
      if (["approved","expired"].includes(current.status)) return current
      return { ...current, status:"denied", decision:{ type:"denied", decided_at:now.toISOString() } }
    })
    if (!review) return { status:404, body:{ error:"Daily review not found" } }
    if (review.status !== "denied") return { status:409, body:{ error:"This review can no longer be denied.", review } }
    return { status:200, body:{ review } }
  }

  return {
    runDue,
    refine,
    approve,
    deny,
    getReview:getDailyReview,
    listReviews:listDailyReviews,
    async getPreferences() { const config = await ensureVapid(); return publicPreferences(await getNotificationPreferences(), config) },
    async updatePreferences(input) {
      const patch = {}
      if (typeof input.enabled === "boolean") patch.enabled = input.enabled
      if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.reviewTime || "")) patch.review_time = input.reviewTime
      if (typeof input.timeZone === "string") {
        try { new Intl.DateTimeFormat("en", { timeZone:input.timeZone }).format(); patch.time_zone = input.timeZone } catch { throw new Error("Invalid time zone") }
      }
      const preferences = await updateNotificationPreferences(patch)
      const config = await ensureVapid()
      return publicPreferences(preferences, config)
    },
    async subscribe(subscription) {
      if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) throw new Error("Invalid push subscription")
      await upsertPushSubscription({ endpoint:String(subscription.endpoint), expirationTime:subscription.expirationTime || null, keys:{ p256dh:String(subscription.keys.p256dh), auth:String(subscription.keys.auth) } })
      const config = await ensureVapid()
      return publicPreferences(await getNotificationPreferences(), config)
    },
    async unsubscribe(endpoint) {
      await removePushSubscription(String(endpoint || ""))
      const config = await ensureVapid()
      return publicPreferences(await getNotificationPreferences(), config)
    },
  }
}
