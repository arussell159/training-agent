import { apiFetch } from "./api-client.ts"
import { createSharedRequestCache } from "./shared-request-cache.ts"
import {
  validDashboardDate,
  type DashboardChartRange,
} from "./dashboard-chart-settings.ts"
import {
  chartTagKindPolicy,
  chartTagSportMatches,
  validChartTag,
  taggedCurveSelection,
  type ChartTagCatalog,
  type ChartTagKind,
  type TaggedCurveResult,
} from "../../../app-backend/lib/chart-tags-model.mjs"

export type { ChartTagCatalog, TaggedCurveResult }
export function validDashboardTags(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= 20 &&
    new Set(value).size === value.length &&
    value.every(validChartTag)
  )
}
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const hash = (value: unknown) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value)
const count = (value: unknown) =>
  Number.isSafeInteger(value) && Number(value) >= 0
const invalid = () =>
  Error(
    "Recording tags returned invalid or mismatched data. Previous results are retained."
  )
export function parseDashboardTagCatalog(value: unknown): ChartTagCatalog {
  const body = object(value)
  if (
    !body ||
    body.version !== 1 ||
    body.source !== "intervals-activity-tags" ||
    !hash(body.accountScope) ||
    !hash(body.revision) ||
    typeof body.checkedAt !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T/.test(body.checkedAt) ||
    !Number.isFinite(Date.parse(body.checkedAt)) ||
    !Array.isArray(body.tags) ||
    body.tags.length > 1000 ||
    new Set(body.tags).size !== body.tags.length ||
    !body.tags.every(validChartTag)
  )
    throw invalid()
  return structuredClone(body) as ChartTagCatalog
}
export function parseDashboardTaggedCurve(
  value: unknown,
  kind: ChartTagKind,
  sport: string,
  range: DashboardChartRange,
  today: string,
  tags: readonly string[],
  catalog: ChartTagCatalog
): TaggedCurveResult {
  if (
    !validDashboardTags(tags) ||
    !tags.length ||
    tags.some((tag) => !catalog.tags.includes(tag))
  )
    throw Error(
      "Selected recording tags have changed. Reload tags or explicitly clear the selection."
    )
  const requested = taggedCurveSelection(
    {
      kind,
      sport,
      start: range.start,
      end: range.end,
      tags: JSON.stringify(tags),
      tagScope: catalog.accountScope,
      tagRevision: catalog.revision,
    },
    today
  )
  const body = object(value),
    selection = object(body?.selection),
    window = object(body?.window),
    coverage = object(body?.coverage),
    policy = chartTagKindPolicy[kind]
  if (
    !body ||
    body.version !== 2 ||
    body.kind !== kind ||
    body.unit !== policy.unit ||
    body.source !== "intervals-tagged-activity-curves" ||
    body.unitPolicy !== policy.unitPolicy ||
    body.valuePolicy !== "native-reported" ||
    body.tagsSupported !== true ||
    body.accountScope !== catalog.accountScope ||
    body.catalogRevision !== catalog.revision ||
    !selection ||
    selection.sport !== requested.sport ||
    JSON.stringify(selection.nativeTypes) !==
      JSON.stringify(requested.nativeTypes) ||
    JSON.stringify(selection.tags) !== JSON.stringify(tags) ||
    selection.tagMatch !== "any" ||
    !window ||
    window.oldest !== range.start ||
    window.newest !== range.end ||
    !coverage ||
    !["available-recordings", "partial"].includes(String(coverage.status)) ||
    !Array.isArray(body.points) ||
    body.points.length > 10000 ||
    typeof body.warning !== "string" ||
    body.warning.length > 4000
  )
    throw invalid()
  const names = [
    "inventoryRecords",
    "matchedRecordings",
    "unmatchedRecordings",
    "unknownMembershipRecordings",
    "eligibleRecordings",
    "excludedWithoutStream",
    "excludedIgnoredRecordings",
    "fetchedRecordings",
    "failedRecordings",
    "missingRecordings",
    "skippedForCap",
    "unknownPoints",
    "invalidInventoryRecords",
    "conflictingRecordings",
  ]
  if (
    names.some((name) => !count(coverage[name])) ||
    names.some((name) => Number(coverage[name]) > 100000) ||
    Number(coverage.fetchedRecordings) > 128 ||
    coverage.inventoryRecords !==
      Number(coverage.matchedRecordings) +
        Number(coverage.unmatchedRecordings) +
        Number(coverage.unknownMembershipRecordings) ||
    coverage.matchedRecordings !==
      Number(coverage.eligibleRecordings) +
        Number(coverage.excludedWithoutStream) +
        Number(coverage.excludedIgnoredRecordings) ||
    coverage.eligibleRecordings !==
      Number(coverage.fetchedRecordings) + Number(coverage.skippedForCap) ||
    Number(coverage.failedRecordings) + Number(coverage.missingRecordings) >
      Number(coverage.fetchedRecordings)
  )
    throw invalid()
  let previous = 0,
    unknown = 0
  const identities = new Map<string, string>()
  for (const item of body.points) {
    const point = object(item)
    if (
      !point ||
      !Number.isSafeInteger(point.duration_seconds) ||
      Number(point.duration_seconds) <= previous ||
      point.estimated !== false ||
      (point.value !== null &&
        (typeof point.value !== "number" ||
          !Number.isFinite(point.value) ||
          point.value < 0)) ||
      typeof point.activity_id !== "string" ||
      !/^i?[1-9]\d{0,29}$/.test(point.activity_id) ||
      typeof point.native_type !== "string" ||
      !(requested.sport === "all"
        ? chartTagSportMatches(point.native_type, "all")
        : requested.nativeTypes.some((type) =>
            chartTagSportMatches(String(point.native_type), type)
          )) ||
      !validDashboardDate(point.date) ||
      point.date < range.start ||
      point.date > range.end ||
      (point.name !== null &&
        (typeof point.name !== "string" || point.name.length > 512)) ||
      !Array.isArray(point.sourceTags) ||
      point.sourceTags.length > 1000 ||
      new Set(point.sourceTags).size !== point.sourceTags.length ||
      !point.sourceTags.every(validChartTag) ||
      !tags.some((tag) => (point.sourceTags as string[]).includes(tag))
    )
      throw invalid()
    const identity = JSON.stringify([
      point.native_type,
      point.date,
      point.name,
      [...(point.sourceTags as string[])].sort(),
    ])
    if (
      identities.has(point.activity_id) &&
      identities.get(point.activity_id) !== identity
    )
      throw invalid()
    identities.set(point.activity_id, identity)
    if (
      (point.start_index !== undefined || point.end_index !== undefined) &&
      (!Number.isSafeInteger(point.start_index) ||
        !Number.isSafeInteger(point.end_index) ||
        Number(point.start_index) < 0 ||
        Number(point.end_index) <= Number(point.start_index))
    )
      throw invalid()
    previous = Number(point.duration_seconds)
    if (point.value === null) unknown++
  }
  if (
    coverage.unknownPoints !== unknown ||
    identities.size > Number(coverage.fetchedRecordings) ||
    (body.points.length && !Number(coverage.fetchedRecordings)) ||
    (coverage.status === "available-recordings" &&
      [
        "unknownMembershipRecordings",
        "skippedForCap",
        "failedRecordings",
        "missingRecordings",
        "unknownPoints",
        "invalidInventoryRecords",
        "conflictingRecordings",
      ].some((name) => Number(coverage[name]) !== 0))
  )
    throw invalid()
  return structuredClone(body) as TaggedCurveResult
}
type Request = (path: string, options?: RequestInit) => Promise<Response>
export function createDashboardTagClient(
  request: Request = apiFetch,
  { readTimeoutMs = 65000 }: { readTimeoutMs?: number } = {}
) {
  let active = 0
  const readers = new Set<AbortController>()
  const waiting: { start: () => void }[] = []
  const acquire = (signal: AbortSignal) =>
    new Promise<() => void>((resolve, reject) => {
      const entry = {
        start: () => {
          signal.removeEventListener("abort", abort)
          active++
          let released = false
          resolve(() => {
            if (released) return
            released = true
            active--
            while (active < 4 && waiting.length) waiting.shift()!.start()
          })
        },
      }
      const abort = () => {
        const index = waiting.indexOf(entry)
        if (index >= 0) waiting.splice(index, 1)
        reject(signal.reason || new DOMException("Aborted", "AbortError"))
      }
      if (signal.aborted) {
        abort()
        return
      }
      if (active < 4) entry.start()
      else {
        waiting.push(entry)
        signal.addEventListener("abort", abort, { once: true })
      }
    })
  const catalogCache = createSharedRequestCache<ChartTagCatalog>(
    async (_key, signal) => {
      const response = await request("/api/chart-tags", {
          signal,
          headers: { Accept: "application/json" },
        }),
        body = await response.json()
      signal.throwIfAborted()
      if (!response.ok)
        throw Error(
          typeof body?.error === "string"
            ? body.error
            : "Recording tags could not load."
        )
      return parseDashboardTagCatalog(body)
    },
    { maxEntries: 8, ttlMs: 60000, timeoutMs: 20000 }
  )
  const generations = new Map<string, number>(),
    revisions = new Map<string, number>()
  const readCatalog = (
    scope: string,
    { signal, force = false }: { signal?: AbortSignal; force?: boolean } = {}
  ) => {
    if (force) generations.set(scope, (generations.get(scope) || 0) + 1)
    return catalogCache
      .get(JSON.stringify([scope, generations.get(scope) || 0]), signal)
      .then((value) => structuredClone(value))
  }
  const curveCache = createSharedRequestCache<TaggedCurveResult>(
    async (key, signal) => {
      const [, kind, sport, range, today, tags, catalog] = JSON.parse(key) as [
        string,
        ChartTagKind,
        string,
        DashboardChartRange,
        string,
        string[],
        ChartTagCatalog,
        number,
      ]
      if (tags.some((tag) => !catalog.tags.includes(tag)))
        throw Error(
          "Selected recording tags are no longer available. Reload tags or explicitly clear the selection."
        )
      signal.throwIfAborted()
      const response = await request(
          `/api/performance-curves?${new URLSearchParams({ kind, sport, start: range.start, end: range.end, tags: JSON.stringify(tags), tagScope: catalog.accountScope, tagRevision: catalog.revision })}`,
          { signal, headers: { Accept: "application/json" } }
        ),
        body = await response.json()
      signal.throwIfAborted()
      if (!response.ok)
        throw Error(
          typeof body?.error === "string"
            ? body.error
            : "Filtered recording history could not load. Reload tags before retrying a changed selection."
        )
      return parseDashboardTaggedCurve(
        body,
        kind,
        sport,
        range,
        today,
        tags,
        catalog
      )
    },
    { maxEntries: 32, ttlMs: 60000, timeoutMs: readTimeoutMs }
  )
  return {
    catalog: readCatalog,
    load: async (
      scope: string,
      kind: ChartTagKind,
      sport: string,
      range: DashboardChartRange,
      today: string,
      tags: readonly string[],
      { signal, revision = 0 }: { signal?: AbortSignal; revision?: number } = {}
    ) => {
      if (!validDashboardTags(tags) || !tags.length)
        return Promise.reject(Error("Choose valid recording tags."))
      const controller = new AbortController()
      const abort = () => controller.abort(signal?.reason)
      if (signal?.aborted) abort()
      else signal?.addEventListener("abort", abort, { once: true })
      readers.add(controller)
      try {
        const changed =
          revisions.has(scope) && revisions.get(scope) !== revision
        revisions.set(scope, revision)
        const catalog = await readCatalog(scope, {
          signal: controller.signal,
          force: changed,
        })
        // Waiting for another window must not consume this read's network deadline.
        const release = await acquire(controller.signal)
        try {
          return structuredClone(
            await curveCache.get(
              JSON.stringify([
                scope,
                kind,
                sport,
                range,
                today,
                tags,
                catalog,
                revision,
              ]),
              controller.signal
            )
          )
        } finally {
          release()
        }
      } finally {
        signal?.removeEventListener("abort", abort)
        readers.delete(controller)
      }
    },
    clear: () => {
      for (const controller of readers)
        controller.abort(new DOMException("Chart reads reset", "AbortError"))
      readers.clear()
      catalogCache.clear()
      curveCache.clear()
      generations.clear()
      revisions.clear()
    },
  }
}
export const dashboardTagClient = createDashboardTagClient()
if (typeof window !== "undefined")
  for (const event of [
    "app-auth-required",
    "training-cache-reset",
    "training-mutation-settled",
  ])
    window.addEventListener(event, () => dashboardTagClient.clear())
