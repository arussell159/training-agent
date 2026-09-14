import test from "node:test"
import assert from "node:assert/strict"
import { createDailyReview, effectiveReviewTime, heuristicDecision, localClock, materiallyChanged, scheduledWorkouts } from "./daily-review.mjs"

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

test("suspected bonking is flagged for fueling rather than assumed fitness loss", () => {
  const bonkContext = { ...context, comments:[{ body:"I bonked late after missing breakfast." }] }
  const decision = heuristicDecision(bonkContext, [workout], "2026-09-14")
  assert.equal(decision.workouts[0].action, "follow_as_written")
  assert.match(decision.workouts[0].execution_guidance.fueling_note, /fuel/i)
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
  assert.match(review.relevant_observations[0], /2 scheduled sessions/)
})
