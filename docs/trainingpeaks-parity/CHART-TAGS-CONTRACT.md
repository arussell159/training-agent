# Native chart tag contract

This additive contract covers native recording tags for HR, Power, Cadence and duration Velocity. Reference multi-selection is ANY/OR; All is an exclusive no-filter sentinel represented as an empty selection. It does not mean every individual tag is selected. Existing unfiltered version1 readers and Home remain unchanged and perform no new catalog reads. Distance Pace is outside this slice.

`GET /api/chart-tags` accepts no query options and returns `{version:1,source:'intervals-activity-tags',accountScope,revision,checkedAt,tags}`. Scope and revision are opaque64-character lowercase hex strings; checkedAt is an ISO instant. Tags are exact native activity strings, not private app/library/calendar/TrainingPeaks tags. Successful empty `tags:[]` is distinct from HTTP failure and client loading state. App guards bound the catalog to1,000 unique nonblank strings, each at most128characters, without trimming/case/Unicode normalization or comma splitting.

Filtered requests use `GET /api/performance-curves?kind=heartRate|power|cadence|velocity&sport=<native selection>&start=YYYY-MM-DD&end=YYYY-MM-DD&tags=<JSON string array>&tagScope=<scope>&tagRevision=<revision>`. Up to20 unique exact nonblank tags are accepted. All selected values must still exist in the verified native catalog. Match mode is always ANY and cannot be changed by a query operator. Unknown/duplicate/orphan fields reject. Nonempty filters require both catalog bindings; wrong account gives409 `CHART_TAG_ACCOUNT_CHANGED`, stale revision or disappeared tag gives409 `CHART_TAG_SELECTION_CHANGED`. The filter is retained for explicit review/clear, never silently broadened. `tags=[]` normalizes to the original unfiltered reader with no scope/revision fields; tagScope/tagRevision without a nonempty filter reject. The original Power reader continues to use its existing personal-statistics endpoint when no filter is selected.

Filtered success uses version2 and does not masquerade as an unfiltered response:

```json
{
  "version": 2,
  "kind": "velocity",
  "unit": "m/s",
  "source": "intervals-tagged-activity-curves",
  "unitPolicy": "native-velocity-smooth",
  "valuePolicy": "native-reported",
  "tagsSupported": true,
  "accountScope": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "catalogRevision": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  "selection": {"sport":"Run","nativeTypes":["Run"],"tags":["Élite, morning"],"tagMatch":"any"},
  "window": {"oldest":"2026-01-01","newest":"2026-01-02"},
  "points": [
    {"duration_seconds":5,"value":0,"activity_id":"i2","native_type":"Run","date":"2026-01-02","name":null,"estimated":false,"sourceTags":["Élite, morning"]},
    {"duration_seconds":17,"value":null,"activity_id":"i2","native_type":"Run","date":"2026-01-02","name":null,"estimated":false,"sourceTags":["Élite, morning"]}
  ],
  "coverage": {
    "status":"partial","inventoryRecords":4,"matchedRecordings":2,"unmatchedRecordings":1,"unknownMembershipRecordings":1,
    "eligibleRecordings":1,"excludedWithoutStream":0,"excludedIgnoredRecordings":1,"fetchedRecordings":1,"failedRecordings":0,"missingRecordings":0,"skippedForCap":0,"unknownPoints":1,
    "invalidInventoryRecords":0,"conflictingRecordings":0
  },
  "warning":"Native recorded values and exact tag membership are retained; partial coverage remains explicit."
}
```

This is an illustrative response, not private account data. Zero is measured speed and has no finite pace conversion. Null retains known requested-source provenance and means unavailable/invalid evidence; a missing10-second point is absent rather than interpolated. Entire missing source curves contribute to missingRecordings, not fabricated point rows. HR units/policy are `bpm`/`native-bpm`; Power `W`/`native-watts`; Cadence `rpm`/`native-rpm`; Velocity `m/s`/`native-velocity-smooth`. Every kind uses valuePolicy `native-reported`. Native precision, optional indices, source names and sport-family semantics retain their prior limitations. No automatic effort highlight is introduced.

Each measured or null returned point has nonnull verified recording identity/native type/date and an exact validated `sourceTags` array containing at least one selected tag. Supplied source indices are optional structural metadata only. Missing/null/malformed membership is unknown, not empty and not eligible for a tagged winner. Explicit empty membership is known unmatched. Valid rows deduplicate by recording identity; conflicting identities and invalid source rows are excluded and counted separately, not smuggled into matching totals.

