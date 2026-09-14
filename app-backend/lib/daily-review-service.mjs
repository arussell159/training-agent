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
  fingerprint,
  heuristicDecision,
  isReviewDue,
  lockDecisionToVerdict,
  localClock,
  materiallyChanged,
  reviewConversationText,
  scheduledWorkouts,
  workoutHasStarted,
} from "./daily-review.mjs"

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

const REVIEW_INSTRUCTIONS = `You are performing one pre-workout daily triathlon coaching review.
Use the supplied 90-day context, giving more weight to recent comparable workouts. Consider interval completion, failed or comfortable execution, heart rate, perceived effort, recovery, athlete feedback, conditions, fueling, and measurement quality. Never change zones from one unusual workout. Use the smallest supported adjustment and preserve the intended stimulus.
Keep summary to eight words or fewer, reason to one sentence of 22 words or fewer, and each target_flexibility sentence to 24 words or fewer. Do not repeat metric values outside athlete_metrics unless one directly drives a proposed change.
The athlete's race is on 2026-10-04. Use the supplied local date and days_to_race to assess the phase; do not assume the athlete is tapering. In athlete_metrics, report fitness, fatigue, and form explicitly as training-load estimates. Report recovery separately, plus current HRV and resting heart rate with a recent trend or personal baseline when the evidence provides one. Say clearly when a current measurement or baseline is unavailable and never infer reassurance from missing data.
Relevant observations are optional. Include one only when a specific recent comparable workout was materially overachieved, failed, shortened, or completed with unusually easy or difficult execution and that fact is relevant to today's recommendation. Name its date and workout. Return an empty array when there is no such evidence. Never put the race date, training phase, scheduled-workout count, general coaching principles, unavailable measurements, or “nothing concerning” statements in relevant_observations.
notification_summary must be a three-to-six-word sentence matching the saved recommendation, such as “Proceed as planned.”, “Swim adjustment suggested.”, “Easier targets suggested.”, “Higher targets suggested.”, or “Extra recovery suggested.” Proposed changes must sound like suggestions awaiting approval.
For each workout, make target_flexibility a natural sentence that explains the session's priority and what matters most today. Say “work within” a target, never “hit” a target. execution_guidance.target_ranges must contain one precise bullet per main-set block or repeat group. Start every bullet with the exact repeat count, distance or duration, intended effort, verified pace or power target, and planned recovery from the source workout and athlete zones. For swim sets, when the verified pace uses /100yd, express repeat distance in yards (for example, 3x400 yd), never seconds. Then choose the single bounded adjustment that best preserves that set's purpose: either maintain the target while allowing a stated maximum recovery increase, or maintain the written recovery while allowing a stated pace or power reduction. For every target-preserving recovery adjustment, use exactly this wording pattern: “maintain the target and increase rest by no more than N seconds if needed.” Do not alternate with parenthetical allowances, “add recovery,” or “allow up to +N.” Use explicit units and limits. Never invent CSS values, convert aerobic work to threshold work, or use vague guidance such as “drop a zone.” Do not produce a separate extra-recovery line, main-set stop rule, or fueling section. Never say to hit targets at all costs.
Choose follow_as_written, reduce_target, add_recovery, shorten, remove_repetitions, substitute_easy, rest, or increase_modestly. Propose an increase only after repeated comfortable comparable sessions plus good recovery; do not add intensity during a taper without compelling evidence.
The patch is the exact TrainingPeaks change that approval will apply. Use null for every unchanged field. totalTimePlanned is decimal hours, so 45 minutes is 0.75. If changing targets, recoveries, duration, or repetitions in a structured workout, return a complete valid replacement structure JSON string when the source structure is available and keep its duration/TSS fields consistent; otherwise put the full revised instructions in description and coachComments. A follow_as_written recommendation must have a fully null patch. Do not claim any proposal is already applied.`

function outputText(data) {
  return data.output_text || data.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text || ""
}

async function requestStructuredDecision(config, context, workouts, localDate) {
  const baseline = heuristicDecision(context, workouts, localDate)
  if (!config.OPENAI_API_KEY) return baseline
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
    verdict_lock:{
      summary:baseline.summary,
      notification_summary:baseline.notification_summary,
      workouts:baseline.workouts.map(item => ({
        workout_id:item.workout_id,
        action:item.action,
        proposed_change:item.proposed_change,
        patch:item.patch,
      })),
    },
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{ Authorization:`Bearer ${config.OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({
      model:config.OPENAI_MODEL || "gpt-5-mini",
      store:false,
      max_output_tokens:5000,
      reasoning:{ effort:"low" },
      instructions:`${REVIEW_INSTRUCTIONS}
The verdict_lock is deterministic for this exact data snapshot. Preserve every locked workout action, whether a change is proposed, and the top-level summary. You may improve the explanation and execution guidance, but must not make the verdict stricter or easier.`,
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
  return lockDecisionToVerdict(JSON.parse(text), baseline)
}

async function requestStructuredRefinement(config, review, context, workouts, instruction) {
  if (!config.OPENAI_API_KEY) throw new Error("OpenAI is not configured for recommendation refinements")
  const evidence = {
    athlete_request:instruction,
    athlete:context.athlete,
    metrics:context.metrics,
    wellness:context.wellness,
    current_review:review,
    source_workouts:workouts,
  }
  const response = await fetch("https://api.openai.com/v1/responses", {
    method:"POST",
    headers:{ Authorization:`Bearer ${config.OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({
      model:config.OPENAI_MODEL || "gpt-5-mini",
      store:false,
      max_output_tokens:5000,
      reasoning:{ effort:"low" },
      instructions:`${REVIEW_INSTRUCTIONS}
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
  return JSON.parse(text)
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

export function createDailyReviewService({
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
      decision = await decisionProvider(config, context, workouts, localDate)
    } catch (error) {
      log(`daily review model fallback: ${error.message}`)
      decision = heuristicDecision(context, workouts, localDate)
      generationSource = "rules_fallback"
    }
    return { ...createDailyReview({ athleteId, localDate, timeZone:preferences.time_zone, context, workouts, decision, previous, now }), generation_source:generationSource }
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
    if (!workouts.length) {
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
      if (!workouts.length || (!force && !isReviewDue({ now, timeZone:preferences.time_zone, configuredTime:preferences.review_time, workouts }))) return null

      let review = await getDailyReviewByDate(athleteId, localDate)
      if (!review && hydrateDailyReviewByDate) {
        review = await hydrateDailyReviewByDate(athleteId, localDate)
        if (review) await saveDailyReview(review)
      }
      if (!review || refresh) {
        if (refresh && review && ["approved","denied","cancelled","expired"].includes(review.status)) return review
        const previousNotification = review?.notification
        review = await generate(context, workouts, preferences, review, now)
        if (previousNotification) review.notification = previousNotification
        await saveDailyReview(review)
      }
      if (["approved","denied","cancelled","expired"].includes(review.status)) return review
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
    if (!workouts.length || workouts.some(workout => workoutHasStarted(workout, now)) || !workouts.some(workout => reviewedIds.has(String(workout.id)))) {
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
    let review = await getDailyReview(id)
    if (!review) return { status:404, body:{ error:"Daily review not found" } }
    if (review.status === "approved") return { status:200, body:{ review, duplicate:true } }
    if (review.status === "denied") return { status:409, body:{ error:"This proposal was denied and cannot be applied.", review } }
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
