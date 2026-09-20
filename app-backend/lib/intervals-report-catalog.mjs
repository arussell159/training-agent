import { shiftReportDate, validReportDate } from "./report-blocks.mjs";

const REPORT_MARKER =
  /\[\[SECTION11_REPORT:(PRE(?:_WORKOUT)?|POST(?:_WORKOUT)?|WEEKLY|BLOCK)(?::([^\]]+))?\]\]/i;
const REPORT_WRAPPER = /\[\[\/?SECTION11_REPORT:[^\]]+\]\]/gi;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

function reportKind(value) {
  const kind = String(value || "").toLowerCase();
  if (kind.startsWith("pre")) return "pre";
  if (kind.startsWith("post")) return "post";
  return kind;
}

function cleanTitle(value, kind) {
  const title = String(value || "").trim();
  return title || (kind === "weekly" ? "Weekly report" : "Block report");
}

export function parseIntervalsReportNote(event) {
  const description = String(event.description || "");
  const marker = description.match(REPORT_MARKER);
  const namedKind = String(event.name || "").match(
    /Section\s*11\s+(pre(?:-workout)?|post(?:-workout)?|weekly|block)\s+report/i
  )?.[1];
  const kind = reportKind(marker?.[1] || namedKind);
  if (!["pre", "post", "weekly", "block"].includes(kind)) return null;
  if (["weekly", "block"].includes(kind) && String(event?.category || "").toUpperCase() !== "NOTE")
    return null;

  const markerDates = String(marker?.[2] || "").match(DATE) || [];
  const contentDates = `${event.name || ""}\n${description}`.match(DATE) || [];
  const eventStart = String(event.start_date_local || event.start_date || "").slice(0, 10);
  const startDate =
    markerDates[0] ||
    ((kind === "pre" || kind === "post") && eventStart) ||
    contentDates[0] ||
    eventStart;
  if (!validReportDate(startDate)) return null;
  const eventEnd = String(event.end_date_local || event.end_date || "").slice(0, 10);
  const endDate =
    kind === "pre" || kind === "post"
      ? startDate
      : markerDates[1] ||
        (kind === "weekly" && markerDates[0] ? shiftReportDate(startDate, 6) : null) ||
        contentDates.find((date) => date !== startDate) ||
        (kind === "weekly" ? shiftReportDate(startDate, 6) : eventEnd);
  if (!validReportDate(endDate) || endDate < startDate) return null;

  const text = description.replace(REPORT_WRAPPER, "").trim();
  if (!text) return null;
  const linkedId = String(marker?.[2] || description).match(
    /\b(event:\d+|activity:[A-Za-z0-9_-]{1,100})\b/i
  )?.[1];
  const workoutId =
    linkedId ||
    (kind === "pre" && event.__reportSource === "event" && event.id != null
      ? `event:${event.id}`
      : ["pre", "post"].includes(kind) && event.__reportSource === "activity" && event.id != null
        ? `activity:${event.id}`
        : null);
  if (["pre", "post"].includes(kind) && !workoutId) return null;
  return {
    id:
      kind === "weekly" || kind === "block"
        ? `intervals-note:${event.id}`
        : `intervals-${event.__reportSource || "note"}:${event.id}:${kind}`,
    kind,
    title:
      kind === "pre"
        ? "Pre-workout report"
        : kind === "post"
          ? "Post-workout report"
          : cleanTitle(event.name, kind),
    startDate,
    endDate: kind === "pre" || kind === "post" ? startDate : endDate,
    text,
    source: "intervals",
    ...(workoutId ? { workoutId } : {}),
  };
}

