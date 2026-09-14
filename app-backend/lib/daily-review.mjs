import { createHash, randomUUID } from "node:crypto"

const DAY = 86_400_000
const CHANGE_ACTIONS = new Set([
  "reduce_target",
  "add_recovery",
  "shorten",
  "remove_repetitions",
  "substitute_easy",
  "rest",
  "increase_modestly",
])

export const dailyReviewSchema = {
  type:"object",
  additionalProperties:false,
  required:["summary","reason","relevant_observations","workouts"],
  properties:{
    summary:{ type:"string" },
    reason:{ type:"string" },
    relevant_observations:{ type:"array", items:{ type:"string" } },
    workouts:{
      type:"array",
      items:{
        type:"object",
        additionalProperties:false,
        required:["workout_id","priority","target_flexibility","action","proposed_change","reason","execution_guidance","patch"],
        properties:{
          workout_id:{ type:"string" },
          priority:{ type:"string", enum:["key","supporting","recovery"] },
          target_flexibility:{ type:"string" },
          action:{ type:"string", enum:["follow_as_written","reduce_target","add_recovery","shorten","remove_repetitions","substitute_easy","rest","increase_modestly"] },
          proposed_change:{ type:["string","null"] },
          reason:{ type:"string" },
          execution_guidance:{
            type:"object",
            additionalProperties:false,
            required:["target_range","additional_recovery_limit","stop_main_set_when","fueling_note"],
            properties:{
              target_range:{ type:"string" },
              additional_recovery_limit:{ type:"string" },
              stop_main_set_when:{ type:"string" },
              fueling_note:{ type:"string" },
            },
          },
          patch:{
            type:"object",
            additionalProperties:false,
            required:["title","description","coachComments","totalTimePlanned","tssPlanned","structure"],
            properties:{
              title:{ type:["string","null"] },
              description:{ type:["string","null"] },
              coachComments:{ type:["string","null"] },
              totalTimePlanned:{ type:["number","null"], minimum:0 },
              tssPlanned:{ type:["number","null"], minimum:0 },
              structure:{ type:["string","null"] },
            },
          },
        },
      },
    },
  },
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
  }
  return value ?? null
}

export function fingerprint(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex")
}

export function localClock(now, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year:"numeric",
    month:"2-digit",
    day:"2-digit",
    hour:"2-digit",
    minute:"2-digit",
    hourCycle:"h23",
  }).formatToParts(now)
  const value = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return { date:`${value.year}-${value.month}-${value.day}`, time:`${value.hour}:${value.minute}` }
}

function minutes(value) {
  const [hour, minute] = String(value || "00:00").split(":").map(Number)
  return Math.max(0, Math.min(1439, (Number.isFinite(hour) ? hour : 0) * 60 + (Number.isFinite(minute) ? minute : 0)))
}

function plannedStartClock(workout, timeZone) {
  if (!workout.scheduled_start_at) return null
  const date = new Date(workout.scheduled_start_at)
  if (Number.isNaN(date.getTime())) return null
  const local = localClock(date, timeZone)
  return local.date === workout.workout_date ? local.time : null
}

export function effectiveReviewTime(workouts, configuredTime, timeZone) {
  const configured = minutes(configuredTime)
  const starts = workouts.map(workout => plannedStartClock(workout, timeZone)).filter(Boolean).map(minutes)
  if (!starts.length) return configuredTime
  const beforeFirst = Math.max(0, Math.min(...starts) - 60)
  const selected = Math.min(configured, beforeFirst)
  return `${String(Math.floor(selected / 60)).padStart(2,"0")}:${String(selected % 60).padStart(2,"0")}`
}

export function isReviewDue({ now = new Date(), timeZone, configuredTime, workouts }) {
  const local = localClock(now, timeZone)
  return minutes(local.time) >= minutes(effectiveReviewTime(workouts, configuredTime, timeZone))
}

export function scheduledWorkouts(context, localDate) {
  return (context.planned || []).filter(workout => {
    const duration = Number(workout.plannedDurationMinutes ?? workout.planned?.duration_minutes ?? 0)
    return workout.workout_date === localDate && workout.status !== "completed" && workout.sport !== "Recovery" && duration > 0
  })
}

