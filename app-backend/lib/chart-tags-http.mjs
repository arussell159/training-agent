import { parseChartTagFilter, chartTagError } from "./chart-tags-model.mjs";
const write = (res, status, value) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "private,no-store",
  });
  res.end(JSON.stringify(value));
};
const denied = (req, res) => {
  if (!req.appActor?.id || !req.appActor?.origin) {
    write(res, 401, { error: "Sign in to load native recording tags.", code: "CHART_TAG_AUTH" });
    return true;
  }
  if (req.method !== "GET") {
    write(res, 405, { error: "Native chart tags are read-only.", code: "CHART_TAG_METHOD" });
    return true;
  }
  return false;
};
const failure = (res, error) => {
  const known = [
    "CHART_TAG_AUTH",
    "CHART_TAG_INVALID",
    "CHART_TAG_ACCOUNT_CHANGED",
    "CHART_TAG_SELECTION_CHANGED",
    "CHART_TAG_UNAVAILABLE",
    "CHART_TAG_BUSY",
  ].includes(error?.code);
  write(res, known ? error.status : 502, {
    error: known ? error.message : "Native tagged chart data could not be verified. Please retry.",
    code: known ? error.code : "CHART_TAG_UNAVAILABLE",
  });
};
export function createChartTagsEndpoint({ service, readConfig }) {
  return async (req, res) => {
    if (denied(req, res)) return;
    try {
      if ([...new URL(req.url, "http://localhost").searchParams].length)
        chartTagError("Native tag catalog options are not supported.", 400, "CHART_TAG_INVALID");
      write(res, 200, await service.load(await readConfig(), { actor: req.appActor }));
    } catch (error) {
      failure(res, error);
    }
  };
}
export function createTaggedCurvesEndpoint({
  service,
  readConfig,
  readTimeZone = async () => "America/Chicago",
  unfiltered,
}) {
  return async (req, res) => {
    if (denied(req, res)) return;
    try {
      const url = new URL(req.url, "http://localhost"),
        keys = [...url.searchParams.keys()];
      if (
        new Set(keys).size !== keys.length ||
        keys.some(
          (key) =>
            !["kind", "sport", "start", "end", "tags", "tagScope", "tagRevision"].includes(key)
        )
      )
        chartTagError("Choose supported native tagged chart options.", 400, "CHART_TAG_INVALID");
      const filter = parseChartTagFilter(Object.fromEntries(url.searchParams));
      if (!filter.tags.length) {
        if (!unfiltered)
          chartTagError(
            "Use the original chart reader without a tag filter.",
            400,
            "CHART_TAG_INVALID"
          );
        url.searchParams.delete("tags");
        const original = req.url;
        req.url = url.pathname + url.search;
        try {
          return await unfiltered(req, res);
        } finally {
          req.url = original;
        }
      }
      write(
        res,
        200,
        await service.load(await readConfig(), Object.fromEntries(url.searchParams), {
          actor: req.appActor,
          timeZone: await readTimeZone(),
        })
      );
    } catch (error) {
      failure(res, error);
    }
  };
}
