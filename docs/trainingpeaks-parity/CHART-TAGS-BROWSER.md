# Native recording tags browser acceptance

`tools/trainingpeaks-native-chart-tags-check.mjs` is a bounded, 17-group synthetic-localhost browser runner. All 17 groups passed on frozen build 25694 (index SHA-256 `9217a3e0e53ee121e945605f2805a24f59744370d7ab9ea154d0a3fda33e1b4d`, backend gate 837). The positive evidence is preserved in `artifacts/frozen25694-browser-verification/tags`. This bounded result is not a TrainingPeaks parity percentage.

The first browser attempt passed three groups and then exposed a harness locator ambiguity between the named chart image and its legend image. That failure is preserved in `artifacts/frozen25694-tags-chart-image-selector-harness-failure`. The corrected locator selects the chart by its existing `Recorded peak …` accessible name; raw data, SVG point/gap, and visual readiness assertions were retained. The clean rerun had no runtime errors, unexpected network failures, native writes, or frontend artifact changes. The separately updated legacy Power suite also passed all nine groups.

The updated 17 groups also pass build 40937/backend 850 (index SHA-256 `5a88fd076860a2d424d2022336f081be3a5d13cc5cdb19954d1f9d487b7aaead`), preserved in `artifacts/frozen40937-browser-verification/tags`. Power now uses the observed `Peaks - Power: …` title and explicit native-demand reader when tags are cleared. That case checks the actual unfiltered endpoint and independently verifies its 500 W five-second source from the separate raw native recording fixture; it does not reuse or equate the historical personal-statistics fixture's 420 W. The four-sensor tagged v2 raw/provenance and all failure/recovery assertions remain unchanged.

Run a fresh isolated preview after the build owner freezes the frontend:

```powershell
node tools/desktop-preview.mjs --calendar-edits --port=5213
$env:APP_TEST_ORIGIN='http://127.0.0.1:5213'
node tools/trainingpeaks-native-chart-tags-check.mjs
```

The runner refuses non-localhost origins and checks the synthetic-preview marker before fixture mutations. It uses actual settings, preferences, catalog endpoints, production tagged-curve services, native-provider doubles, and source-recording Summary views. No React state, private model, or expected success payload is injected. Deliberate browser interception is limited to declared held, failed, and malformed responses.

## Independent numerical evidence

Raw recording membership, times, sensor streams, and native per-record curve axes come from the read-only `preview/chart-tag-sources` oracle. The runner independently selects exact ANY-tag membership before source eligibility and the 128-recording cap. It computes each positive winner from raw time-weighted samples, checks source identity/date/type/tags, preserves explicit null samples, and compares the complete native axis. These calculations do not import the tagged-curve projector or frontend conversion helpers.

The deterministic fixtures include a faster untagged recording, slower tagged winners, overlapping tags, unknown membership, an ignored recording, a known-too-short recording, a valid zero, exact comma/Unicode/case-sensitive tags, and 260 cap candidates. A source-only preflight compared 88 raw winner/value cases across all four sensors and the cap fixture successfully; this is numerical harness validation, not a browser result.

## Seventeen groups

1. Demand-loaded catalog, loading status, and cancellation of a held catalog read.
2. Catalog failure, explicit Reload, exact checkboxes, exclusive All, and settings Cancel.
3. A genuine empty catalog distinguished from loading and failure.
4. Tagged HR maxima recomputed from slower matching raw recordings.
5. HR, power, cadence, and velocity eligibility, provenance, grids, and partial coverage.
6. Multiple tags use ANY/OR membership and preserve complete SVG axes and gaps.
7. Commas, Unicode, case distinctions, and known zero remain exact.
8. Independent populated and empty comparison ranges for all four sensors.
9. Actual JSON tag arrays and preferences survive a separate browser context.
10. 503 and malformed successful responses retain confirmed curves and support Retry.
11. Actual account/revision rejection happens before native inventory/source fetches.
12. A vanished selection remains retained; Reload must be fresh and Apply cannot silently broaden it.
13. Explicit All restores the original unfiltered readers without catalog demand.
14. Membership filtering precedes the real 128-recording fetch cap.
15. Numeric cells open the validated recording Summary without automatic analysis, effort selection, or highlighting.
16. A late canceled range/selection cannot replace the latest result or another chart.
17. Native writes, runtime errors, unexpected network failures, and build changes fail acceptance.

The existing power runner retains its separate raw five-second physical-effort/bounds proof. The chart click now checks the observed normal Summary action independently. HR/cadence/velocity runner All selectors are scoped to Workout Types so the new tag All checkbox cannot satisfy a sport-selection assertion accidentally.

## Evidence and limits

Outputs are written to `artifacts/trainingpeaks-native-chart-tags`: checkpoint hashes, actual requests and preference writes, catalog/native/source readbacks, exact allowed failure identities, complete network evidence, and screenshots. A fixture cleanup failure is visible and sets failure status. Expected failures are counted by exact request identity/status; there is no broad HTTP or cancellation allowlist. Preserve any failed output directory before another run overwrites it.

The synthetic fixtures do not provide an actual actor-switch browser hook; account isolation additionally depends on the independent server/client tests. The runner does not establish TrainingPeaks numerical algorithm equivalence, the populated tag palette, whole-image pixel accuracy, or production-provider permission behavior. Unfiltered legacy fixtures and tagged fixtures are separate declared inventories, so their maxima are not represented as a shared real recording population.
