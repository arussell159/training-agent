import test from "node:test";
import assert from "node:assert/strict";
import { createDailyReviewService } from "./daily-review-service.mjs";

test("advisory reviews cover rest days and cannot apply workout changes", async (t) => {
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const request = JSON.parse(options.body);
    assert.equal(request.text.format.name, "daily_condition_review");
    assert.match(request.instructions, /Never generate workout patches/);
    return {
      ok: true,
      json: async () => ({
        output_text: JSON.stringify({
          summary: "Recovery deserves attention",
          condition: "Recent fatigue suggests protecting recovery today.",
          suggestions: ["Consider keeping tomorrow's session easy if fatigue persists."],
          uncertainty: "Current sleep data is unavailable.",
        }),
      }),
    };
  });
  let writes = 0;
  const service = createDailyReviewService({
    advisoryOnly: true,
    readConfig: async () => ({ OPENAI_API_KEY: "test-only" }),
    writeConfig: async () => {},
    getContext: async () => ({
      athlete: { id: "athlete-1" },
      metrics: { recovery: 30 },
      planned: [],
      history: [],
      comments: [],
    }),
    applyWorkoutPatch: async () => {
      writes++;
    },
    storage: fakeStorage(),
  });
  const review = await service.runDue(new Date("2026-09-14T12:00:00Z"), { force: true });
  assert.ok(review.advisory);
  assert.equal(review.changes_proposed, false);
  assert.deepEqual(review.workouts, []);
  assert.equal((await service.approve(review.id)).status, 409);
  assert.equal((await service.refine(review.id, "Reduce tomorrow's workout")).status, 409);
  assert.equal(writes, 0);
});

test("default reviews send the supplied guide and athlete facts without legacy source or verdict overrides", async (t) => {
  let request;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    request = JSON.parse(options.body);
    throw new Error("Simulated model outage");
  });
  const workout = {
    id: "42",
    workout_date: "2026-09-14",
    sport: "Bike",
    title: "Bike – Threshold",
    status: "today",
    plannedDurationMinutes: 60,
    details: "3 x 8 min",
    goal: "Controlled threshold",
  };
  const context = {
    athlete: { id: "athlete-1" },
    metrics: { recovery: 30 },
    history: [],
    planned: [workout],
    comments: [],
  };
  const service = createDailyReviewService({
    readConfig: async () => ({ OPENAI_API_KEY: "test-only" }),
    writeConfig: async () => {},
    getContext: async () => context,
    applyWorkoutPatch: async () => {
      throw new Error("Must not apply a workout");
    },
    storage: fakeStorage(),
  });
  const review = await service.runDue(new Date("2026-09-14T12:00:00Z"), { force: true });
  assert.match(request.instructions, /Section 11/);
  assert.match(request.instructions, /Protocol Version:\*\* 11\.69/);
  assert.match(request.instructions, /No separate legacy evidence library is supplied/);
  const input = JSON.parse(request.input);
  assert.equal(input.athlete.id, "athlete-1");
  assert.ok(input.athlete_facts.length);
  assert.deepEqual(input.retrieved_sources, []);
  assert.equal(input.verdict_lock, undefined);
  assert.equal(review.changes_proposed, false);
});

function fakeStorage(initialReview = null) {
  let review = initialReview;
  let preferences = { enabled: false, review_time: "06:00", time_zone: "UTC", subscriptions: [] };
  return {
    getDailyReview: async (id) => (review?.id === id ? review : null),
    getDailyReviewByDate: async (athleteId, date) =>
      review?.athlete_id === athleteId && review?.local_date === date ? review : null,
    getNotificationPreferences: async () => preferences,
    listDailyReviews: async () => (review ? [review] : []),
    removePushSubscription: async () => true,
    saveDailyReview: async (value) => (review = value),
    updateDailyReview: async (id, updater) => {
      if (!review || review.id !== id) return null;
      review = await updater(review);
      return review;
    },
    updateNotificationPreferences: async (patch) => (preferences = { ...preferences, ...patch }),
    upsertPushSubscription: async () => true,
  };
}

test("a failed Intervals.icu write remains retryable and duplicate approval is idempotent", async () => {
  const workout = {
    id: "42",
    workout_date: "2026-09-14",
    sport: "Bike",
    title: "Bike – Threshold",
    status: "today",
    plannedDurationMinutes: 60,
    load: 55,
    details: "3 x 8 min",
    goal: "Controlled threshold",
  };
  const context = {
    athlete: { id: "athlete-1", phase: "base" },
    metrics: { recovery: 30 },
    wellness: { hrv: 50 },
    history: [],
    planned: [workout],
    comments: [],
  };
  let attempts = 0;
  const service = createDailyReviewService({
    readConfig: async () => ({ INTERVALS_API_KEY: "configured" }),
    writeConfig: async () => {},
    getContext: async () => context,
    applyWorkoutPatch: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary write failure");
      return { verified: true };
    },
    storage: fakeStorage(),
    decisionProvider: async (_config, value, workouts, date) =>
      (await import("./daily-review.mjs")).heuristicDecision(value, workouts, date),
  });
  const now = new Date("2026-09-14T12:00:00Z");
  const review = await service.runDue(now, { force: true });
  assert.equal(review.status, "pending_approval");
  assert.equal(attempts, 0, "generation must never write before approval");
  const duplicateRun = await service.runDue(now, { force: true });
  assert.equal(duplicateRun.id, review.id);
  assert.equal(duplicateRun.revision, review.revision);

  const unchangedRefresh = await service.runDue(now, { force: true, refresh: true });
  assert.equal(unchangedRefresh.id, review.id);
  assert.equal(unchangedRefresh.revision, review.revision);

  const first = await service.approve(unchangedRefresh.id, now);
  assert.equal(first.status, 502);
  assert.equal(first.body.review.status, "apply_failed");

  const retry = await service.approve(review.id, now);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.review.status, "approved");
  assert.equal(attempts, 2);

  const duplicate = await service.approve(review.id, now);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(attempts, 2);
});