export function workoutSnapshot(workout) {
  return {
    id:String(workout.id),
    workout_date:workout.workout_date,
    scheduled_start_at:workout.scheduled_start_at || null,
    sport:workout.sport,
    title:workout.title,
    duration_minutes:Number(workout.plannedDurationMinutes ?? workout.planned?.duration_minutes ?? 0),
    tss:Number(workout.planned?.tss ?? workout.load ?? 0),
    description:workout.details || "",
    coach_comments:workout.goal || "",
    structure:workout.structure || null,
    source_updated_at:workout.source_updated_at || null,
  }
}

export function recoverySnapshot(context, localDate) {
  const latest = [...(context.history || [])]
    .filter(item => item.workout_date <= localDate)
    .sort((a,b) => String(b.workout_date).localeCompare(String(a.workout_date)))
    .slice(0,3)
    .map(item => ({
      date:item.workout_date,
      recovery:item.recovery || null,
      completed:item.completed || item.completed_data || null,
      compliance:item.compliance ?? null,
      measurement_quality:item.measurement_quality || null,
      comment:item.post_comment || null,
      failure_signals:item.failure_signals || [],
    }))
  return { wellness:context.wellness || null, metrics:context.metrics || null, latest }
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a,b) => a-b)
  if (!sorted.length) return null
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

function evidenceFor(context, workout, localDate) {
  const recent = (context.history || []).filter(item => item.workout_date < localDate).slice(-90)
  const comparable = recent
    .filter(item => String(item.sport || "").toLowerCase() === String(workout.sport || "").toLowerCase() && Number(item.completed?.duration_minutes ?? item.actualDurationMinutes ?? 0) > 0)
    .slice(-8)
    .reverse()
  const recovery = recent.map(item => item.recovery || {})
  return {
    comparable,
    baselines:{
      hrv:median(recovery.map(item => Number(item.hrv))),
      resting_hr:median(recovery.map(item => Number(item.resting_hr))),
      sleep_hours:median(recovery.map(item => Number(item.sleep_hours))),
    },
  }
}

function allRecentText(context, localDate) {
  const cutoff = new Date(`${localDate}T00:00:00Z`)
  cutoff.setUTCDate(cutoff.getUTCDate() - 7)
  const cutoffDate = cutoff.toISOString().slice(0,10)
  return [
    ...(context.comments || []).filter(item => !item.created_at || String(item.created_at).slice(0,10) >= cutoffDate).slice(0,10).map(item => item.body),
    ...(context.history || []).filter(item => item.workout_date >= cutoffDate).slice(-10).flatMap(item => [item.post_comment, item.athleteComments]),
  ].filter(Boolean).join(" ").toLowerCase()
}

function baseGuidance(action, workout, signals = {}) {
  if (action === "rest") return { target_range:"No training target today.", additional_recovery_limit:"Not applicable.", stop_main_set_when:"Do not start the main set.", fueling_note:"Eat and hydrate normally; seek qualified care for persistent illness or injury concerns." }
  if (action === "substitute_easy") return { target_range:"Keep the replacement fully conversational at easy effort (RPE 2–3/10).", additional_recovery_limit:"No interval recovery is needed.", stop_main_set_when:"Stop if symptoms worsen, pain changes mechanics, or easy effort no longer feels easy.", fueling_note:signals.bonk ? "A prior fade may have involved under-fueling; address carbohydrate and fluids before treating it as lost fitness." : "Fuel for the revised duration and conditions." }
  if (action === "reduce_target") return { target_range:"Use the lower end of the prescribed range, up to 5% below it if needed to preserve the intended controlled effort.", additional_recovery_limit:"Up to 60 seconds extra between work bouts, no more than twice.", stop_main_set_when:"Stop the main set after two consecutive intervals outside the adjusted range, or sooner for concerning symptoms.", fueling_note:signals.bonk ? "Treat the previous late fade as possibly fuel-related: begin fueled and take carbohydrate early enough for this session." : "Fuel and hydrate for the session length and conditions." }
  if (action === "add_recovery") return { target_range:"Keep the written work target, favoring the lower half of its range.", additional_recovery_limit:"Add up to 60 seconds per recovery, for at most two recoveries.", stop_main_set_when:"Stop the main set if the target still cannot be held with stable form after the allowed extra recovery.", fueling_note:signals.bonk ? "Start fueled; do not use extra recovery to mask a developing energy deficit." : "Use normal session fueling and hydration." }
  if (action === "shorten" || action === "remove_repetitions") return { target_range:"Keep remaining work controlled within the written range; do not compensate by going harder.", additional_recovery_limit:"Use written recovery only.", stop_main_set_when:"Stop if execution deteriorates for two consecutive efforts, mechanics change, or concerning symptoms appear.", fueling_note:"Fuel for the original intent and current conditions even though volume is reduced." }
  if (action === "increase_modestly") return { target_range:"Use only the displayed modest increase and keep RPE appropriate to the session purpose.", additional_recovery_limit:"Use written recovery; do not extend the set further.", stop_main_set_when:"Return to the original target if control is lost; stop the main set for worsening pain, dizziness, chest pain, faintness, confusion, or unusual severe breathlessness.", fueling_note:"Support the extra work with the planned carbohydrate and fluids." }
  return { target_range:"Stay within the written target range and preserve the intended effort rather than chasing a single number.", additional_recovery_limit:"Use the written recovery. If needed, add up to 30 seconds once; otherwise end the main set rather than forcing targets.", stop_main_set_when:"Stop the main set after two consecutive intervals outside the range with worsening form, or immediately for concerning symptoms.", fueling_note:signals.bonk ? "A prior fade may have been a bonk. Start fueled and take carbohydrate early; reassess before changing fitness estimates." : "Follow the planned fueling and hydration for duration and conditions." }
}

