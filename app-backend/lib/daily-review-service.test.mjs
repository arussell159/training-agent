import test from "node:test"
import assert from "node:assert/strict"
import { createDailyReviewService } from "./daily-review-service.mjs"

function fakeStorage() {
  let review = null
  let preferences = { enabled:false, review_time:"06:00", time_zone:"UTC", subscriptions:[] }
  return {
    getDailyReview:async id => review?.id === id ? review : null,
    getDailyReviewByDate:async (athleteId, date) => review?.athlete_id === athleteId && review?.local_date === date ? review : null,
    getNotificationPreferences:async () => preferences,
    listDailyReviews:async () => review ? [review] : [],
    removePushSubscription:async () => true,
    saveDailyReview:async value => (review = value),
    updateDailyReview:async (id, updater) => {
      if (!review || review.id !== id) return null
      review = await updater(review)
      return review
    },
    updateNotificationPreferences:async patch => (preferences = { ...preferences, ...patch }),
    upsertPushSubscription:async () => true,
  }
}

test("a failed TrainingPeaks write remains retryable and duplicate approval is idempotent", async () => {
  const workout = { id:"42", workout_date:"2026-09-14", sport:"Bike", title:"Bike – Threshold", status:"today", plannedDurationMinutes:60, load:55, details:"3 x 8 min", goal:"Controlled threshold" }
  const context = { athlete:{ id:"athlete-1", phase:"base" }, metrics:{ recovery:30 }, wellness:{ hrv:50 }, history:[], planned:[workout], comments:[] }
  let attempts = 0
  const service = createDailyReviewService({
    readConfig:async () => ({ TP_AUTH_COOKIE:"configured" }),
    writeConfig:async () => {},
    getContext:async () => context,
    applyWorkoutPatch:async () => {
      attempts += 1
      if (attempts === 1) throw new Error("temporary write failure")
      return { verified:true }
    },
    storage:fakeStorage(),
  })
  const now = new Date("2026-09-14T12:00:00Z")
  const review = await service.runDue(now, { force:true })
  assert.equal(review.status, "pending_approval")
  assert.equal(attempts, 0, "generation must never write before approval")
  const duplicateRun = await service.runDue(now, { force:true })
  assert.equal(duplicateRun.id, review.id)
  assert.equal(duplicateRun.revision, review.revision)

  const first = await service.approve(review.id, now)
  assert.equal(first.status, 502)
  assert.equal(first.body.review.status, "apply_failed")

  const retry = await service.approve(review.id, now)
  assert.equal(retry.status, 200)
  assert.equal(retry.body.review.status, "approved")
  assert.equal(attempts, 2)

  const duplicate = await service.approve(review.id, now)
  assert.equal(duplicate.status, 200)
  assert.equal(duplicate.body.duplicate, true)
  assert.equal(attempts, 2)
})
