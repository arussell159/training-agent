import { createHash } from "node:crypto";
import { performanceAccount } from "./performance-curves.mjs";
import { validChartTag, chartTagError } from "./chart-tags-model.mjs";
import { createChartReadCache, chartReadSubscriber } from "./chart-read-cache.mjs";
export const chartTagHash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function chartTagScope(config, actor) {
  if (
    !actor?.id ||
    typeof actor.id !== "string" ||
    !actor.origin ||
    typeof actor.origin !== "string"
  )
    chartTagError("Sign in to load native recording tags.", 401, "CHART_TAG_AUTH");
  return chartTagHash([performanceAccount(config), actor.id, actor.origin]);
}
export function createChartTagsService({
  request,
  now = Date.now,
  ttl = 5 * 60_000,
  failureTtl = 60_000,
  maxEntries = 64,
} = {}) {
  const cache = createChartReadCache({
    now,
    ttl,
    failureTtl,
    maxEntries,
    busy: () =>
      Object.assign(Error("Native recording tags are busy. Retry shortly."), {
        status: 429,
        code: "CHART_TAG_BUSY",
      }),
  });
  return {
    clear: () => cache.clear(),
    async load(config, { actor, signal } = {}) {
      const accountScope = chartTagScope(config, actor);
      if (!config.INTERVALS_API_KEY)
        chartTagError("Connect Intervals.icu to load native recording tags.", 503);
      if (signal?.aborted) throw signal.reason;
      return structuredClone(
        await chartReadSubscriber(
          cache.read(accountScope, async () => {
            let tags;
            try {
              tags = await request(config)("/athlete/0/activity-tags", {
                signal: AbortSignal.timeout(60_000),
              });
            } catch {
              chartTagError();
            }
            if (
              !Array.isArray(tags) ||
              tags.length > 1000 ||
              tags.some((tag) => !validChartTag(tag)) ||
              new Set(tags).size !== tags.length
            )
              chartTagError("Native recording tags returned an unsupported or invalid catalog.");
            return {
              version: 1,
              source: "intervals-activity-tags",
              accountScope,
              revision: chartTagHash(tags),
              checkedAt: new Date(now()).toISOString(),
              tags: [...tags],
            };
          }),
          signal
        )
      );
    },
  };
}
