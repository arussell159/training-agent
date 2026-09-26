import { createHash } from "node:crypto";
import { CoachError } from "./github-coach-source.mjs";
import { validReportDate } from "./report-blocks.mjs";

export const COACH_REPORT_KINDS = [
  "pre_workout",
  "post_workout",
  "weekly",
  "block",
  "season",
  "nutrition",
];
const workoutReportKinds = new Set(["pre_workout", "post_workout"]);

function normalizeReportKind(value) {
  const kind = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(kind))
    throw new CoachError("Choose a valid report type name.", 400);
  return kind;
}

export function reportTitle(kind, sport, title) {
  if (workoutReportKinds.has(kind)) {
    const raw = String(sport || "").trim();
    if (!raw || raw.length > 80)
      throw new CoachError("Choose a sport for the workout report.", 400);
    const aliases = { cycling: "Bike", ride: "Bike", running: "Run", swimming: "Swim" };
    const label =
      aliases[raw.toLowerCase()] || raw.replace(/\b\w/g, (letter) => letter.toUpperCase());
    return `${label} ${kind === "pre_workout" ? "Pre" : "Post"}-Workout Report`;
  }
  const supplied = String(title || "").trim();
  if (supplied.length > 200) throw new CoachError("Report title is too long.", 400);
  const defaults = {
    weekly: "Weekly Report",
    block: "Block Report",
    season: "Season Report",
    nutrition: "Nutrition Report",
  };
  const fallback = `${kind
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())} Report`;
  return supplied || defaults[kind] || fallback;
}

export function normalizeCoachReport(input, scope = "default", now = () => new Date()) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    typeof input.kind !== "string"
  )
    throw new CoachError("Choose a valid report type name.", 400);
  const kind = normalizeReportKind(input.kind);
  const isWorkoutReport = workoutReportKinds.has(kind);
  const startDate = input.startDate;
  const endDate = input.endDate || (isWorkoutReport ? startDate : null);
  if (
    !validReportDate(startDate) ||
    !validReportDate(endDate) ||
    endDate < startDate ||
    (isWorkoutReport && endDate !== startDate)
  )
    throw new CoachError("Choose a valid report date or date range.", 400);
  const body = String(input.body ?? input.text ?? "");
  if (!body.trim() || body.length > 250_000)
    throw new CoachError("Report text is required and must be under 250,000 characters.", 400);
  const identifier = (value) => {
    const text = String(value || "").trim();
    if (text && !/^[\w:.-]{1,150}$/.test(text))
      throw new CoachError("Invalid report source identifier.", 400);
    return text || null;
  };
  const workoutId = identifier(input.workoutId);
  const eventId = identifier(input.eventId);
  const activityId = identifier(input.activityId);
  const planId = identifier(input.planId);
  const sport = isWorkoutReport ? String(input.sport || "").trim() : null;
  const title = reportTitle(kind, sport, input.title);
  const sourceKey =
    identifier(input.sourceKey) ||
    (isWorkoutReport
      ? `${kind}:${workoutId || eventId || activityId || ""}`
      : kind === "weekly"
        ? `weekly:${startDate}`
        : kind === "block"
          ? `block:${startDate}:${endDate}`
          : `${kind}:${startDate}:${endDate}`);
  if (isWorkoutReport && ![workoutId, eventId, activityId].some(Boolean))
    throw new CoachError("Choose a workout, event, or activity for this report.", 400);
  const generatedAt = input.generatedAt || now().toISOString();
  if (!Number.isFinite(Date.parse(generatedAt)))
    throw new CoachError("Invalid report generation time.", 400);
  const athleteId = identifier(input.athleteId) || "default";
  const id = createHash("sha256").update(`${scope}\0${sourceKey}`).digest("hex").slice(0, 40);
  return {
    id,
    scope,
    athlete_id: athleteId,
    kind,
    sport,
    workout_id: workoutId,
    event_id: eventId,
    activity_id: activityId,
    plan_id: planId,
    start_date: startDate,
    end_date: endDate,
    title,
    body,
    generated_at: new Date(generatedAt).toISOString(),
    source_key: sourceKey,
    updated_at: now().toISOString(),
  };
}

function publicReport(row) {
  return {
    id: row.id,
    kind: row.kind,
    sport: row.sport,
    workoutId: row.workout_id,
    eventId: row.event_id,
    activityId: row.activity_id,
    planId: row.plan_id,
    startDate: row.start_date,
    endDate: row.end_date,
    title: row.title,
    text: row.body,
    generatedAt: row.generated_at,
    sourceKey: row.source_key,
    source: "app",
  };
}

export function createCoachReportStore(bootstrap, fetchImpl = fetch, now = () => new Date()) {
  const url = String(bootstrap.SUPABASE_URL || "").replace(/\/$/, "");
  const key = bootstrap.SUPABASE_SECRET_KEY;
  const scope = bootstrap.SETTINGS_SCOPE || "default";
  if (!url.startsWith("https://") || !key)
    throw new CoachError("Report storage is unavailable. Check the Supabase connection.", 503);
  async function request(query, options = {}) {
    const response = await fetchImpl(`${url}/rest/v1/coach_reports${query}`, {
      ...options,
      signal: AbortSignal.timeout(30_000),
      headers: {
        apikey: key,
        ...(!key.startsWith("sb_secret_") ? { Authorization: `Bearer ${key}` } : {}),
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        ...options.headers,
      },
    });
    if (!response.ok) throw new CoachError(`Report storage failed (HTTP ${response.status}).`, 503);
    return response.json();
  }
  return {
    async list() {
      const rows = await request(
        `?scope=eq.${encodeURIComponent(scope)}&order=end_date.desc,generated_at.desc&limit=2000`
      );
      return { reports: rows.map(publicReport) };
    },
    async get(id) {
      const rows = await request(
        `?scope=eq.${encodeURIComponent(scope)}&id=eq.${encodeURIComponent(id)}&limit=1`
      );
      return rows[0] ? publicReport(rows[0]) : null;
    },
    async upsert(input) {
      const rows = await this.upsertMany([input]);
      return rows[0];
    },
    async upsertMany(inputs) {
      if (!inputs.length) return [];
      const byKey = new Map(
        inputs.map((input) => {
          const row = normalizeCoachReport(input, scope, now);
          return [row.source_key, row];
        })
      );
      const rows = await request("?on_conflict=scope,source_key", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify([...byKey.values()]),
      });
      return rows.map(publicReport);
    },
  };
}
