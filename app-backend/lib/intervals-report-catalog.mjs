import { shiftReportDate, validReportDate } from "./report-blocks.mjs";

const REPORT_MARKER = /\[\[SECTION11_REPORT:(WEEKLY|BLOCK)(?::([^\]]+))?\]\]/i;
const REPORT_WRAPPER = /\[\[\/?SECTION11_REPORT:[^\]]+\]\]/gi;
const DATE = /\b\d{4}-\d{2}-\d{2}\b/g;

function cleanTitle(value, kind) {
  const title = String(value || "").trim();
  return title || (kind === "weekly" ? "Weekly report" : "Block report");
}

export function parseIntervalsReportNote(event) {
  if (String(event?.category || "").toUpperCase() !== "NOTE") return null;
  const description = String(event.description || "");
  const marker = description.match(REPORT_MARKER);
  const namedKind = String(event.name || "").match(/Section\s*11\s+(weekly|block)\s+report/i)?.[1];
  const kind = String(marker?.[1] || namedKind || "").toLowerCase();
  if (!["weekly", "block"].includes(kind)) return null;

  const markerDates = String(marker?.[2] || "").match(DATE) || [];
  const contentDates = `${event.name || ""}\n${description}`.match(DATE) || [];
  const eventStart = String(event.start_date_local || event.start_date || "").slice(0, 10);
  const startDate = markerDates[0] || contentDates[0] || eventStart;
  if (!validReportDate(startDate)) return null;
  const eventEnd = String(event.end_date_local || event.end_date || "").slice(0, 10);
  const endDate =
    markerDates[1] ||
    (kind === "weekly" && markerDates[0] ? shiftReportDate(startDate, 6) : null) ||
    contentDates.find((date) => date !== startDate) ||
    (kind === "weekly" ? shiftReportDate(startDate, 6) : eventEnd);
  if (!validReportDate(endDate) || endDate < startDate) return null;

  const text = description.replace(REPORT_WRAPPER, "").trim();
  if (!text) return null;
  return {
    id: `intervals-note:${event.id}`,
    kind,
    title: cleanTitle(event.name, kind),
    startDate,
    endDate,
    text,
    source: "intervals",
  };
}

export function parseIntervalsReportNotes(event) {
  const description = String(event.description || '');
  const markers = [...description.matchAll(/\[\[SECTION11_REPORT:(WEEKLY|BLOCK)(?::([^\]]+))?\]\]/gi)];
  if (markers.length <= 1) return [parseIntervalsReportNote(event)].filter(Boolean);
  return markers.flatMap((marker, index) => {
    const body = description.slice(marker.index, markers[index + 1]?.index ?? description.length);
    const report = parseIntervalsReportNote({ ...event, name: `Section 11 ${marker[1].toLowerCase()} report`, description: body });
    return report ? [{ ...report, id: `${report.id}:${report.kind}:${report.startDate}` }] : [];
  });
}

export async function fetchIntervalsReportCatalog(request, now = new Date()) {
  const newest = now.toISOString().slice(0, 10);
  const events = await request(`/athlete/0/events?oldest=2020-01-01&newest=${newest}`);
  const reports = (Array.isArray(events) ? events : [])
    .flatMap(parseIntervalsReportNotes)
    .filter(Boolean)
    .sort((a, b) => b.endDate.localeCompare(a.endDate) || b.startDate.localeCompare(a.startDate));
  return { reports };
}
