# Recording-tag filtering proposal

Read-only repository/schema investigation. This agent made no live provider calls, configuration changes or product edits. Later root-owned reference observation establishes the union/any and exclusive All behavior described below; native dataset differences remain explicit.

## Existing inputs

There is no current app route that lists authenticated native recording tags. The Tags editor in `desktop-workout-personal-fields.tsx` stores private, per-workout strings through `workout-personal.mjs`; it is not a projection of native Activity tags and must not silently become the chart's native tag catalog. Library reconciliation also uses native **library-workout** tags, including app-generated identity tags. Those are not recording tags.

The archived official schema at `artifacts/trainingpeaks-parity/public-intervals-openapi.json` declares:

- `GET /api/v1/athlete/{id}/activity-tags`: the account's applied activity-tag strings.
- Distinct `event-tags` and `workout-tags` endpoints for calendar/library objects.
- `Activity.tags`: an array of strings, allowing exact per-recording membership.
- Athlete Power/HR curves and bulk activity Power/HR curves accept ActivityFilter arrays; `field_id` includes `tags`. The schema does not specify valid tag operators, value shape or query serialization sufficiently to invent a working filter.
- Individual recorded HR and power curves are available at `activity/{id}/hr-curve.json` and `power-curve.json`. Existing cadence/velocity services already request exact per-recording streams.

Current narrow HR/cadence/velocity inventories omit `tags`, and compact calendar projections do not preserve authoritative native recording-tag membership. The existing unfiltered aggregate Power/HR winners are insufficient for filtering: removing an untagged winner does not recover the second-best tagged recording.

## Recommended bounded path

Add an authenticated read-only account catalog backed by native `activity-tags`, with strict string/array bounds, source, opaque account scope, revision and fetch time. Do not union library, event, private app or TrainingPeaks tag names into it. Load actual tags asynchronously; distinguish loading, failure and a verified empty catalog. Preserve exact case, Unicode and punctuation. Do not normalize names or split tags on commas.

Add `tags` to each narrow native recording inventory. Explicit validated arrays provide known membership; an empty array is known untagged. Missing/null membership must remain unknown until native semantics are verified. The activities endpoint's `fields` projection explicitly excludes null values, so missing fields cannot currently establish empty membership. Exclude unknown membership from a filtered winner pool and declare incomplete membership coverage; never claim complete matching or broaden the request. Verify duplicate/conflicting recording metadata and bounds as for existing source eligibility.

For cadence and velocity, apply the tag predicate before the source-fetch cap and existing stream/ignore/length checks, then recompute exact-duration maxima from matching source curves. Reuse source curves across tag selections when their recording identity/revision/eligibility is unchanged. Keep the existing cap and report skipped, missing, failed and unverified membership separately.

For Power and HR, either independently verify native ActivityFilter serialization/semantics and verify every winning source's membership, or aggregate bounded matching **individual recording curves**. The latter has a documented per-record endpoint and does not require invented native filter operators. It needs explicit source-cap/partial coverage and preserves exact native axes. Do not filter only the existing aggregate winner list. Do not add tag reads to Home's personal-statistics requests; a dedicated demand-driven filtered Power path can preserve existing unfiltered Home behavior. Bulk curves are another option only with bounded payloads and verified request behavior.

## Selection, transport and persistence

Root's later disposable-chart observation found that Running+Cycling produces the pointwise union maximum of those separate grids at all fifteen anchors. No AND control was present. All is an exclusive sentinel that clears individual selections and restores an empty filter; it does not select every current tag. The accepted implementation therefore uses explicit any semantics and exact JSON tag strings, not CSV. Validate unknown/duplicate fields, duplicate tag values, count/length bounds and current account ownership before provider reads. A disappeared selected tag must not be silently removed, because that broadens results; retain it with a clear reload/clear decision. Native discovery separately returned an empty activity-tag catalog and absent projected tag membership on the inspected records; populated reference tags cannot be copied into that native dataset.

Keep new per-chart tag preferences optional with no-filter defaults for old layouts. A filtered response must bind its exact tags, match mode, native sports and both date windows. A versioned tag-aware DTO should include tag coverage and each measured winner's verified matching tag evidence. Existing version1 unfiltered responses must never satisfy a tagged request merely because they say `tagsSupported:true`. Preserve normal no-filter behavior while deploying compatible clients/server together.

Comparison uses the same chart tag selection for both independently loaded ranges unless reference observation establishes otherwise. Atomically publish a valid pair. Late tag-catalog loads cannot overwrite edited settings; late curve responses cannot replace a newer tag selection. On errors retain the prior snapshot with its actual prior filter, not the newly requested label. Apply/Apply & Close still await verified preference persistence.

## Isolation and acceptance

Cache catalog/membership/aggregate reads by trusted actor and provider/account scope, selected tags/mode, native sports, date window and applicable revision. Recording curve caches remain source-specific. Clear relevant caches on auth/account changes and provider refresh; a tag edit may change eligibility without changing recording samples. Preserve existing independent caller cancellation, deadlines, failure cooldown, bounds and private/no-store responses. No workflow writes provider tags merely to make filtering possible.

Meaningful acceptance cases include: an untagged fastest source plus a slower tagged winner; any/all sets with different real winners; explicit empty membership versus unknown/malformed membership; zero/unknown samples; ignored/short sources; source caps applied after tag selection; commas/case/Unicode preserved; tag removal without automatic broadening; account switching; comparison and late-response races; malformed successful filter readbacks; and zero provider writes. Source recording opens remain ordinary Summary with exact identity/date, without fabricated highlight bounds.

Remaining evidence gates are native null/empty membership behavior and actual filter operators/serialization if that optimization is chosen. The provider/reference tag inventories are distinct. This proposal establishes a feasible implementation path, not verified tag or numerical parity.