export function heuristicDecision(context, workouts, localDate) {
  const recentText = allRecentText(context, localDate)
  const concerning = /chest pain|faint|fainted|confusion|severe unusual breath|fever|worsening pain/.test(recentText)
  const bonk = /bonk|bonked|ran out of fuel|underfuel|under-fuel|no energy|nutrition/.test(recentText)
  const todayRecovery = recoverySnapshot(context, localDate).latest[0]?.recovery || {}
  const lowRecovery = Number(context.metrics?.recovery) > 0 && Number(context.metrics.recovery) < 45
  const poorSleep = Number(todayRecovery.sleep_hours) > 0 && Number(todayRecovery.sleep_hours) < 5.5
  const decisions = workouts.map(workout => {
    const evidence = evidenceFor(context, workout, localDate)
    const failed = evidence.comparable.filter(item => (item.failure_signals || []).length || Number(item.compliance) < 75)
    const easy = evidence.comparable.filter(item => Number(item.completed?.rpe) <= 4 && Number(item.compliance) >= 95)
    let action = "follow_as_written"
    let reason = "Recent execution and available recovery do not show a consistent reason to change today’s prescription."
    let proposedChange = null
    let patch = { title:null, description:null, coachComments:null, totalTimePlanned:null, tssPlanned:null, structure:null }
    if (concerning) {
      action = "rest"
      reason = "Recent feedback includes a concerning symptom; health takes priority over the planned stimulus."
      proposedChange = "Replace this workout with rest and seek appropriate assessment if the symptom is current or persistent."
      patch = { ...patch, title:`${workout.sport} – Rest`, description:"Rest. Do not start the planned session while concerning symptoms are present.", coachComments:"Daily review: rest recommended because recent feedback included a concerning symptom.", totalTimePlanned:0, tssPlanned:0 }
    } else if (lowRecovery || poorSleep || failed.length >= 2) {
      action = "reduce_target"
      reason = failed.length >= 2 ? "Multiple recent comparable sessions show incomplete execution, so a small reduction protects repeatable quality without redefining training zones." : "Available recovery information is meaningfully below normal, so reducing today’s output should preserve the session’s purpose."
      proposedChange = "Keep the session structure but reduce prescribed pace or power by about 3–5%; do not add volume."
      patch = { ...patch, coachComments:`Daily review: use 95–97% of the written pace or power target today. Preserve the intended effort and stop the main set after two consecutive misses. ${workout.goal || ""}`.trim() }
    } else if (failed.length === 1) {
      action = "add_recovery"
      reason = "One recent comparable session was difficult, which supports protecting interval quality but not changing zones or removing the stimulus."
      proposedChange = "Keep the work target and allow up to 60 seconds extra recovery on no more than two recoveries."
      patch = { ...patch, coachComments:`Daily review: prioritize interval quality. Up to 60 seconds extra recovery is allowed twice; stop after two consecutive target misses. ${workout.goal || ""}`.trim() }
    } else if (easy.length >= 3 && context.athlete?.phase !== "taper") {
      action = "increase_modestly"
      reason = "At least three recent comparable sessions were completed comfortably with good adherence and no conflicting recovery signal."
      proposedChange = "Increase the main-set target by about 2–3%, without adding repetitions or duration."
      patch = { ...patch, coachComments:`Daily review: a modest 2–3% main-set target increase is supported. Do not add repetitions or duration. ${workout.goal || ""}`.trim() }
    }
    return {
      workout_id:String(workout.id),
      priority:/threshold|vo2|race|interval|brick/i.test(`${workout.title} ${workout.goal}`) ? "key" : "supporting",
      target_flexibility:action === "follow_as_written" ? "Targets are a range; preserve the intended effort and technique." : "The displayed adjustment is the limit; do not turn it into a harder or longer session.",
      action,
      proposed_change:proposedChange,
      reason,
      execution_guidance:baseGuidance(action, workout, { bonk }),
      patch,
    }
  })
  const changed = decisions.some(item => CHANGE_ACTIONS.has(item.action))
  return {
    summary:changed ? "A small adjustment is recommended for today’s training." : "Proceed as planned",
    reason:changed ? "The recommendation uses the smallest change supported by recent comparable execution, feedback, recovery, and today’s session purpose." : "Today’s sessions match the available recovery and recent execution evidence.",
    relevant_observations:[
      `${workouts.length} scheduled session${workouts.length === 1 ? "" : "s"} reviewed together.`,
      bonk ? "Recent feedback suggests a possible fueling-related fade; this is not treated automatically as lost fitness." : "No recent feedback clearly indicates a fueling-related failure.",
      "One unusual session alone is not used to change training zones.",
    ],
    workouts:decisions,
  }
}