test("a restart hydrates the saved review and does not regenerate an unchanged verdict", async () => {
  const workout = {
    id: "42",
    workout_date: "2026-09-14",
    sport: "Bike",
    title: "Bike – Threshold",
    status: "today",
    plannedDurationMinutes: 60,
    load: 55,
    details: "3 x 8 min",
    goal: "Controlled threshold",
  };
  const context = {
    athlete: { id: "athlete-1", phase: "base" },
    metrics: { recovery: 30 },
    wellness: { hrv: 50 },
    history: [],
    planned: [workout],
    comments: [],
  };
  const now = new Date("2026-09-14T12:00:00Z");
  const originalService = createDailyReviewService({
    readConfig: async () => ({}),
    writeConfig: async () => {},
    getContext: async () => context,
    applyWorkoutPatch: async () => ({ verified: true }),
    storage: fakeStorage(),
    decisionProvider: async (_config, value, workouts, date) =>
      (await import("./daily-review.mjs")).heuristicDecision(value, workouts, date),
  });
  const remoteReview = await originalService.runDue(now, { force: true });
  let generations = 0;
  const restartedService = createDailyReviewService({
    readConfig: async () => ({}),
    writeConfig: async () => {},
    getContext: async () => context,
    applyWorkoutPatch: async () => ({ verified: true }),
    storage: fakeStorage(),
    hydrateDailyReviewByDate: async () => remoteReview,
    decisionProvider: async () => {
      generations += 1;
      throw new Error("An unchanged saved review must not be regenerated");
    },
  });
  const hydrated = await restartedService.runDue(now, { force: true, refresh: true });
  assert.equal(hydrated.id, remoteReview.id);
  assert.equal(hydrated.revision, remoteReview.revision);
  assert.equal(generations, 0);
});

test("an athlete reply creates a new pending revision without sending another notification", async () => {
  const workout = {
    id: "42",
    workout_date: "2026-09-14",
    sport: "Swim",
    title: "Swim – 8x100",
    status: "today",
    plannedDurationMinutes: 60,
    load: 55,
    details: "8 x (100 FS in Z4 + 15 secs rest)",
    goal: "Controlled quality",
  };
  const context = {
    athlete: { id: "athlete-1", phase: "base" },
    metrics: { recovery: 30 },
    wellness: { hrv: 50 },
    history: [],
    planned: [workout],
    comments: [],
  };
  const storage = fakeStorage();
  const service = createDailyReviewService({
    readConfig: async () => ({ OPENAI_API_KEY: "test" }),
    writeConfig: async () => {},
    getContext: async () => context,
    applyWorkoutPatch: async () => ({ verified: true }),
    storage,
    decisionProvider: async (_config, value, workouts, date) =>
      (await import("./daily-review.mjs")).heuristicDecision(value, workouts, date),
    refinementProvider: async () => ({
      summary: "Extra recovery suggested",
      reason: "The athlete requested a narrower recovery allowance.",
      workouts: [
        {
          workout_id: "42",
          action: "add_recovery",
          proposed_change: "Increase only the 8x100 rest from 15 to 20 seconds.",
          target_flexibility:
            "Keep every other interval unchanged and preserve the 100-yard target.",
          execution_guidance: {
            target_ranges: [
              "8x100 yd, Strong, Z4, 15 sec rest; maintain the target and increase rest by no more than 5 seconds if needed.",
            ],
          },
          patch: {
            coachComments:
              "Only the 8x100 rest changes from 15 to 20 seconds; all other intervals stay the same.",
          },
        },
      ],
    }),
  });
  const now = new Date("2026-09-14T12:00:00Z");
  const original = await service.runDue(now, { force: true });
  const originalNotification = original.notification;
  const result = await service.refine(
    original.id,
    "Only change the 100s rest from 15 to 20 seconds; leave every other interval the same.",
    now
  );
  assert.equal(result.status, 200);
  assert.equal(result.body.review.id, original.id);
  assert.equal(result.body.review.revision, original.revision + 1);
  assert.equal(result.body.review.status, "pending_approval");
  assert.deepEqual(result.body.review.notification, originalNotification);
  assert.equal(
    result.body.review.refinements.at(-1).instruction,
    "Only change the 100s rest from 15 to 20 seconds; leave every other interval the same."
  );
});
