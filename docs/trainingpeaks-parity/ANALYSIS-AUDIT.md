# Analysis implementation audit — 2026-10-20

This record distinguishes repository inspection and automated verification from live TrainingPeaks observation. The lead agent owns the signed-in reference session. No TrainingPeaks screens were inspected by this audit worker, and these fixes do not establish visual or functional parity percentages.

## Corrected defects

| Surface | Preconditions and action | Required result | Implementation | Verification |
| --- | --- | --- | --- | --- |
| Analyze 360 chart library | Add cards until the existing persisted-layout limit of 24 | Additional additions are disabled; reloading preserves all 24 valid cards | `workout-analysis-360.tsx`; `analysis-360.ts` | Pure state regression verifies capacity constraints and validator acceptance; browser interaction remains for lead verification |
| Analyze 360 undo | Remove Map or Laps, add a replacement, then undo | Undo cannot introduce a second singleton and invalidate the whole saved workspace | Same files | Regression verifies replacement, repeated undo, insertion position and capacity rejection |
| Analyze 360 sport layout | Customize channels, open a same-sport recording missing a sensor, then reopen the original recording | Unavailable channels remain in saved preferences; only recorded channels are drawn, and settings label missing sensors explicitly | Same files | Regression round-trips the saved sparse-recording layout and verifies original channel order, dimensions and title survive |
| Analysis metrics | Analyze a recording without elevation samples, or with elevation endpoints separated by a recording gap | Gain/loss remain unavailable; a genuine measured flat section still reports zero | `analysis-360.ts` | Numerical regression distinguishes absent data, device gaps and measured zero |

The changes preserve branding, app navigation, site header and calendar layout. No account data, provider integration or database schema is modified by this work.

## Existing real analysis behavior found in source

- Workout Analyze 360 loads recording samples and completed summary values through the activity APIs; it does not embed reference screenshots or use the TrainingPeaks login at runtime.
- Shared chart cursor, map cursor, chart range selection, zoom/unzoom, lap source filters, lap comparison, signal settings, chart ordering, chart sizing, CSV output and sport-scoped browser layout persistence have implementations.
- The Power tab derives the current activity curve from measured recording coverage. It requests provider-derived historical best efforts for the 90 days ending on the workout date.
- Range metrics weight irregular samples by measured duration; samples separated by more than ten seconds do not bridge gaps. Thirty covered seconds are required for a normalized-power window. These are explicit implementation choices, not proof of TrainingPeaks algorithm equivalence.
- Dashboard aggregate surfaces include training-volume history (`chart-area-interactive.tsx`), fitness-history graphs/tables (`fitness-history-card.tsx`) and personal statistics in Settings. These use provider data and existing APIs. This audit does not certify that their layout or feature inventory matches TrainingPeaks Dashboard.

## Open differences requiring reference/data work

| Item | Concrete current behavior | Status |
| --- | --- | --- |
| Anaerobic Battery | Library action is disabled because no FRC model is supplied by the connected provider | Open; no substitute model or fake series added |
| Modeled power and historical W/kg | Power-table fields remain unavailable; no historical model or workout-date weight dependency has been established | Open |
| Summary W/kg, Pw:Hr and VAM W/kg | Display unavailable rather than fabricated values | Open; exact historical inputs/calculation requirements need reference inspection |
| Numerical parity | NP, IF, TSS, efficiency, gain, zone boundaries, pauses and preprocessing need paired equivalent sample files and historical thresholds before a parity assertion | Unverified |
| Performance summary | Before/after values use adjacent daily wellness records; those are daily provider values, not a proven marginal effect of one workout | Unverified against TrainingPeaks |
| Units | Analysis display currently uses miles/feet and yards for swimming in these components | Reference preference variants remain unverified |
| Aggregate Dashboard scope | Existing dashboard has its own real volume/fitness/personal-statistics surfaces | Requires reference inventory before claiming equivalent aggregate analysis |
| Visual states and interaction fidelity | No paired screenshots or live reference interaction traces were captured by this worker | Unverified; lead-owned browser work |

## Verification

- `node --experimental-strip-types --test ui/tests/analysis-360.test.mjs`: 18 tests pass, including three new regression cases covering four defects.
- Combined analysis, chart-axis and signal-statistics suites: 33 tests pass.
- From `ui/`: `node node_modules/typescript/bin/tsc -b`: passes.
- From `ui/`: `node node_modules/eslint/bin/eslint.js src/lib/analysis-360.ts src/components/workout-analysis-360.tsx`: passes.
- The modified TypeScript/component/tests were formatted using the UI's installed Prettier and plugin configuration.

These are local checks. Live provider persistence and TrainingPeaks parity are separate verification gates.

## Follow-up: new-workout lifecycle

`DesktopWorkoutCreate` previously dismissed Save & Close before the provider promise settled. A rejected or unconfirmed write could therefore hide its inline error and draft. Save & Close now keeps the creator visible until the provider response is confirmed, then reports the saved workout through the existing parent callback with the requested close flag. Personal-data and recurrence recovery records retain their existing behavior. A retired component cannot dismiss a newer popup when an old response arrives.

Cancel, the header close button, Escape and backdrop dismissal now share a guard. Ordinary unsaved drafts require explicit discard; closing an uncertain save preserves its existing reconciliation record. Active workout or personal-field writes block dismissal and duplicate submissions. Explicit discard also retires the draft's recurrence record. Date-only and sport-only edits count as unsaved changes.

The creator also labels the newly supported canonical sports as Mtn Bike, Rowing, XC-Ski and Crosstrain. A genuine Other selection displays Other, while the explicit Sauna extension keeps its label. An untitled workout's fallback name tracks subsequent sport changes.

