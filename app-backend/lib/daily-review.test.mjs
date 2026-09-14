import test from "node:test"
import assert from "node:assert/strict"
import { createDailyReview, effectiveReviewTime, heuristicDecision, localClock, lockDecisionToVerdict, materiallyChanged, normalizeDecision, scheduledWorkouts } from "./daily-review.mjs"

const workout = { id:"12", workout_date:"2026-09-14", sport:"Bike", title:"Bike – 3x8min", status:"today", plannedDurationMinutes:60, load:50, details:"3 x 8 min", goal:"Controlled work" }
const context = { athlete:{ phase:"base" }, metrics:{ recovery:70 }, wellness:{ hrv:55, resting_hr:48 }, history:[], planned:[workout], comments:[] }

test("uses the athlete time zone and schedules one hour before an early workout", () => {
  assert.deepEqual(localClock(new Date("2026-09-14T11:30:00Z"), "America/Chicago"), { date:"2026-09-14", time:"06:30" })
  assert.equal(effectiveReviewTime([{ ...workout, scheduled_start_at:"2026-09-14T12:00:00Z" }], "08:00", "America/Chicago"), "06:00")
})

test("skips rest and completed sessions", () => {
  const selected = scheduledWorkouts({ planned:[workout,{ ...workout,id:"rest",sport:"Recovery" },{ ...workout,id:"done",status:"completed" }] }, "2026-09-14")
  assert.deepEqual(selected.map(item => item.id), ["12"])
})

test("a normal day is proceed as planned and needs no approval", () => {
  const decision = heuristicDecision(context, [workout], "2026-09-14")
  const review = createDailyReview({ athleteId:"a1", localDate:"2026-09-14", timeZone:"America/Chicago", context, workouts:[workout], decision })
  assert.equal(review.summary, "Proceed as planned")
  assert.equal(review.status, "proceed_as_planned")
  assert.equal(review.changes_proposed, false)
  assert.deepEqual(review.relevant_observations, [])
  assert.match(review.athlete_metrics.hrv, /^55 ms/)
  assert.match(review.athlete_metrics.resting_heart_rate, /^48 bpm/)
  assert.ok(review.workouts[0].execution_guidance.target_ranges.length > 0)
  assert.ok(review.workouts[0].execution_guidance.target_ranges.every(range => /no individualized numerical adjustment/i.test(range)))
  assert.doesNotMatch(review.conversation_text, /Stop (?:the )?main set|Stop rule/i)
})

test("missing recovery data does not automatically cancel training", () => {
  const noRecovery = { ...context, metrics:{}, wellness:{}, history:[] }
  const decision = heuristicDecision(noRecovery, [workout], "2026-09-14")
  assert.equal(decision.workouts[0].action, "follow_as_written")
})

test("poor sleep supports a small reduction without changing zones", () => {
  const poorSleep = { ...context, history:[{ workout_date:"2026-09-14", recovery:{ sleep_hours:4.8 } }] }
  const decision = heuristicDecision(poorSleep, [workout], "2026-09-14")
  assert.equal(decision.workouts[0].action, "reduce_target")
  assert.match(decision.workouts[0].reason, /recovery/i)
})

test("repeated failed comparable sessions reduce the target, while one does not redefine fitness", () => {
  const failedHistory = [1,2].map(day => ({ workout_date:`2026-09-${10 + day}`, sport:"Bike", completed:{ duration_minutes:45, rpe:9 }, compliance:65, failure_signals:["late_interval_fade"] }))
  const decision = heuristicDecision({ ...context, history:failedHistory }, [workout], "2026-09-14")
  assert.equal(decision.workouts[0].action, "reduce_target")
  assert.match(decision.workouts[0].reason, /Multiple recent comparable sessions/)
})

test("suspected bonking does not automatically change the workout", () => {
  const bonkContext = { ...context, comments:[{ body:"I bonked late after missing breakfast." }] }
  const decision = heuristicDecision(bonkContext, [workout], "2026-09-14")
  assert.equal(decision.workouts[0].action, "follow_as_written")
})