Coverage partitions valid selected-sport inventory as `inventoryRecords = matchedRecordings + unmatchedRecordings + unknownMembershipRecordings`; matching rows partition as `matchedRecordings = eligibleRecordings + excludedWithoutStream + excludedIgnoredRecordings`; `eligibleRecordings = fetchedRecordings + skippedForCap`. Failed plus missing sources cannot exceed fetched. The separate invalidInventoryRecords counter describes invalid raw rows; conflictingRecordings counts conflicting identities excluded before these partitions. Membership selection precedes the128-recording cap. Unknown membership, invalid/conflicting inventory, skipped/failed/missing sources or invalid samples mark partial. Whole source failure returns502. Genuine no matching eligible sources returns no points with truthful coverage.

Filtered HR and Power recompute duration maxima from matching individual native recording curves, rather than removing existing aggregate winners. Cadence and Velocity do the same using their documented per-stream endpoints. Eligibility retains sensor-specific whole/partial ignores, native recording duration, strict axes/provenance and bounded source validation. Source caches can be reused across filters, but membership and sourceTags are always taken from the current verified inventory snapshot; no old membership is cached as curve provenance. Catalog/window/source caches isolate trusted actor/provider scope, coalesce pending demand, bound capacity/concurrency, retain cancellation/deadlines and clear on provider refresh. HTTP errors are safe/private; no native write or settings mutation occurs.

## Implemented bounds and evidence

Catalog snapshots cache for up to5minutes; filtered membership/window snapshots refresh after at most60seconds, independently of the30minute validated recording-curve cache. Partial/missing/failed sources retry after60seconds. Refresh invalidation clears all relevant caches. These are bounded cached snapshots, not a promise of instantaneous observation of external provider edits. A regression changes membership without changing recording sync revision, expires only the membership window, and verifies current sourceTags while reusing the same cached physical curves. Whole-window pending concurrency is bounded to4, source batches to4, catalog/window entries to64 and source entries to512. Shared work has its own60second deadline; a canceled subscriber cannot cancel another subscriber's read. A response exceeding5million JSON characters rejects with a smaller-range error instead of silently truncating tags or points. These limits are app resource guards, not measured TrainingPeaks limits.

Fourteen backend regressions cover exact JSON/ANY/case/comma/Unicode rules, empty versus malformed catalog, account/revision binding, all four real per-record source paths, untagged fastest versus slower matching source, unknown membership versus explicit empty arrays, conflicting/duplicate identities, tag filtering before128-of130matching-source cap despite130additional unmatched candidates, zero/null/gaps, ignored/short sources, raw weighted recording oracle, fresh membership over cached curves, canceled/coalesced reads, failures and safe HTTP behavior. Actual localhost preview checks routed catalog/v2 reads, normal source Summary dependencies and zero native writes, plus empty-catalog409. Source fixtures also pass the unchanged actual UI workout validator and physical analysis checks. The full backend checkpoint passes830tests; integrated frontend/browser acceptance remains separate.

The only live native tag discovery returned a verified empty catalog and omitted projected membership, as recorded in `CHART-TAG-NATIVE-DISCOVERY.md`. No additional authenticated calls or provider writes were performed during implementation. Individual HR/Power source wire contracts follow the official schema; a real tagged account's populated paths were not live-probed in this slice. The synthetic oracle exercises those documented native-shaped paths without substituting aggregate winner masking or claiming measured numerical parity.

### Incremental response and retained-memory safeguards

The5million-character response bound is now enforced incrementally before a winning point or its repeated full sourceTags array is copied into the output map. A bounded metadata-only serialization reserves the header; each candidate's individual JSON cost plus its source tag JSON cost and array separator is checked before admission. Replacing a winner subtracts the old cost. No whole populated response is serialized merely to discover that it exceeds the bound, and full exact tags/values are never truncated to make it fit. A smaller-range error rejects the complete request.

Only the new filtered source/window caches opt into weight admission: at most100,000 retained source points and10million retained response JSON characters, as well as their existing entry limits. Each window processes at most100,000 projected source points; individual native curves retain their existing10,000-point guard and four-source batches. If a request budget fails, its current bounded batch settles before the active request slot is released. A cache value larger than its cache-weight allowance may be returned uncached only when it still passes the current request's point/response budgets. Default cache behavior elsewhere is unchanged. Clear, eviction and old in-flight completions use identity-safe weight accounting so an earlier promise cannot delete or charge its replacement.

Seven additional regressions check pre-copy/pre-next-point rejection with injected small budgets, exact replacement subtraction/accounting, weighted eviction/uncached admission, clear/in-flight identity, current-request point/response rejection, uncached source/window reuse and bounded batch completion. The targeted tags/resource suites pass21tests; the resulting full backend checkpoint is recorded in the resource gate artifact. Integrated frontend/browser acceptance is still separate.
