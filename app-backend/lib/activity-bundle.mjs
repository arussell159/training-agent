import { createHash } from "node:crypto";
import { readFitLaps, readFitSwimLengths, normalizeAnalysis } from "./activity-analysis.mjs";
import { activityRoute } from "./activity-route.mjs";
import { recordedExtremes } from "./recorded-extremes.mjs";
import { mapIntervalsWorkout } from "./intervals.mjs";
import { elapsedSummary } from "./elapsed-summary.mjs";
import { providerConnection } from "./completed-workout-store.mjs";
const bundleRequests = new Map();

export async function downloadOriginalActivityFile(config, id, fetchImpl = fetch) {
  const response = await fetchImpl(`https://intervals.icu/api/v1/activity/${id}/file`, {
    headers: {
      Authorization: `Basic ${Buffer.from("API_KEY:" + config.INTERVALS_API_KEY).toString("base64")}`,
    },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Original activity file download failed (${response.status})`);
  return Buffer.from(await response.arrayBuffer());
}

export async function downloadActivityBundle(request, id, downloadFile) {
  if (!/^(i\d+|\d+)$/.test(String(id))) throw new Error("Invalid activity ID");
  // Metadata, recording streams and the original file have independent requests.
  const activityPromise = request(`/activity/${id}?intervals=true`);
  const [activity, streams, bytes] = await Promise.all([
    activityPromise,
    downloadActivityStreams(request, id),
    activityPromise.then((activity) => (activity.file_type ? downloadFile(id) : null)),
  ]);
  const fitLaps = bytes && activity.file_type === "fit" ? readFitLaps(bytes) : [];
  const fitSwimLengths =
    bytes && activity.file_type === "fit" && /swim/i.test(activity.type || "")
      ? readFitSwimLengths(bytes)
      : [];
  const analysis = normalizeAnalysis(activity, streams, fitLaps, fitSwimLengths);
  const summary = mapIntervalsWorkout(
    activity,
    String(activity.start_date_local || "").slice(0, 10),
    null,
    true
  ).workout_summary.completed;
  Object.assign(summary, recordedExtremes(streams));
  return {
    version: 1,
    activity,
    streams,
    fitLaps,
    fitSwimLengths,
    analysis,
    summary,
    route: activityRoute(streams),
    original_file: bytes
      ? {
          type: activity.file_type,
          encoding: "base64",
          data: bytes.toString("base64"),
          bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex"),
        }
      : null,
    availability: { streams: streams.length > 0, original_file: Boolean(bytes) },
  };
}

export async function loadActivityBundle(archive, config, request, id, options = {}) {
  const key = `${providerConnection(config)}:${id}:${options.revision || ""}:${Boolean(options.force)}`;
  if (bundleRequests.has(key)) return bundleRequests.get(key);
  const operation = readActivityBundle(archive, config, request, id, options);
  bundleRequests.set(key, operation);
  try {
    return await operation;
  } finally {
    if (bundleRequests.get(key) === operation) bundleRequests.delete(key);
  }
}
async function readActivityBundle(archive, config, request, id, options) {
  const bundle = await archive.load(
    id,
    "bundle",
    () =>
      downloadActivityBundle(request, id, (fileId) => downloadOriginalActivityFile(config, fileId)),
    options
  );
  if (archive.ready)
    await archive.saveViews(
      id,
      {
        analysis: bundle.analysis,
        summary: bundle.summary,
        route: bundle.route,
        "route-full": bundle.route,
      },
      options.revision
    );
  return bundle;
}

export async function loadActivityView(archive, config, request, id, kind, options = {}) {
  // Maps need only GPS streams. Never wait for FIT download, lap parsing or charts.
  if (kind === "route")
    return archive.loadView(
      id,
      "route-full",
      async () => activityRoute(await downloadActivityStreams(request, id)),
      options
    );
  let view = await archive.loadView(
    id,
    kind,
    async ({ force } = {}) =>
      (await loadActivityBundle(archive, config, request, id, { ...options, force }))[kind],
    options
  );
  if (kind === "analysis" && view.version !== 8) {
    const bundle = await archive.load(id, "bundle", () =>
      downloadActivityBundle(request, id, (fileId) => downloadOriginalActivityFile(config, fileId))
    );
    const fitSwimLengths =
      bundle.fitSwimLengths ??
      (/swim/i.test(bundle.activity.type || "") && bundle.original_file?.type === "fit"
        ? readFitSwimLengths(Buffer.from(bundle.original_file.data, "base64"))
        : []);
    view = normalizeAnalysis(bundle.activity, bundle.streams, bundle.fitLaps, fitSwimLengths);
    if (archive.ready) await archive.saveViews(id, { analysis: view });
  }
  if (
    kind === "summary" &&
    (view.elapsed_time_seconds === undefined || view.normalized_power === undefined)
  ) {
    const bundle = await archive.load(id, "bundle", () =>
      downloadActivityBundle(request, id, (fileId) => downloadOriginalActivityFile(config, fileId))
    );
    Object.assign(view, elapsedSummary(bundle.activity), {
      normalized_power: bundle.activity.icu_weighted_avg_watts ?? null,
    });
    if (archive.ready)
      await archive.saveViews(id, {
        summary: view,
        route: bundle.route,
      });
  }
  return view;
}

export async function downloadActivityStreams(request, id) {
  try {
    return (await request(`/activity/${id}/streams.json`)) || [];
  } catch (error) {
    if (error.status !== 404) throw error;
    return [];
  }
}