function cleanPatch(patch, original) {
  const result = {}
  const source = patch && typeof patch === "object" ? patch : {}
  for (const field of ["title","description","coachComments","structure"]) {
    if (typeof source[field] === "string" && source[field].trim()) result[field] = source[field].trim()
  }
  for (const field of ["totalTimePlanned","tssPlanned"]) {
    if (Number.isFinite(source[field]) && Number(source[field]) >= 0) result[field] = Number(source[field])
  }
  if (result.structure) {
    try { JSON.parse(result.structure) } catch { delete result.structure }
  }
  if (result.title === original.title) delete result.title
  if (result.description === original.description) delete result.description
  if (result.coachComments === original.coach_comments) delete result.coachComments
  if (result.totalTimePlanned === original.duration_minutes / 60) delete result.totalTimePlanned
  if (result.tssPlanned === original.tss) delete result.tssPlanned
  if (result.structure === original.structure) delete result.structure
  return result
}

export function normalizeDecision(decision, workouts) {
  const rawItems = Array.isArray(decision?.workouts) ? decision.workouts : []
  const normalized = workouts.map(workout => {
    const raw = rawItems.find(item => String(item.workout_id) === String(workout.id)) || {}
    const original = workoutSnapshot(workout)
    const requestedAction = CHANGE_ACTIONS.has(raw.action) ? raw.action : "follow_as_written"
    const patch = cleanPatch(raw.patch, original)
    const action = requestedAction !== "follow_as_written" && Object.keys(patch).length ? requestedAction : "follow_as_written"
    return {
      workout_id:String(workout.id),
      title:workout.title,
      sport:workout.sport,
      original,
      priority:["key","supporting","recovery"].includes(raw.priority) ? raw.priority : "supporting",
      target_flexibility:String(raw.target_flexibility || "Treat targets as a range and preserve the intended effort."),
      action,
      proposed_change:action === "follow_as_written" ? null : String(raw.proposed_change || "Apply the displayed coaching adjustment."),
      reason:String(raw.reason || "Available evidence does not support a larger change."),
      execution_guidance:{
        target_range:String(raw.execution_guidance?.target_range || baseGuidance(action, workout).target_range),
        additional_recovery_limit:String(raw.execution_guidance?.additional_recovery_limit || baseGuidance(action, workout).additional_recovery_limit),
        stop_main_set_when:String(raw.execution_guidance?.stop_main_set_when || baseGuidance(action, workout).stop_main_set_when),
        fueling_note:String(raw.execution_guidance?.fueling_note || baseGuidance(action, workout).fueling_note),
      },
      patch,
      applied_at:null,
    }
  })
  const changesProposed = normalized.some(item => item.action !== "follow_as_written" && Object.keys(item.patch).length)
  const summary = changesProposed ? String(decision?.summary || "A training adjustment is proposed for today.") : "Proceed as planned"
  return {
    summary,
    reason:String(decision?.reason || "Today’s plan fits the available execution and recovery evidence."),
    relevant_observations:Array.isArray(decision?.relevant_observations) ? decision.relevant_observations.slice(0,8).map(String) : [],
    workouts:normalized,
    changes_proposed:changesProposed,
  }
}

