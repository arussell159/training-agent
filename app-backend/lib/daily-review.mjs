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
  required:["summary","notification_summary","reason","athlete_metrics","relevant_observations","workouts"],
  properties:{
    summary:{ type:"string" },
    notification_summary:{ type:"string" },
    reason:{ type:"string" },
    athlete_metrics:{
      type:"object",
      additionalProperties:false,
      required:["fitness","fatigue","form","recovery","hrv","resting_heart_rate"],
      properties:{
        fitness:{ type:"string" },
        fatigue:{ type:"string" },
        form:{ type:"string" },
        recovery:{ type:"string" },
        hrv:{ type:"string" },
        resting_heart_rate:{ type:"string" },
      },
    },
    relevant_observations:{ type:"array", items:{ type:"string" } },
    workouts:{
      type:"array",
      items:{
        type:"object",
        additionalProperties:false,
        required:["workout_id","priority","target_flexibility","action","proposed_change","reason","execution_guidance","patch","evidence"],
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
            required:["target_ranges"],
            properties:{
              target_ranges:{ type:"array", minItems:1, maxItems:12, items:{ type:"string" } },
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
          evidence:{
            type:"object",
            additionalProperties:false,
            required:["published","athlete_data","reasoning","coaching_judgment","calculations","applicability","terminology"],
            properties:{
              published:{ type:"array", maxItems:4, items:{
                type:"object", additionalProperties:false, required:["source_id","passage_id","claim"],
                properties:{ source_id:{type:"string"}, passage_id:{type:"string"}, claim:{type:"string"} },
              } },
              athlete_data:{ type:"array", minItems:1, maxItems:12, items:{
                type:"object", additionalProperties:false, required:["fact_id","date"],
                properties:{ fact_id:{type:"string"}, date:{type:"string"} },
              } },
              reasoning:{type:"string"},
              coaching_judgment:{type:"string"},
              calculations:{ type:"array", maxItems:8, items:{
                type:"object", additionalProperties:false, required:["id","operation","inputs","result","unit"],
                properties:{
                  id:{type:"string"}, operation:{type:"string",enum:["difference","sum","product","percent_of","percent_change"]},
                  inputs:{type:"array",minItems:1,maxItems:4,items:{type:"object",additionalProperties:false,required:["label","value","unit"],properties:{label:{type:"string"},value:{type:"number"},unit:{type:"string"}}}},
                  result:{type:"number"}, unit:{type:"string"},
                },
              } },
              applicability:{type:"string"},
              terminology:{type:"string"},
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

function athleteMetrics(context, localDate) {
  const snapshot = recoverySnapshot(context, localDate)
  const recentRecovery = snapshot.latest.find(item => item.recovery && Object.values(item.recovery).some(value => value != null))?.recovery || {}
  const historyRecovery = (context.history || []).filter(item => item.workout_date <= localDate).slice(-90).map(item => item.recovery || {})
  const recovery = Number(context.metrics?.recovery)
  const fitness = Number(context.metrics?.fitness)
  const fatigue = Number(context.metrics?.fatigue)
  const form = Number(context.metrics?.form)
  const hrv = Number(context.wellness?.hrv ?? recentRecovery.hrv)
  const restingHeartRate = Number(context.wellness?.resting_hr ?? recentRecovery.resting_hr)
  const hrvBaseline = median(historyRecovery.map(item => Number(item.hrv)))
  const restingHeartRateBaseline = median(historyRecovery.map(item => Number(item.resting_hr)))
  const withBaseline = (value, baseline, unit) => {
    if (!Number.isFinite(value) || value <= 0) return null
    if (!Number.isFinite(baseline) || baseline <= 0) return `${Math.round(value)} ${unit}; no personal baseline is available.`
    const difference = Math.round(value - baseline)
    return `${Math.round(value)} ${unit}; ${Math.abs(difference)} ${unit} ${difference === 0 ? "from" : difference > 0 ? "above" : "below"} the 90-day median of ${Math.round(baseline)} ${unit}.`.replace("0 " + unit + " from", "in line with")
  }
  return {
    fitness:Number.isFinite(fitness) ? `${Math.round(fitness)} (training-load estimate)` : "Unavailable",
    fatigue:Number.isFinite(fatigue) ? `${Math.round(fatigue)} (training-load estimate)` : "Unavailable",
    form:Number.isFinite(form) ? `${Math.round(form)} (training-load estimate)` : "Unavailable",
    recovery:Number.isFinite(recovery) && recovery > 0 ? `${Math.round(recovery)}%` : "Unavailable",
    hrv:withBaseline(hrv, hrvBaseline, "ms") || "No current HRV reading is available.",
    resting_heart_rate:withBaseline(restingHeartRate, restingHeartRateBaseline, "bpm") || "No current resting-heart-rate reading is available.",
  }
}

function mainSetLines(workout) {
  const lines = String(workout.details || workout.goal || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const mainIndex = lines.findIndex(line => /^main set:/i.test(line))
  const warmDownIndex = lines.findIndex((line, index) => index > mainIndex && /^warm down:|^cool down:/i.test(line))
  const source = mainIndex >= 0
    ? lines.slice(mainIndex + 1, warmDownIndex >= 0 ? warmDownIndex : undefined)
    : lines
  const intervals = source
    .filter(line => /\b\d+\s*[x×]\s*(?:\(|\d)/i.test(line))
    .map(line => line.replace(/[,.]$/, "").replace(/\s*[×x]\s*/i, "x"))
  return intervals.length ? intervals.slice(0, 12) : [workout.title]
}

function baseGuidance(action, workout) {
  if (action === "rest") return { target_ranges:["Rest today; there is no training target."] }
  if (action === "substitute_easy") return { target_ranges:["Easy replacement at RPE 2–3/10: keep it fully conversational with no interval targets."] }
  const sport = String(workout.sport || "").toLowerCase()
  if (action === "follow_as_written") return {
    target_ranges:mainSetLines(workout).map(line => `${line}: follow the scheduled target and recovery; no individualized numerical adjustment is being added.`),
  }
  const actionLead = action === "reduce_target"
    ? "Use the proposed 3–5% reduction."
    : action === "add_recovery"
      ? "Keep the written work target and use no more than the proposed extra recovery."
      : action === "shorten" || action === "remove_repetitions"
        ? "Complete only the proposed repetitions and keep them controlled."
        : action === "increase_modestly"
          ? "Use only the proposed 2–3% increase; do not add volume."
          : "Hold the prescribed effort with smooth, repeatable execution."
  return {
    target_ranges:mainSetLines(workout).map(line => {
      const seconds = Number(line.match(/(\d+)\s*(?:sec|secs|seconds)\s*(?:rest|recovery)/i)?.[1])
      const quality = /z4|z5|css|threshold|vo2|race pace|race power/i.test(line)
      if (sport === "swim") {
        if (quality) return `${line}: ${actionLead} Maintain the prescribed pace or zone; maintain the target and increase rest by no more than 30 seconds if needed.`
        return `${line}: ${actionLead} Keep ${Number.isFinite(seconds) ? `${seconds} seconds` : "the written"} rest; you may swim up to 5 sec/100 yd slower while staying at the prescribed aerobic effort.`
      }
      if (sport === "bike") return `${line}: ${actionLead} Keep the written recovery; power may be reduced by up to 5% if needed to preserve the intended effort.`
      if (sport === "run") return `${line}: ${actionLead} Keep the written recovery; pace may be up to 10 sec/mi slower if needed to preserve the intended effort.`
      return `${line}: ${actionLead} Keep the written recovery; reduce the target by no more than 5% if needed to preserve the intended effort.`
    }),
  }
}

export function heuristicDecision(context, workouts, localDate) {
  const recentText = allRecentText(context, localDate)
  const concerning = /chest pain|faint|fainted|confusion|severe unusual breath|fever|worsening pain/.test(recentText)
  const todayRecovery = recoverySnapshot(context, localDate).latest[0]?.recovery || {}
  const lowRecovery = Number(context.metrics?.recovery) > 0 && Number(context.metrics.recovery) < 45
  const poorSleep = Number(todayRecovery.sleep_hours) > 0 && Number(todayRecovery.sleep_hours) < 5.5
  const relevantObservations = []
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
      patch = { ...patch, coachComments:`Daily review: use 95–97% of the written pace or power target today and preserve the intended effort. ${workout.goal || ""}`.trim() }
    } else if (failed.length === 1) {
      action = "add_recovery"
      reason = "One recent comparable session was difficult, which supports protecting interval quality but not changing zones or removing the stimulus."
      proposedChange = "Keep the work target and allow up to 60 seconds extra recovery on no more than two recoveries."
      patch = { ...patch, coachComments:`Daily review: prioritize interval quality. Up to 60 seconds extra recovery is allowed twice. ${workout.goal || ""}`.trim() }
    } else if (easy.length >= 3 && context.athlete?.phase !== "taper") {
      action = "increase_modestly"
      reason = "At least three recent comparable sessions were completed comfortably with good adherence and no conflicting recovery signal."
      proposedChange = "Increase the main-set target by about 2–3%, without adding repetitions or duration."
      patch = { ...patch, coachComments:`Daily review: a modest 2–3% main-set target increase is supported. Do not add repetitions or duration. ${workout.goal || ""}`.trim() }
    }
    if (failed[0]) {
      relevantObservations.push(`${failed[0].workout_date}: ${failed[0].title || `${workout.sport} workout`} was not completed as intended${Number.isFinite(Number(failed[0].compliance)) ? ` (${Math.round(Number(failed[0].compliance))}% completion)` : ""}.`)
    } else if (easy[0]) {
      relevantObservations.push(`${easy[0].workout_date}: ${easy[0].title || `${workout.sport} workout`} was completed comfortably at RPE ${Number(easy[0].completed?.rpe)}/10 with ${Math.round(Number(easy[0].compliance))}% completion.`)
    }
    const priority = /threshold|vo2|race|interval|brick/i.test(`${workout.title} ${workout.goal}`) ? "key" : "supporting"
    const targetFlexibility = priority === "key"
      ? action === "follow_as_written" ? "This is the key session today, so protect smooth, repeatable interval quality; the targets are guides, not pass/fail numbers." : "This is the key session today, so use only the displayed adjustment and protect repeatable interval quality."
      : action === "follow_as_written" ? "This session supports the week, so keep it controlled and let good technique and the intended effort matter more than an exact number." : "This session supports the week, so keep the adjustment conservative and finish without adding extra load."
    return {
      workout_id:String(workout.id),
      priority,
      target_flexibility:targetFlexibility,
      action,
      proposed_change:proposedChange,
      reason,
      execution_guidance:baseGuidance(action, workout),
      patch,
    }
  })
  const changed = decisions.some(item => CHANGE_ACTIONS.has(item.action))
  return {
    summary:changed ? "A small adjustment is recommended for today’s training." : "Proceed as planned",
    notification_summary:changed ? "Workout adjustment suggested." : "Proceed as planned.",
    reason:changed ? "The recommendation uses the smallest change supported by recent comparable execution, feedback, recovery, and today’s session purpose." : "Today’s sessions match the available recovery and recent execution evidence.",
    athlete_metrics:athleteMetrics(context, localDate),
    relevant_observations:[...new Set(relevantObservations)].slice(0,8),
    workouts:decisions,
  }
}

export function evidenceInsufficientDecision(context, workouts, localDate, reason = "No fully validated athlete-data and coaching-reasoning chain was available.") {
  return {
    summary:"Recommendation withheld: insufficient evidence",
    notification_summary:"Recommendation needs more evidence.",
    reason,
    evidence_status:"insufficient",
    athlete_metrics:athleteMetrics(context, localDate),
    relevant_observations:[],
    workouts:workouts.map(workout => ({
      workout_id:String(workout.id),
      priority:"supporting",
      target_flexibility:"No individualized execution guidance is presented until its evidence is validated.",
      action:"follow_as_written",
      proposed_change:null,
      reason:"The coach is withholding a prescription; this does not establish that the current state is normal.",
      execution_guidance:{ target_ranges:[] },
      patch:{ title:null, description:null, coachComments:null, totalTimePlanned:null, tssPlanned:null, structure:null },
      evidence:null,
    })),
  }
}

export function lockDecisionToVerdict(generated, baseline) {
  const generatedWorkouts = new Map(
    (Array.isArray(generated?.workouts) ? generated.workouts : []).map(item => [
      String(item?.workout_id || ""),
      item,
    ])
  )
  const workouts = baseline.workouts.map(locked => {
    const candidate = generatedWorkouts.get(String(locked.workout_id)) || {}
    const candidatePatch = candidate.patch && typeof candidate.patch === "object" ? candidate.patch : null
    const candidateHasChange = candidatePatch
      ? Object.values(candidatePatch).some(value => value !== null && value !== undefined && value !== "")
      : false
    const action = locked.action
    return {
      ...locked,
      ...candidate,
      workout_id:locked.workout_id,
      action,
      proposed_change:
        action === "follow_as_written"
          ? null
          : String(candidate.proposed_change || locked.proposed_change || "Apply the displayed coaching adjustment."),
      reason:String(candidate.reason || locked.reason),
      patch:
        action === "follow_as_written"
          ? locked.patch
          : candidateHasChange
            ? candidatePatch
            : locked.patch,
    }
  })
  return {
    ...baseline,
    ...(generated && typeof generated === "object" ? generated : {}),
    summary:baseline.summary,
    notification_summary:baseline.notification_summary,
    workouts,
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

function nestedWorkoutSteps(structure) {
  const groups = Array.isArray(structure?.structure) ? structure.structure : []
  return groups.flatMap(group => Array.isArray(group.steps) ? group.steps : [])
}

export function validateWorkoutRecommendation(item, workout) {
  const errors = []
  if (String(item?.workout_id) !== String(workout?.id)) errors.push("workout id does not match the reviewed athlete workout")
  const patch = item?.patch || {}
  if (patch.structure) {
    let structure
    try { structure = JSON.parse(patch.structure) } catch { errors.push("replacement structure is not valid JSON") }
    if (structure) {
      const steps = nestedWorkoutSteps(structure)
      if (String(workout.sport).toLowerCase() === "swim") {
        if (structure.visualizationDistanceUnit !== "yard") errors.push("swim structure must preserve visualizationDistanceUnit=yard")
        for (const step of steps) {
          const rest = step.intensityClass === "rest" || /\brest\b/i.test(step.name || "")
          if (!rest && step.length?.unit === "second") errors.push("swimming work was incorrectly encoded as seconds")
          if (rest && step.length?.unit !== "second") errors.push("passive swim rest must be encoded in seconds")
        }
      }
      const endSeconds = Math.max(0, ...((structure.structure || []).map(group => Number(group.end)).filter(Number.isFinite)))
      if (Number.isFinite(patch.totalTimePlanned) && endSeconds > 0 && Math.abs(Number(patch.totalTimePlanned) * 3600 - endSeconds) > 60) errors.push("planned workout total does not match the replacement structure")
    }
  }
  return { valid:errors.length === 0, errors }
}

function notificationSummary(workouts, changesProposed) {
  if (!changesProposed) return "Proceed as planned."
  const actions = new Set(workouts.filter(item => item.action !== "follow_as_written").map(item => item.action))
  if ([...actions].every(action => action === "add_recovery")) return "Extra recovery suggested."
  if ([...actions].every(action => action === "increase_modestly")) return "Higher targets suggested."
  if ([...actions].every(action => ["reduce_target","shorten","remove_repetitions","substitute_easy","rest"].includes(action))) return "Easier targets suggested."
  const sports = new Set(workouts.filter(item => item.action !== "follow_as_written").map(item => item.sport).filter(Boolean))
  if (sports.size === 1) return `${[...sports][0]} adjustment suggested.`
  return "Workout adjustments suggested."
}

function ensureAdjustment(range, workout) {
  let value = String(range).replace(/,\s*\((build|steady|strong)\),/i, ",").replace(/[.;\s]+$/, "")
  const targetIsPrimary = /\b(?:build|strong|css|threshold|vo2|race[ -]?(?:pace|power|effort)|target pace|target power|z4|z5)\b/i.test(value)
  const stripTargetReduction = input => input
    .replace(/;?\s*(?:keep (?:the )?written (?:rest|recovery)(?: unchanged)?(?: and)?\s*)?(?:you may\s+)?(?:allow(?: up to)?\s+)?\d+(?:\.\d+)?\s*(?:sec(?:ond)?s?\s*\/\s*100\s*(?:yd|yard)s?|sec(?:ond)?s?\s*\/\s*mi|%)(?:\s+(?:lower|slower))?[^.;]*?(?:if needed|intended effort)?/gi, "")
    .replace(/;?\s*(?:reduce|decrease)\s+(?:the\s+)?(?:pace|power|target|intensity)[^.;]*/gi, "")
    .replace(/[.;\s]+$/, "")
  const stripRecoveryIncrease = input => input
    .replace(/;?\s*(?:maintain the target and\s*)?(?:increase|add|allow up to)\s+(?:the\s+)?(?:rest|recovery)[^.;]*/gi, "")
    .replace(/;?\s*(?:increase|add)\s+(?:no more than|up to)?\s*\d+\s*(?:seconds?|secs?|sec)\s*(?:of\s*)?(?:rest|recovery)[^.;]*/gi, "")
    .replace(/[.;\s]+$/, "")
  const recoveryAllowance = value.match(/(?:add no more than|allow up to\s*\+?)\s*(\d+)\s*(?:seconds?|secs?|sec)\s*(?:of\s*)?(?:recovery|rest)\b/i)
  if (targetIsPrimary) {
    const seconds = Number(recoveryAllowance?.[1] || (String(workout.sport).toLowerCase() === "swim" ? 10 : 30))
    value = stripTargetReduction(value)
      .replace(/\s*\(\s*allow up to\s*\+?\s*\d+\s*(?:seconds?|secs?|sec)\s*(?:recovery|rest)\s*\)/i, "")
      .replace(/;\s*maintain the target and\s*(?:add no more than|allow up to\s*\+?)\s*\d+\s*(?:seconds?|secs?|sec)\s*(?:of\s*)?(?:recovery|rest)?(?:\s*if needed)?\s*$/i, "")
      .replace(/[.;\s]+$/, "")
    return `${value}; maintain the target and increase rest by no more than ${seconds} seconds if needed.`
  }
  value = stripRecoveryIncrease(value)
  if (recoveryAllowance) {
    const seconds = Number(recoveryAllowance[1])
    value = value
      .replace(/\s*\(\s*allow up to\s*\+?\s*\d+\s*(?:seconds?|secs?|sec)\s*(?:recovery|rest)\s*\)/i, "")
      .replace(/;\s*maintain the target and\s*(?:add no more than|allow up to\s*\+?)\s*\d+\s*(?:seconds?|secs?|sec)\s*(?:of\s*)?(?:recovery|rest)?(?:\s*if needed)?\s*$/i, "")
      .replace(/[.;\s]+$/, "")
    return `${value}; keep the written recovery and reduce the target by no more than ${Math.max(3, Math.min(5, Math.round(seconds / 2)))}% if needed.`
  }
  if (/\b(?:allow|may|maximum|max\.?|up to|increase|reduce|slower)\b/i.test(value)) return `${value}.`
  const rest = Number(value.match(/(?:recovery|rest)\s*(\d+)\s*(?:sec|secs|seconds|s)\b/i)?.[1])
  const sport = String(workout.sport || "").toLowerCase()
  const quality = /\b(?:build|strong|z4|z5|css|threshold|vo2|race pace|race power)\b/i.test(value)
  if (sport === "swim" && quality) {
    return `${value}; maintain the target and increase rest by no more than 10 seconds if needed.`
  }
  if (sport === "swim") {
    return `${value}; keep ${Number.isFinite(rest) ? `${rest} seconds recovery` : "the written recovery"} and allow up to 5 sec/100yd slower if needed.`
  }
  if (sport === "bike") return `${value}; keep the written recovery and allow up to 5% lower power if needed.`
  if (sport === "run") return `${value}; keep the written recovery and allow up to 10 sec/mi slower if needed.`
  return `${value}; keep the written recovery and allow up to 5% lower intensity if needed.`
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
        target_ranges:(Array.isArray(raw.execution_guidance?.target_ranges) && raw.execution_guidance.target_ranges.length
          ? raw.execution_guidance.target_ranges.slice(0,12).map(String)
          : raw.execution_guidance?.target_range
            ? [String(raw.execution_guidance.target_range)]
          : baseGuidance(action, workout).target_ranges).map(range => action === "follow_as_written" ? String(range) : ensureAdjustment(range, workout)),
      },
      patch,
      evidence:raw.evidence && typeof raw.evidence === "object" ? raw.evidence : null,
      applied_at:null,
    }
  })
  const changesProposed = normalized.some(item => item.action !== "follow_as_written" && Object.keys(item.patch).length)
  const evidenceStatus = decision?.evidence_status === "insufficient" ? "insufficient" : "verified"
  const summary = evidenceStatus === "insufficient"
    ? String(decision?.summary || "Recommendation withheld: insufficient evidence")
    : changesProposed ? String(decision?.summary || "A training adjustment is proposed for today.") : "Proceed as planned"
  return {
    summary,
    notification_summary:notificationSummary(normalized, changesProposed),
    reason:String(decision?.reason || "Today’s plan fits the available execution and recovery evidence."),
    athlete_metrics:{
      fitness:String(decision?.athlete_metrics?.fitness || "Unavailable"),
      fatigue:String(decision?.athlete_metrics?.fatigue || "Unavailable"),
      form:String(decision?.athlete_metrics?.form || "Unavailable"),
      recovery:String(decision?.athlete_metrics?.recovery || "Unavailable"),
      hrv:String(decision?.athlete_metrics?.hrv || "No current HRV reading is available."),
      resting_heart_rate:String(decision?.athlete_metrics?.resting_heart_rate || "No current resting-heart-rate reading is available."),
    },
    relevant_observations:Array.isArray(decision?.relevant_observations) ? decision.relevant_observations.slice(0,8).map(String) : [],
    workouts:normalized,
    changes_proposed:changesProposed,
    evidence_status:evidenceStatus,
  }
}

export function reviewConversationText(review) {
  const lines = [
    review.summary,
    review.reason,
    "",
    "Athlete metrics:",
    `- Fitness: ${review.athlete_metrics.fitness}`,
    `- Fatigue: ${review.athlete_metrics.fatigue}`,
    `- Form: ${review.athlete_metrics.form}`,
    `- Recovery: ${review.athlete_metrics.recovery}`,
    `- HRV: ${review.athlete_metrics.hrv}`,
    `- Resting heart rate: ${review.athlete_metrics.resting_heart_rate}`,
  ]
  if (review.relevant_observations.length) lines.push("", "Relevant observations:", ...review.relevant_observations.map(item => `- ${item}`))
  for (const workout of review.workouts) {
    lines.push("", workout.title, `Proposed change: ${workout.proposed_change || "Follow the session as planned."}`)
    if (workout.action !== "follow_as_written") lines.push(`Why: ${workout.reason}`)
    lines.push(
      `How to approach it: ${workout.target_flexibility}`,
      "Pace and rest guidance:",
      ...workout.execution_guidance.target_ranges.map(item => `- ${item}`),
    )
    if (workout.evidence) {
      lines.push("Evidence:")
      if (workout.evidence.published?.length) lines.push(...workout.evidence.published.map(item => `- ${item.source_id} / ${item.passage_id}: ${item.claim}`))
      else lines.push("- Published source: none used; this is explicitly coaching judgment.")
      lines.push(`- Athlete data: ${workout.evidence.athlete_data.map(item => `${item.fact_id} (${item.date})`).join(", ")}`)
      lines.push(`- Reasoning: ${workout.evidence.reasoning}`)
      lines.push(`- Coaching judgment: ${workout.evidence.coaching_judgment}`)
    }
  }
  return lines.join("\n")
}

export function createDailyReview({ athleteId, localDate, timeZone, context, workouts, decision, previous = null, now = new Date() }) {
  const normalized = normalizeDecision(decision, workouts)
  normalized.athlete_metrics = athleteMetrics(context, localDate)
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
    status:normalized.evidence_status === "insufficient" ? "evidence_insufficient" : normalized.changes_proposed ? "pending_approval" : "proceed_as_planned",
    decision:null,
    notification:previous?.notification || { state:"pending", attempts:0, notified_at:null, last_error:null },
    snapshot:{
      workouts:snapshots,
      workout_fingerprint:fingerprint(snapshots),
      recovery:recoverySnapshot(context, localDate),
      recovery_fingerprint:fingerprint(recoverySnapshot(context, localDate)),
      context_synced_at:context.synced_at || null,
      coaching_policy_version:context.coaching?.version || null,
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