Nine independent callback cases execute the actual creation callbacks and verify deferred provider confirmation, failure retention, uncertain-write identity, duplicate submission and close protection, a retired popup, personal-field rejection and builder error propagation. TypeScript and focused component lint pass. This prevents data loss; no assertion is made that TrainingPeaks uses the same confirmation wording.

The existing full browser runner now includes real dialog tests for Cancel/header/Escape draft preservation, a rejected Save & Close, and a held provider response that must block dismissal until confirmation. It then reopens and deletes only its own synthetic test workout. The calendar audit's expected compact width is 700px, based on the lead agent's live measurement of TrainingPeaks `workOutQuickView` at 1280×720.

Iteration 2 production-build browser verification passed 67 check groups: 27 workout parity, 26 calendar/analysis audit and 14 actual drag gestures. The new lifecycle tests pass. The analysis audit also now exercises replacement-Map Undo protection and adds cards to the 24-card limit, verifies additions are disabled, closes/reopens Analyze 360 and confirms all 24 cards persist. All three runners report zero page errors; the calendar audit blocked no external requests. Evidence: `artifacts/parity-iteration2-browser.log`, `artifacts/calendar-iteration2-browser.log`, `artifacts/drag-iteration2-browser.log`, plus their usual screenshots/results JSON. These are synthetic local workflow checks, not a TrainingPeaks pixel-similarity score.

## Follow-up: real desktop aggregate workspace

`desktop-training-analysis.tsx` and its scoped CSS now add an Analysis entry in desktop Home content. Overview returns to the original Home cards/history; the branding, sidebar, site header and mobile composition remain in place. The internal tabs use the observed Legacy Dashboard / Workout Comparison labels. The component uses the historical range loader and the independently tested aggregate adapter, rather than hard-coded chart data.

- Legacy Dashboard begins with 28 inclusive days; Workout Comparison begins with seven. Presets, custom dates, sport selection and a manual Refresh work. Invalid ranges do not issue requests. Requests carry cancellation and revision guards, and failed refreshes preserve the last successful results with the applicable dates identified.
- Weekly duration, provider load and sport distance charts show real recorded totals. Their average is explicitly the arithmetic mean of displayed available weekly totals; identical TrainingPeaks averaging/weekly IF is not claimed. Missing measurements remain unavailable or identified as partial. Daily fitness/fatigue/form uses provider wellness, inserts null rows for missing days and does not seed an invented fitness model.
- Source HR-zone time is grouped by actual sport, historical boundaries and threshold. Missing records and incompatible schemes are not silently combined. Fitness History reuses the existing provider window and effort navigation; its window is identified separately from the selected dashboard range.
- Workout Comparison reuses the report data model and recorded-workout comparator. It supports date/sport/text filtering, column preferences, numeric/date sorting, selection, two-to-four recorded-workout comparison, CSV export and opening the actual workout. Provider Power/HR/Pace load columns retain those names; no hrTSS/rTSS equivalence is implied.
- Workspace/tab/range/chart/column preferences are stored under the provider-connection scope. Keyboard tab navigation, Escape dismissal/focus return, working controls and missing values were checked.

The initial aggregate production-build browser pass completed eight groups with zero page errors, including a delayed obsolete range response, deliberate HTTP failure/recovery and independent source-API comparison row counts. Visual inspection then exposed an existing Home ancestor flex constraint that let a wide table enlarge the document. Scoped `min-width:0` containment corrected its measured geometry without changing header/sidebar presentation. JavaScript bar entrance animation was also removed for deterministic initial captures. Build 4 passes all nine aggregate browser groups, including both tabs at 1280/1024/768 pixels and a plotted first-week duration tooltip compared independently with source-API measured seconds. Zero page errors were reported.

Interaction review then identified that a workout saved from the comparison detail dialog could leave aggregate range results stale until manual Refresh. The workspace now coalesces the existing mutation-settled event and changed live context version into a historical-range refresh, while retaining the last useful data during loading/failure. Successful data replacement clears stale comparison selections. A new test feeds changed anonymous fixture values through the API response and verifies this mutation lifecycle. It passes on the definitive final production build, including changed title/duration, a new historical request, selection reset and restoring the original source.

Final browser gate: **77 groups pass** — 27 workout creation/editor/persistence groups, 26 calendar/analysis groups, 14 actual drag groups and 10 aggregate groups. Every runner reports `errors: []`; the calendar runner additionally reports no blocked external requests. Logs: `artifacts/parity-final-browser.log`, `artifacts/calendar-final-browser.log`, `artifacts/drag-final-browser.log`, `artifacts/analysis-final-browser.log`. Results and screenshots remain in `artifacts/workout-parity/`, `artifacts/desktop-calendar-audit/` and `artifacts/trainingpeaks-analysis/`. All owned preview processes on ports 5211–5214 were stopped after verification. These checks use disposable synthetic provider storage and do not certify a TrainingPeaks pixel percentage or live-provider numerical identity.

Evidence is in `artifacts/trainingpeaks-analysis/` and `artifacts/analysis-iteration3-browser.log`. These local screenshots are fixture-backed workflow evidence. The lead agent's reference captures informed layout, but this work does not assert a numerical TrainingPeaks pixel score.

Remaining reference differences include the reference's full 27-type drag-to-add Chart Library and configurable/reorderable dashboard cards (the implemented library currently provides working visibility/reset controls), weekly IF semantics, exact chart/menu geometry, historical athlete inputs, canonical subtype column, and proprietary modeled metrics. Those remain open rather than being represented as completed or populated with fabricated values.
