import { randomUUID } from "node:crypto";
import { CoachError } from "./github-coach-source.mjs";
import { athleteLocalDate } from "./athlete-date.mjs";
import {
  REPORT_TEMPLATES,
  resolveReportTarget,
  shiftReportDate,
  validateReportRequest,
  planReportBlocks,
} from "./report-targets.mjs";
import { reportSummary } from "./report-format.mjs";

const SAFE_ERROR = "Section 11 could not finish this report. Please try again.";
export const freshReport = () => ({ status: "empty" });
export function createReportSnapshotCache(source, config, now = () => Date.now()) {
  let cached,
    expires = 0,
    pending;
  return {
    invalidate() {
      cached = null;
      expires = 0;
    },
    async read(fresh = false) {
      if (!fresh && cached && now() < expires) return cached;
      if (!pending)
        pending = source
          .snapshot(config, AbortSignal.timeout(30000))
          .then((value) => {
            cached = value;
            expires = now() + 20000;
            return value;
          })
          .finally(() => {
            pending = null;
          });
      return pending;
    },
  };
}

export async function reportEligibility(target, snapshot, config, now = Date.now()) {
  const latest = snapshot.latest;
  const today = athleteLocalDate(
    new Date(now),
    latest.athlete_profile?.timezone || config.calendarTimeZone
  );
  const updated = String(latest.metadata?.last_updated || "");
  const timestamp = Date.parse(
    updated && !/(Z|[+-]\d\d:\d\d)$/.test(updated) ? updated + "Z" : updated
  );
  const reason = (message) => ({ eligible: false, reason: message });
  if (target.kind === "pre") {
    if (target.completed) return reason("This session is complete. Use its post-workout report.");
    if (target.startDate !== today)
      return reason("Pre-workout reports are available on the scheduled day.");
    const zone = latest.athlete_profile?.timezone || config.calendarTimeZone;
    const overnight = latest.wellness_data?.find((day) => day.date === today);
    if (
      !Number.isFinite(timestamp) ||
      timestamp - now > 300000 ||
      athleteLocalDate(new Date(timestamp), zone) !== today ||
      !Number.isFinite(overnight?.sleep_hours) ||
      overnight.sleep_hours <= 0 ||
      !latest.wellness_data?.some((day) => day.date === shiftReportDate(today, -1))
    )
      return reason("Waiting for today's overnight sleep and prior-day data in Section 11.");
  } else if (target.kind === "post") {
    if (!target.completed || !target.activityId)
      return reason("Available after Intervals.icu records this workout as complete.");
    const activity = latest.recent_activities?.find((a) => String(a.id) === target.activityId);
    if (!activity) {
      const retention = Number(latest.metadata?.extended_range_days) || 28;
      if (target.startDate < shiftReportDate(today, -retention))
        return reason(
          "This workout is outside the Section 11 activity export window. A new sync cannot supply its individual report data."
        );
      return {
        ...reason("Waiting for this workout to appear in the Section 11 GitHub data."),
        needsSync: true,
      };
    }
    if (activity.has_intervals) {
      const intervals = await snapshot.read("intervals.json");
      if (!intervals.activities?.some((a) => String(a.activity_id) === target.activityId))
        return {
          ...reason("The workout is synced; waiting for its interval details."),
          needsSync: true,
        };
    }
  } else {
    if (target.endDate >= today)
      return reason(
        `Available after this ${target.kind === "weekly" ? "week" : "block"} is complete.`
      );
    // Require an export created after the period closed, not merely a green workflow.
    if (
      !Number.isFinite(timestamp) ||
      athleteLocalDate(
        new Date(timestamp),
        latest.athlete_profile?.timezone || config.calendarTimeZone
      ) <= target.endDate
    )
      return reason("Waiting for Section 11 data synced after this period ended.");
    const history = await snapshot.read("history.json");
    const daily = history.daily_90d || [];
    const weekly = history.weekly_180d || [];
    const dailyDates = new Set(daily.map((r) => r.date));
    const weeklyDates = new Set(weekly.map((r) => r.week_start));
    let coversDaily = true,
      coversWeekly = true;
    for (let date = target.startDate; date <= target.endDate; date = shiftReportDate(date, 1)) {
      if (!dailyDates.has(date)) coversDaily = false;
    }
    for (let date = target.startDate; date <= target.endDate; date = shiftReportDate(date, 7)) {
      if (!weeklyDates.has(date)) coversWeekly = false;
    }
    if (!coversDaily && !coversWeekly)
      return reason("The synced history does not cover this entire period yet.");
  }
  return {
    eligible: true,
    reason: null,
    ...(target.kind === "pre" &&
    latest.recent_activities?.some((a) => String(a.date).slice(0, 10) === today)
      ? { needsCheckIn: true }
      : {}),
  };
}