test("a taper does not increase training after a few easy sessions", () => {
  const easyHistory = [10,11,12].map(day => ({ workout_date:`2026-09-${day}`, sport:"Bike", completed:{ duration_minutes:60, rpe:3 }, compliance:100, failure_signals:[] }))
  const decision = heuristicDecision({ ...context, athlete:{ phase:"taper" }, history:easyHistory }, [workout], "2026-09-14")
  assert.equal(decision.workouts[0].action, "follow_as_written")
})

test("calendar changes invalidate a pending recommendation", () => {
  const decision = heuristicDecision({ ...context, metrics:{ recovery:30 } }, [workout], "2026-09-14")
  const review = createDailyReview({ athleteId:"a1", localDate:"2026-09-14", timeZone:"America/Chicago", context:{ ...context, metrics:{ recovery:30 } }, workouts:[workout], decision })
  assert.equal(materiallyChanged(review, { ...context, metrics:{ recovery:30 } }, [{ ...workout, plannedDurationMinutes:75 }]), true)
})

test("multiple same-day sessions are combined into one review", () => {
  const run = { ...workout, id:"13", sport:"Run", title:"Run – Easy", plannedDurationMinutes:30 }
  const workouts = [workout, run]
  const decision = heuristicDecision({ ...context, planned:workouts }, workouts, "2026-09-14")
  const review = createDailyReview({ athleteId:"a1", localDate:"2026-09-14", timeZone:"America/Chicago", context:{ ...context, planned:workouts }, workouts, decision })
  assert.equal(review.workouts.length, 2)
  assert.deepEqual(review.relevant_observations, [])
  assert.equal(typeof review.athlete_metrics.fatigue, "string")
})

test("the model cannot change the deterministic verdict for the same data snapshot", () => {
  const lowRecovery = { ...context, metrics:{ recovery:30 } }
  const baseline = heuristicDecision(lowRecovery, [workout], "2026-09-14")
  const generated = {
    ...baseline,
    summary:"Ignore the data and proceed",
    notification_summary:"Proceed as planned.",
    workouts:baseline.workouts.map(item => ({ ...item, action:"follow_as_written", proposed_change:null })),
  }
  const locked = lockDecisionToVerdict(generated, baseline)
  assert.equal(locked.summary, baseline.summary)
  assert.equal(locked.notification_summary, baseline.notification_summary)
  assert.equal(locked.workouts[0].action, "reduce_target")
})

test("recovery allowances use one consistent wording pattern", () => {
  const swim = { ...workout, sport:"Swim", title:"Swim – 3x400 Aerobic + 8x100 CSS" }
  const normalized = normalizeDecision({
    workouts:[{
      workout_id:swim.id,
      action:"add_recovery",
      patch:{ coachComments:"Use the revised rest allowance." },
      execution_guidance:{ target_ranges:[
        "4x50 yd, Build, Z2-Z4, 15 sec rest; maintain the target and add no more than 10 seconds recovery if needed.",
        "3x400 yd, Steady, 1:38-1:40/100yd, 30 sec rest; keep the written recovery and allow up to 5 sec/100yd slower if needed.",
        "8x100 yd, Strong, 1:35-1:37/100yd, 15 sec rest (allow up to +10 sec recovery).",
      ] },
    }],
  }, [swim])
  const [fifties, fourHundreds, hundreds] = normalized.workouts[0].execution_guidance.target_ranges
  for (const range of [fifties, hundreds]) {
    assert.match(range, /maintain the target and increase rest by no more than 10 seconds if needed\.$/i)
    assert.doesNotMatch(range, /add no more than|allow up to/i)
  }
  assert.match(fourHundreds, /keep the written recovery and allow up to 5 sec\/100yd slower if needed\.$/i)
  assert.doesNotMatch(fourHundreds, /increase rest/i)
})