export function parseIntervalsReportNotes(event) {
  const description = String(event.description || "");
  const markers = [
    ...description.matchAll(
      /\[\[SECTION11_REPORT:(PRE(?:_WORKOUT)?|POST(?:_WORKOUT)?|WEEKLY|BLOCK)(?::([^\]]+))?\]\]/gi
    ),
  ];
  if (markers.length <= 1) return [parseIntervalsReportNote(event)].filter(Boolean);
  return markers.flatMap((marker, index) => {
    const body = description.slice(marker.index, markers[index + 1]?.index ?? description.length);
    const report = parseIntervalsReportNote({
      ...event,
      name: `Section 11 ${marker[1].toLowerCase()} report`,
      description: body,
    });
    return report ? [{ ...report, id: `${report.id}:${report.kind}:${report.startDate}` }] : [];
  });
}

export async function fetchIntervalsReportCatalog(request, now = new Date()) {
  const newest = now.toISOString().slice(0, 10);
  const recent = new Date(now);
  recent.setUTCDate(recent.getUTCDate() - 180);
  const [events, activities] = await Promise.all([
    request(`/athlete/0/events?oldest=2020-01-01&newest=${newest}`),
    request(
      `/athlete/0/activities?oldest=${recent.toISOString().slice(0, 10)}&newest=${newest}`
    ).catch(() => []),
  ]);
  const candidates = [
    ...(Array.isArray(events)
      ? events.map((event) => ({ ...event, __reportSource: "event" }))
      : []),
    ...(Array.isArray(activities)
      ? activities.map((activity) => ({ ...activity, __reportSource: "activity" }))
      : []),
  ];
  const reports = [
    ...new Map(
      candidates
        .flatMap(parseIntervalsReportNotes)
        .filter(Boolean)
        .map((report) => [report.id, report])
    ).values(),
  ].sort((a, b) => b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate));
  return { reports };
}

// Workout reports are stored as activity comments by the completion workflow.
// Read just the selected workout, rather than every activity's comments on navigation.
export async function fetchIntervalsWorkoutReports(request, workoutId) {
  if (!/^(event:\d+|activity:[A-Za-z0-9_-]{1,100})$/.test(workoutId))
    throw new Error("Invalid workout report target");
  const [type, id] = workoutId.split(":");
  const record = await request(type === "event" ? `/athlete/0/events/${id}` : `/activity/${id}`);
  let activityId = type === "activity" ? id : record.paired_activity_id;
  // Intervals omits paired_activity_id from its single-event response even
  // though the day-list response and paired activity both expose the link.
  if (type === "event" && !activityId && !REPORT_MARKER.test(String(record.description || ""))) {
    const date = String(record.start_date_local || record.start_date || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const activities = await request(`/athlete/0/activities?oldest=${date}&newest=${date}`);
      activityId = (Array.isArray(activities) ? activities : []).find(
        (activity) => String(activity.paired_event_id) === id
      )?.id;
    }
  }
  const candidates = [{ ...record, __reportSource: type }];
  if (activityId && /^[A-Za-z0-9_-]{1,100}$/.test(String(activityId))) {
    const [activity, messages] = await Promise.all([
      type === "activity" ? record : request(`/activity/${activityId}`),
      request(`/activity/${activityId}/messages`),
    ]);
    if (type !== "activity") candidates.push({ ...activity, __reportSource: "activity" });
    for (const message of Array.isArray(messages) ? messages : []) {
      candidates.push({
        ...activity,
        description: message.content || message.text || message.message || "",
        __reportSource: "activity",
      });
    }
  }
  const aliases = new Set([
    workoutId,
    activityId && `activity:${activityId}`,
    record.paired_event_id && `event:${record.paired_event_id}`,
  ]);
  if (type === "activity" && /^\d+$/.test(String(record.paired_event_id))) {
    const event = await request(`/athlete/0/events/${record.paired_event_id}`).catch((error) => {
      if (error.status === 404) return null;
      throw error;
    });
    if (event) candidates.push({ ...event, __reportSource: "event" });
  }
  return {
    reports: candidates
      .flatMap(parseIntervalsReportNotes)
      .filter((report) => aliases.has(report.workoutId))
      .map((report) => ({ ...report, workoutId })),
  };
}