export function createCoachReports({
  config,
  source,
  snapshotCache,
  sync,
  record,
  index,
  readContext,
  readPlans,
  answer,
  publish = async () => ({ skipped: true }),
  now = () => Date.now(),
  timeoutMs = 240000,
}) {
  async function resolve(request) {
    validateReportRequest(request);
    const [context, plans] = await Promise.all([
      readContext(),
      request?.kind === "block" ? readPlans() : [],
    ]);
    try {
      return resolveReportTarget(request, context, plans);
    } catch (error) {
      if (!(error instanceof CoachError) || error.status !== 404) throw error;
      // Reports outlive the rolling workout cache and later ATP edits.
      const entries = (await index.read()).reports || [];
      const entry = entries.find(
        (e) =>
          e.kind === request.kind &&
          (request.workoutId
            ? e.workoutId === request.workoutId ||
              e.key === `post:${request.workoutId.replace(/^activity:/, "")}`
            : e.planId === request.planId && e.startDate === request.startDate)
      );
      if (entry) {
        const old = await record(entry.key).read();
        if (old.status === "complete") return old.target;
      }
      throw error;
    }
  }
  async function saved(target) {
    const state = await record(target.key).read();
    if (state.status === "running" && now() - state.startedAt > timeoutMs + 60000) {
      return record(target.key).update((current) => {
        if (current.status === "running" && now() - current.startedAt > timeoutMs + 60000)
          Object.assign(current, {
            status: "error",
            error: "The previous report attempt was interrupted. You can try again.",
          });
        return current;
      });
    }
    return state;
  }
  function view(target, state, eligibility = {}) {
    return {
      target: {
        kind: target.kind,
        title: target.title,
        startDate: target.startDate,
        endDate: target.endDate,
      },
      status: state.status,
      eligible: false,
      ...eligibility,
      ...(state.status === "complete"
        ? {
            eligible: false,
            text: state.text,
            summary: state.summary || reportSummary(state.text),
            generatedAt: state.generatedAt,
            source: state.source,
          }
        : {}),
      ...(state.status === "running"
        ? { eligible: false, reason: "Section 11 is preparing your report. It will be saved here." }
        : {}),
      ...(state.status === "error" ? { error: state.error } : {}),
    };
  }
  async function status(request, retrySync = false) {
    const target = await resolve(request);
    const state = await saved(target);
    if (["complete", "running"].includes(state.status)) return view(state.target || target, state);
    const snapshot = await snapshotCache.read();
    let eligibility = await reportEligibility(target, snapshot, config, now());
    if (eligibility.needsSync) {
      await sync.queue([target.activityId], retrySync);
      const progress = await sync.poll();
      // A completed run invalidates the cache; recheck the actual exported ID.
      eligibility = await reportEligibility(target, await snapshotCache.read(), config, now());
      if (eligibility.needsSync)
        eligibility.sync = {
          status: progress.status,
          url: progress.url,
          error: progress.error,
          canRetry: ["complete", "failed"].includes(progress.status),
        };
    }
    return view(target, state, eligibility);
  }
  async function priorReports(target) {
    const childKind = { post: "pre", weekly: "post", block: "weekly" }[target.kind];
    if (!childKind) return [];
    const entries = (await index.read()).reports || [];
    const matches = entries
      .filter(
        (e) =>
          e.kind === childKind &&
          e.startDate >= target.startDate &&
          e.endDate <= target.endDate &&
          (childKind !== "pre" || e.workoutId === target.workoutId)
      )
      .slice(-24);
    const reports = await Promise.all(matches.map((e) => record(e.key).read()));
    let remaining = 100000;
    return reports
      .filter((r) => r.status === "complete")
      .map((r) => {
        const text = r.text.slice(0, Math.max(0, remaining));
        remaining -= text.length;
        return { subject: r.target, generatedAt: r.generatedAt, text, source: r.source };
      })
      .filter((r) => r.text);
  }
  async function generate(request) {
    const target = await resolve(request);
    const existing = await saved(target);
    if (["complete", "running"].includes(existing.status) && !target.force)
      return view(existing.target || target, existing);
    if (config.missing?.length)
      throw new CoachError(
        "Coach setup is incomplete. Check the server environment variables.",
        503
      );
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    let claim;
    try {
      const session = await source.open(config, abort.signal);
      const snapshot = { latest: session.latest, read: (file) => session.readData(file) };
      const eligibility = await reportEligibility(target, snapshot, config, now());
      if (!eligibility.eligible) throw new CoachError(eligibility.reason, 409);
      if (eligibility.needsCheckIn && !target.checkIn)
        throw new CoachError(
          "Before this next session, describe how you feel now, your soreness and any new pain or symptoms.",
          409
        );
      const token = randomUUID();
      claim = await record(target.key).update((state) => {
        if (["running"].includes(state.status)) return null;
        Object.assign(state, { status: "running", token, startedAt: now(), target, error: null });
        return token;
      });
      if (!claim) return view(target, await saved(target));
      const [template, hierarchy, history, intervals, previousReports] = await Promise.all([
        session.readReference(REPORT_TEMPLATES[target.kind]),
        session.readReference("REPORT_HIERARCHY.md"),
        session.readData("history.json"),
        target.kind === "post" ? session.readData("intervals.json") : null,
        priorReports(target),
      ]);
      const inPeriod = (date) =>
        typeof date === "string" &&
        date.slice(0, 10) >= target.startDate &&
        date.slice(0, 10) <= target.endDate;
      const evidence = {
        activities: snapshot.latest.recent_activities?.filter((a) => inPeriod(a.date)) || [],
        daily: history.daily_90d?.filter((r) => inPeriod(r.date)) || [],
        weekly: history.weekly_180d?.filter((r) => inPeriod(r.week_start)) || [],
        intervals: intervals?.activities?.filter((a) => inPeriod(a.date)) || [],
        previousReports,
        previousReportsAreContextOnly: true,
        currentStateCheckIn: target.kind === "pre" ? target.checkIn || null : null,
        coverage: history.data_range,
        asOf: session.metadata(),
      };
      const result = await answer({
        config,
        sourceSession: session,
        signal: abort.signal,
        reportContext: { target, template, hierarchy, evidence },
        messages: [
          {
            role: "user",
            content: `Generate the complete official Section 11 ${target.kind} report for the supplied reportSubject. This is an automatic saved report. Use the exact official template and fresh source evidence; include all same-day activities for a post-workout report, identifying the selected workout. For weekly and block reports, preserve the template's exact opening title and section labels; for a block, use the phase and week range from reportSubject, which comes from the saved Supabase annual plan. Use previous reports only for continuity. Do not schedule or change any workouts.`,
          },
        ],
      });
      const publication = await publish(target, result.text);
      const completed = await record(target.key).update((state) => {
        if (state.token !== claim || state.status !== "running") return state;
        Object.assign(state, {
          status: "complete",
          text: result.text,
          summary: result.summary || reportSummary(result.text),
          source: result.source,
          model: result.model,
          generatedAt: new Date(now()).toISOString(),
          template: { file: template.file, revision: template.revision },
          error: null,
          publication,
        });
        return state;
      });
      // Indexing aids higher-level reports; the immutable report itself is already durable.
      await index
        .update((state) => {
          const entry = {
            key: target.key,
            kind: target.kind,
            startDate: target.startDate,
            endDate: target.endDate,
            workoutId: target.workoutId,
            planId: target.planId,
          };
          state.reports = [
            ...(state.reports || []).filter((r) => r.key !== target.key),
            entry,
          ].slice(-3000);
        })
        .catch(() => {});
      return view(target, completed);
    } catch (error) {
      if (claim)
        await record(target.key).update((state) => {
          if (state.token === claim && state.status === "running")
            Object.assign(state, {
              status: "error",
              error: error instanceof CoachError ? error.message : SAFE_ERROR,
            });
        });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  async function catalog() {
    const [snapshot, plans, savedIndex] = await Promise.all([
      snapshotCache.read(),
      readPlans(),
      index.read(),
    ]);
    const today = athleteLocalDate(
      new Date(now()),
      snapshot.latest.athlete_profile?.timezone || config.calendarTimeZone
    );
    const weekday = new Date(today).getUTCDay() || 7;
    const previousMonday = shiftReportDate(today, 1 - weekday - 7);
    const weeks = Array.from({ length: 26 }, (_, i) => ({
      kind: "weekly",
      startDate: shiftReportDate(previousMonday, -7 * i),
      endDate: shiftReportDate(previousMonday, 6 - 7 * i),
    }));
    const blocks = plans.flatMap((plan) =>
      planReportBlocks(plan)
        .filter((block) => block.endDate < today)
        .map((block) => ({
          kind: "block",
          planId: plan.id,
          startDate: block.startDate,
          endDate: block.endDate,
          title: `${plan.name} · ${block.phase}`,
        }))
    );
    for (const entry of savedIndex.reports || []) {
      if (entry.kind === "weekly" && !weeks.some((w) => w.startDate === entry.startDate))
        weeks.push({ kind: "weekly", startDate: entry.startDate, endDate: entry.endDate });
      if (
        entry.kind === "block" &&
        !blocks.some((b) => b.planId === entry.planId && b.startDate === entry.startDate)
      )
        blocks.push({
          kind: "block",
          planId: entry.planId,
          startDate: entry.startDate,
          endDate: entry.endDate,
          title: "Saved block",
        });
    }
    const recentFirst = (a, b) => b.endDate.localeCompare(a.endDate);
    return { weeks: weeks.sort(recentFirst), blocks: blocks.sort(recentFirst) };
  }
  async function generateDue() {
    const context = await readContext();
    const today = athleteLocalDate(
      new Date(now()),
      context?.athlete?.time_zone || config.calendarTimeZone
    );
    const targets = [];
    const workouts = [
      ...(context?.history || []),
      ...(context?.planned || []),
      ...(context?.workouts || []),
    ];
    const unique = new Map(workouts.filter((workout) => workout?.id).map((workout) => [workout.id, workout]));
    for (const workout of unique.values()) {
      const date = String(workout.workout_date || workout.date || "").slice(0, 10);
      const completed = workout.status === "completed" || workout.completed === true;
      if (date === today && !completed) {
        const eventId = String(workout.id).match(/^(?:event:)?(\d+)$/)?.[1];
        if (eventId) targets.push({ kind: "pre", workoutId: `event:${eventId}` });
      }
      const activityId = workout.activity_id || (String(workout.id).startsWith("activity:") ? String(workout.id).slice(9) : null);
      if (completed && activityId && date >= shiftReportDate(today, -2) && date <= today)
        targets.push({ kind: "post", workoutId: `activity:${activityId}` });
    }
    const previousMonday = shiftReportDate(today, -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) - 7);
    targets.push({ kind: "weekly", startDate: previousMonday });
    for (const plan of await readPlans()) {
      for (const block of planReportBlocks(plan)) {
        if (block.endDate < today && block.endDate >= shiftReportDate(today, -7))
          targets.push({ kind: "block", planId: plan.id, startDate: block.startDate });
      }
    }
    const results = [];
    for (const target of targets) {
      try {
        results.push(await generate(target));
      } catch (error) {
        if (!(error instanceof CoachError) || ![404, 409].includes(error.status)) throw error;
      }
    }
    return results;
  }
  return { status, generate, generateDue, catalog };
}