export function reviewConversationText(review) {
  const lines = [review.summary, review.reason, "", "Relevant observations:", ...review.relevant_observations.map(item => `- ${item}`)]
  for (const workout of review.workouts) {
    lines.push(
      "",
      workout.title,
      `Original: ${workout.original.duration_minutes} min · ${workout.original.description || workout.original.coach_comments || "See TrainingPeaks for structure."}`,
      `Recommendation: ${workout.proposed_change || "Follow the session as written."}`,
      `Why: ${workout.reason}`,
      `Priority: ${workout.priority}. ${workout.target_flexibility}`,
      `Target range: ${workout.execution_guidance.target_range}`,
      `Extra recovery: ${workout.execution_guidance.additional_recovery_limit}`,
      `Stop rule: ${workout.execution_guidance.stop_main_set_when}`,
      `Fueling: ${workout.execution_guidance.fueling_note}`,
    )
  }
  return lines.join("\n")
}

export function createDailyReview({ athleteId, localDate, timeZone, context, workouts, decision, previous = null, now = new Date() }) {
  const normalized = normalizeDecision(decision, workouts)
  const snapshots = workouts.map(workoutSnapshot).sort((a,b) => a.id.localeCompare(b.id))
  const createdAt = previous?.created_at || now.toISOString()
  const id = previous?.id || `daily-review-${encodeURIComponent(athleteId)}-${localDate}`
  const review = {
    id,
    conversation_id:previous?.conversation_id || randomUUID(),
    athlete_id:athleteId,
    local_date:localDate,
    time_zone:timeZone,
    revision:Number(previous?.revision || 0) + 1,
    created_at:createdAt,
    updated_at:now.toISOString(),
    expires_at:new Date(now.getTime() + DAY).toISOString(),
    status:normalized.changes_proposed ? "pending_approval" : "proceed_as_planned",
    decision:null,
    notification:previous?.notification || { state:"pending", attempts:0, notified_at:null, last_error:null },
    snapshot:{
      workouts:snapshots,
      workout_fingerprint:fingerprint(snapshots),
      recovery:recoverySnapshot(context, localDate),
      recovery_fingerprint:fingerprint(recoverySnapshot(context, localDate)),
      context_synced_at:context.synced_at || null,
    },
    ...normalized,
  }
  review.conversation_text = reviewConversationText(review)
  return review
}

export function materiallyChanged(review, context, workouts) {
  const snapshots = workouts.map(workoutSnapshot).sort((a,b) => a.id.localeCompare(b.id))
  if (fingerprint(snapshots) !== review.snapshot.workout_fingerprint) return true
  const before = review.snapshot.recovery || {}
  const after = recoverySnapshot(context, review.local_date)
  const metrics = [
    [before.wellness?.hrv, after.wellness?.hrv, 0.1],
    [before.wellness?.resting_hr, after.wellness?.resting_hr, 5],
    [before.metrics?.recovery, after.metrics?.recovery, 10],
  ]
  if (metrics.some(([oldValue,newValue,threshold]) => Number.isFinite(Number(oldValue)) && Number.isFinite(Number(newValue)) && Math.abs(Number(oldValue) - Number(newValue)) >= threshold)) return true
  return fingerprint(before.latest) !== fingerprint(after.latest)
}

export function workoutHasStarted(workout, now = new Date()) {
  if (workout.status === "completed" || Number(workout.actualDurationMinutes ?? workout.completed_data?.duration_minutes ?? 0) > 0) return true
  if (!workout.scheduled_start_at) return false
  const start = new Date(workout.scheduled_start_at)
  return !Number.isNaN(start.getTime()) && now >= start
}
