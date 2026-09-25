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
  if (target.endDate >= today)
    return reason(
      `Available after this ${target.kind === "weekly" ? "week" : "block"} is complete.`
    );
  if (
    !Number.isFinite(timestamp) ||
    athleteLocalDate(
      new Date(timestamp),
      latest.athlete_profile?.timezone || config.calendarTimeZone
    ) <= target.endDate
  )
    return reason("Waiting for Section 11 data synced after this period ended.");
  const history = await snapshot.read("history.json");
  const dailyDates = new Set((history.daily_90d || []).map((r) => r.date));
  const weeklyDates = new Set((history.weekly_180d || []).map((r) => r.week_start));
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
  return {
    eligible: true,
    reason: null,
  };
}

export function createCoachReports({
  config,
  source,
  snapshotCache,
  record,
  index,
  readContext,
  readPlans,
  answer,
  saveReport = async () => null,
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
          e.planId === request.planId &&
          e.startDate === request.startDate
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
  async function status(request) {
    const target = await resolve(request);
    const state = await saved(target);
    if (["complete", "running"].includes(state.status)) return view(state.target || target, state);
    const snapshot = await snapshotCache.read();
    const eligibility = await reportEligibility(target, snapshot, config, now());
    return view(target, state, eligibility);
  }
  async function priorReports(target) {
    const childKind = target.kind === "block" ? "weekly" : null;
    if (!childKind) return [];
    const entries = (await index.read()).reports || [];
    const matches = entries
      .filter(
        (e) =>
          e.kind === childKind &&
          e.startDate >= target.startDate &&
          e.endDate <= target.endDate &&
          true
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
      const token = randomUUID();
      claim = await record(target.key).update((state) => {
        if (["running"].includes(state.status)) return null;
        Object.assign(state, { status: "running", token, startedAt: now(), target, error: null });
        return token;
      });
      if (!claim) return view(target, await saved(target));
      const [template, hierarchy, history, previousReports] = await Promise.all([
        session.readReference(REPORT_TEMPLATES[target.kind]),
        session.readReference("REPORT_HIERARCHY.md"),
        session.readData("history.json"),
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
        previousReports,
        previousReportsAreContextOnly: true,
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
            content: `Generate the complete official Section 11 ${target.kind} report for the supplied reportSubject. Use the exact official template and fresh source evidence. Preserve the template's exact opening title and section labels; for a block, use the phase and week range from reportSubject, which comes from the saved Supabase annual plan. Use previous weekly reports only for continuity. Do not schedule or change any workouts.`,
          },
        ],
      });
      const generatedAt = new Date(now()).toISOString();
      const stored = await saveReport({
        kind: target.kind,
        planId: target.planId,
        startDate: target.startDate,
        endDate: target.endDate,
        title: target.title,
        body: result.text,
        generatedAt,
      });
      const completed = await record(target.key).update((state) => {
        if (state.token !== claim || state.status !== "running") return state;
        Object.assign(state, {
          status: "complete",
          text: result.text,
          summary: result.summary || reportSummary(result.text),
          source: result.source,
          model: result.model,
          generatedAt,
          template: { file: template.file, revision: template.revision },
          error: null,
          publication: { location: "app", reportId: stored?.id || null },
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
  async function savedReports() {
    const entries = (await index.read()).reports || [];
    const states = await Promise.all(entries.map((entry) => record(entry.key).read()));
    return states.flatMap((state, position) => {
      if (state.status !== "complete" || !state.text) return [];
      const entry = entries[position],
        target = state.target || entry;
      const kind = { pre: "pre_workout", post: "post_workout" }[entry.kind] || entry.kind;
      if (!["pre_workout", "post_workout", "weekly", "block"].includes(kind)) return [];
      const workout = kind.endsWith("_workout");
      const recordedSport = target.workout?.sport || target.workout?.planned?.sport || target.sport;
      const sport =
        recordedSport && String(recordedSport).toLowerCase() !== "workout"
          ? recordedSport
          : "Other";
      return [
        {
          kind,
          ...(workout
            ? {
                sport,
                workoutId: entry.workoutId || target.workoutId,
                eventId: target.eventId,
                activityId: target.activityId,
              }
            : {}),
          planId: entry.planId,
          startDate: entry.startDate,
          endDate: entry.endDate || target.endDate,
          title: target.title,
          body: state.text,
          generatedAt: state.generatedAt,
        },
      ];
    });
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
    const unique = new Map(
      workouts.filter((workout) => workout?.id).map((workout) => [workout.id, workout])
    );
    const previousMonday = shiftReportDate(
      today,
      -((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) - 7
    );
    const previousSunday = shiftReportDate(previousMonday, 6);
    const previousWeek = [...unique.values()].filter((workout) => {
      const date = String(workout.workout_date || workout.date || "").slice(0, 10);
      return date >= previousMonday && date <= previousSunday;
    });
    const hasUncompletedScheduledWorkout = previousWeek.some(
      (workout) => workout.status !== "completed" && workout.completed !== true
    );
    if (previousWeek.length && !hasUncompletedScheduledWorkout)
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
  return { status, generate, generateDue, catalog, savedReports };
}
