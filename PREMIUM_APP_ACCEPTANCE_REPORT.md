# Premium app acceptance report

2026-10-23. Deployed to production after the user's explicit deployment request; **acceptance is partial**. The implemented fixes and verified journeys below are complete, but the requested 3× loading improvement, indistinguishable desktop parity, and real-iPhone/PWA certification have not been demonstrated. This report separates changes from existing behavior that was reverified.

## Calendar restoration and pace defaults — October 23

This follow-up supersedes the calendar/header styling from the cleanup below, following the user's explicit correction. The compact sidebar is retained unchanged.

- Restored the previous calendar month typography (20px, regular), desktop page-title sizing, 12px status strips, card shadows, visible menu controls and metric rows. Kept the stable 64px navigation rail, compact Planned/Completed sidebar, correct linked-record totals, report popups and draft persistence fixes.
- Simple time/distance workouts no longer display a synthetic flat profile. One shared presentation predicate handles canonical single untargeted steps, native provider steps and explicit freeform workouts. Real targeted intervals, repeats and recovery structures remain visible. Detail/profile wrappers and editing hints follow the same decision. Executable workout prescriptions and saved records are unchanged.
- A signed-in read-only check exposed a comments error when an app-created workout opened without a browser-local journal. That read now uses the existing canonical editor path instead of passing an app UUID to the provider-only comments endpoint. Added account-isolation, request-deduplication, storage-failure and pending-deletion tests. Chromium and WebKit each created a disposable server-side workout, opened it in a fresh browser, and verified its saved comment appeared without an invalid provider request or a simple-session profile.
- New Swim builders default to **m:ss/100yds** and Run builders to **min/mile**. Existing deliberate prescription units remain intact on reopen; obsolete automatically remembered percentage defaults no longer override fresh workouts. Zone labels follow the selected physical unit, including metric choices. The legacy swim storage/conversion contract is preserved.
- Verification: production build, lint and all **947 UI tests** pass. Chromium 156 and WebKit 26.5 each passed 18 profile cases across 1280px desktop and 390px touch layouts, new Swim/Run defaults, and empty-builder sport switches in both directions. Chromium additionally rechecked sidebar geometry/canonical totals at 1024/1280/1440px and report popup/draft/return behavior. No app-owned console or page errors were observed in these browser checks. This is browser emulation, not physical iPhone testing.
- Evidence: `premium-preferences-*.log`, `artifacts/premium-app/calendar-preferences-chromium/evidence.json`, `calendar-preferences-webkit/evidence.json`, `sidebar-restored-chromium/evidence.json`, and `report-popups-chromium`. The initial new test raced Today smooth scrolling against programmatic date scrolling; the final test uses a user wheel event to cancel that scroll before selecting another date. No application assertions or error reporting were removed.
- Frozen review assets: `artifacts/premium-app/review-build-preferences-final-dist`, index SHA-256 `8eb22ba15da548bdc976c5c27ecb2fe7fd279589460dae8e486c8997630f0b84`. Run `node tools/desktop-preview.mjs --calendar-edits --port=5201 --dist=artifacts/premium-app/review-build-preferences-final-dist` for the isolated preview. The original performance results and remaining limitations below still apply; no new 3× claim is made.

## Earlier visual cleanup — October 23 (calendar/header styling superseded above)

The user requested a shorter sidebar and a cleaner, more coherent interface while retaining the TrainingPeaks visual identity. This follow-up makes focused changes to the existing components, without changing aggregation, persistence, integration configuration or stored user records.

- Weekly summary is now a semantic table: one row per sport beneath visible **Planned** and **Completed** headers, with both totals in the same aligned columns. Total cells retain explicit accessible labels. Secondary metrics and ATP values use aligned label/value rows. The same four-sport fixture measured **641px before → 451px after** in Chromium at both 1280×820 and 1440×900 (190px / 29.6% shorter); WebKit measured 447.5px after. Totals stayed **5:06 planned / 4:31 completed**. The same production-build fixture and account data were used; these are layout measurements, not loading-performance claims.
- Calendar cards keep sport and completion colors, with a 5px status strip, quiet borders and no resting shadow. Absent secondary distance/TSS lines are omitted from compact cards; real zero values remain visible. Fine-pointer menus appear on hover, keyboard focus or while open. Touch controls remain available.
- Shared desktop rail is consistently 64px across Calendar and Reports, with its active indicator inside the rail. Shared headers use a 56px height and consistent title/control sizing.
- Analysis stays in the existing popup with a shorter header and a clean **Close** footer. Modified drafts retain **Cancel / Save / Save & Close**; planned-calculation controls stay in Summary. An added journey test exposed unnecessary discard confirmation when returning from Analysis to the still-mounted endurance Summary draft; that transition now preserves the draft directly. Closing still uses the existing unsaved-changes guard. Strength's separate Summary surface retains its guard.
- Chart axes have readable, nonwrapping numeric scales at narrow desktop widths. A test caught an additional 1148px overflow and the gutter breakpoint was corrected. Plot pointer coordinates continue to use the actual SVG bounds.
- Live review exposed a linked completed event and its raw activity appearing as two calendar cards. The calendar now projects one card for an explicit same-date linked identity, fixing its secondary distance/TSS/elevation/work totals too. Original source rows still feed planned/completed duration aggregation. Standalone recordings, distinct dates, annotations and separate planned targets remain. Seven regression tests and browser injection of a duplicate raw alias verify this without modifying stored records.

Verification for this cleanup: production build and lint pass; all 938 UI tests pass. Chromium and WebKit checked sidebar geometry/totals at 1024/1280/1440px; bike and run analysis axes, lap selection and time/distance controls at 768/1024/1148/1280/1440px; report popup focus, selection, filters, scroll restoration, Escape, Back/Forward, clean Close, dirty save controls, draft retention through view changes and Strength Summary return. The existing interval drag/save/reopen suite passed all 14 groups. Home and Calendar passed 14 viewport/route checks per engine (320/360/390/430/768/844/1440px), including landscape, intentional carousel scroll and hidden touch day-add shortcuts. Desktop calendar layout-shift score was 0 in three fresh Chromium fixture runs. No app-owned console/page errors were observed in the popup, sidebar, analysis and editor-drag checks; mobile checks recorded no page errors.

Evidence: `premium-cleanup-*.log`, `artifacts/premium-app/sidebar-before-cleanup`, `sidebar-compact-chromium`, `sidebar-compact-webkit`, `analysis-cleanup-chromium`, `analysis-cleanup-webkit`, `report-popups-chromium`, `report-popups-webkit`, `drag-cleanup`, `calendar-layout/cleanup`, and `artifacts/mobile-stability/premium-final-cleanup*`. These are desktop-engine emulation and synthetic fixtures; no new physical-iPhone, installed-PWA or real-provider round-trip claim is made. Earlier performance limitations remain in force.

Frozen final review build: `artifacts/premium-app/review-build-cleanup-final-dist`, index SHA-256 `0c1ca5792f767cd17436e26d4a8f97e4a129e54837697ec354af8038c3852245`. Run `node tools/desktop-preview.mjs --calendar-edits --port=5201 --dist=artifacts/premium-app/review-build-cleanup-final-dist`; review Calendar and Workout Reports. Earlier snapshots remain preserved.

## Production deployment

- Live site: https://training-agent-omega.vercel.app. Final calendar-restoration deployment `dpl_64XwdbX6rfvHjHd4YaPutKs8VGVf`, created October 23, 2026 at 3:53 p.m. America/Chicago, is Ready and owns the live alias. Immutable deployment: https://training-agent-cve49qjnd-arussell159s-projects.vercel.app.
- Deployed the verified working-tree source through the existing linked Vercel project. Vercel rebuilt the frontend and both API functions using the existing production configuration. The upload preflight excluded credentials, local account data, test artifacts and logs. No database migration or account/integration-setting change was made.
- Live read-only HTTP checks passed for Home, Calendar, Workout Reports, Nutrition, Settings, Library, service worker and unauthenticated session response, plus 39 initial JavaScript/CSS assets. The deployed entry bundle contains the report-popup implementation. Latest evidence: `premium-preferences-final-smoke.log` and `artifacts/premium-app/production-smoke.json`.
- Final signed-in verification confirmed the restored 20px regular month heading and 12px card status strips. The simple Aerobic Bike card and its detail popup have no workout profile. Its comments finish loading without the prior validation error; the dialog contains no alert, and no console errors were observed. Closing returns to Calendar; weekly planned/completed totals remain **6:43 / 3:58**. No live records were edited. Screenshot: `artifacts/premium-app/live-calendar-restored.png`, excluded from deployment.
- In the existing signed-in in-app browser session, the real Reports list loaded. Opening an existing recorded Run loaded analysis in a popup; Escape closed it, returned to the Reports list and restored focus to its row. No console errors were observed in this check. No workout or nutrition record was edited during live verification. This is a narrow live smoke check, not a repetition of all fixture/device acceptance coverage.
- Final signed-in Calendar check confirmed the compact Planned/Completed table and exactly one card for the previously duplicated linked Run. The affected weekly distance changed from 22.90 to 20.17 mi and TSS from 188 to 151; planned/completed durations remained 6:43 / 3:58. The real report opened in the compact analysis popup and its Close action restored focus to the selected row. No console errors were observed. Read-only live screenshot: `artifacts/premium-app/live-cleanup-calendar.png` (private local artifact, excluded from deployment).
- Latest deployment/alias evidence: `premium-preferences-final-deploy.log`, `premium-preferences-final-inspect.log`, `premium-preferences-preflight.log`. Immediate rollback deployment is `dpl_5N823oEebsWwgPwyg622ub6Y6oqK` (https://training-agent-5jdokk8ry-arussell159s-projects.vercel.app), containing the same visual/pace changes before the fresh-device comments fix. The prior cleanup release `dpl_7xkVFb7f5uobhyLN3fkty9Cb9RUT` and earlier snapshots are retained. No rollback was performed.
- Performance limitations below remain unchanged. The live deployment was rebuilt by Vercel; local artifact hashes and prior lab timings are not claimed as measured live production performance.

## Review the build

- Run `npm run build`, then `node tools/desktop-preview.mjs --calendar-edits --port=5201` and open http://127.0.0.1:5201. The current cleanup preview is running on that port. It uses disposable in-memory accounts/workouts and local API fixtures; edits disappear when the preview process stops. Earlier preview tabs and snapshots were preserved.
- The latest review assets are retained in `artifacts/premium-app/review-build-preferences-final-dist`. Add `--dist=artifacts/premium-app/review-build-preferences-final-dist` to serve that snapshot. Its index SHA-256 is `8eb22ba15da548bdc976c5c27ecb2fe7fd279589460dae8e486c8997630f0b84`. The earlier cleanup snapshot remains preserved.
- The exact assets used for the 12-sample performance measurements are separately retained in `artifacts/premium-app/review-build-accepted-dist`, index SHA-256 `c08b4c95e96fca44940ff342827d57dc8f8bd89a1506d15a86827d0e4b5f97a7`. The later popup, draft-dismissal and description-resize corrections have functional/browser coverage; the performance table was not rerun after those corrections and must not be presented as timings for the latest hash.
- Review Home, Calendar, Add workout → each sport, Workout Reports → a recorded activity, and Nutrition → Add Food. Open two preview tabs to exercise concurrent edits.
- Source changes remain in the working tree. The repository was clean at baseline; no unrelated changes were removed. Production deployment was subsequently authorized and completed as recorded above. No migration, account-setting, subscription, or integration-configuration changes were made.
- Screenshots and raw measurements are under `artifacts/premium-app/` and `artifacts/mobile-stability/`. These generated artifacts and root test logs are ignored by Git; keep them with the checkout for review.

## Architecture, baseline and decisions

No AGENTS.md was found in the repository or its parents. The baseline production build succeeded before performance changes (`premium-baseline-build.log`); its assets remain in `artifacts/premium-app/baseline-dist`.

Retained React 19, Vite/TypeScript, existing route imports, Base UI shared controls, Framework7 date picker and remaining feature sheets, current semantic design tokens, Supabase-backed authenticated persistence, account-scoped IndexedDB, the durable workout commit journal, service worker, Intervals.icu adapter and FatSecret adapter. Simple completed-workout detail sheets now use the existing Base UI dialog primitive. No competing state store, queue, UI framework, or database schema was introduced.

Confirmed causes addressed:

1. Calendar sidebar maintained a separate incomplete summary path and lacked explicit Planned/Completed totals. Accepted local changes and linked-date projections could temporarily disagree with analysis.
2. Initial routes downloaded nutrition/realtime/Framework7 work before it was needed. Mobile also mounted desktop summary trees hidden by CSS.
3. Global viewport and event handlers disabled browser zoom. Shared modal/input sizing and confirmation ownership varied by surface.
4. Food detail Add cleared the query; repeated mobile autofocus reset search scroll in WebKit landscape. Invalid quantity blur silently restored an old value.
5. Compact builder summaries clipped numeric fields. Analysis inspector duration and distance overlapped at ordinary laptop widths.
6. Closed detail-sheet instances eagerly loaded approximately 387KB of Framework7 runtime when opening workout details. The calendar card's nested interactive preview could also consume a mobile tap and leave the details unopened.

The baseline responsive audit did **not** reproduce root overflow, excessive Home top offset, or mobile per-day calendar add buttons. Those existing fixes were preserved and reverified, rather than claimed as new work.

## Implemented changes

### Data correctness and saves

- Sidebar, calendar summary helper and Fitness Summary analysis now use `aggregateFitnessSummary`. Following the user's compact-layout correction, per-sport rows use visible **Planned** and **Completed** column headers and a total row beneath the same columns, with explicit accessible total labels. Numeric values align and use hours:minutes.
- Sum canonical seconds before rounding. Recorded time comes from canonical completed duration (the integration maps the activity's `moving_time`); it never falls back to the scheduled target. A modern missing/cleared actual remains unavailable instead of reviving legacy values.
- Planned contributions use the scheduled date and sport. Actual contributions use the recording's date and sport. Plan moves preserve the recording even when its summary is null or absent. Linked records deduplicate by activity identity; optimistic accepted edits remain included.
- Moves/edits update `planned_workout_date`, and rollback restores it. Retry checks account/session identity again after asynchronous IndexedDB reads.
- Repeated fresh-browser testing exposed a canonical-revision mismatch: an editor without a local journal could read a provider hash after the server had accepted an app revision. The existing durable editor endpoint now returns the canonical record, with provider fallback only when no durable record exists. Deleted rows and storage failures do not fall back. Focused cache/account-isolation, cold-read/save/reopen, permission and storage-failure tests pass; the new regression is part of the standard UI test command. See [canonical-read evidence](artifacts/premium-app/canonical-editor-read-results.md).
- Independent final review reproduced a stale cached editor reopening after durable local deletion. Cached, ordinary and forced editor reads now respect the deletion before any cache/server fallback. The regression test verifies that no extra provider request is made. The original behavior did not demonstrate data resurrection, because stale writes were still rejected.
- Retained the existing authoritative journal and optimistic projection. Editor feedback says “Saving workout…” during acceptance, without implying that Intervals.icu has already finished.

Verified cases: missed, unplanned, partial and linked activity; zero versus missing; partially known totals (`+`); duplicate linked activity; planned/actual dates spanning weeks; cleared modern metrics; planned and recorded sport differences; move rollback; stale fetch/tab conflict; account change during retry. The sidebar fixture shows planned **5:06**, completed **4:31** at both 1280 and 1440 widths. See [correctness evidence](artifacts/premium-app/correctness-results.md) and `sidebar/evidence.json`.

Dates remain canonical local calendar dates; selected week boundaries are passed into the shared aggregation. The existing calendar uses Monday weeks and has no configurable week-start or calendar sport-filter control. Those nonexistent preferences were not claimed as tested.

### Shared interaction and mobile behavior

- One Base UI confirmation path now serves mouse, keyboard and touch, with action-specific buttons such as Delete workout and Discard changes. Repeated requests cannot stack dialogs or reuse one approval for a second mutation.
- Verified focus trap/restoration, Escape, browser Back while open and while a navigation decision is pending, preservation of the underlying editor, and scroll unlock. Cancel precedes the action in both visual and focus order.
- Shared mobile buttons/inputs/selects have a 44 CSS-pixel minimum target; icon buttons have a matching minimum width. Mobile text inputs use at least 16px text. This shared rule does not claim that every bespoke icon/chart control was independently audited.
- Centered dialogs respect the visual viewport, contain their own scrolling and remain usable at narrow/landscape sizes. Base UI owns shared confirmations and simple detail-sheet focus/scroll locking; remaining Framework7 features retain their own ownership.
- Restored browser pinch/keyboard zoom. Zoom no longer masquerades as keyboard-resizing in viewport calculations. Existing safe-area/browser-contained viewport behavior was preserved. Reduced-motion modal transitions are disabled.
- Framework7 date-picker code loads on demand with loading/cancel/retry recovery. Confirmation no longer waits for that runtime.
- Opening an editable workout prepares the existing editor bundle and canonical model after the useful details have painted, with cancellation before dispatch on leaving and an account-boundary check. No editor preload runs for read-only completed details. Immediate first editing still pays some deferred runtime cost; its regression versus the baseline is disclosed in the performance table.
- Completed-workout detail sheets use Base UI without eagerly importing Framework7. The existing expand/swipe interaction, accessible title, focus restoration and browser Back behavior are retained. Controlled draft/save fixtures exercise the shared surface; these are not a claim of backend persistence inside the currently read-only production sheet.
- Mobile calendar chart previews use the existing passive mode so tapping a chart opens its card. Current mobile Home tiles have no nested interactive charts; older Home preview components already use passive mode. Desktop chart tooltips and purposeful analysis charts remain interactive.

Evidence: ten shared-surface checks per engine at 320×568, 390×844, 430×932, 844×390 and 1280×820 with normal/reduced motion; six production confirmation journeys. `surfaces-chromium.json`, `surfaces-webkit.json`, `confirmation.json` and `tools/premium-surfaces-check.mjs` contain details.

The replacement detail sheet separately passes five cases per engine: 320×568, 390×844, 844×390 landscape, 1280×820 and 390×844 with reduced motion. First-open expansion, swipe, backdrop, Escape, Back, focus trap/restoration and scroll unlock pass with no console/page errors; no Framework7 runtime is requested. See `detail-sheet-chromium.json` and `detail-sheet-webkit.json`.

Seven final production checks cover calendar chart-center/title touch taps, Home tile-center/title taps, first-use date-picker loading/cancellation/reopen, editor cancellation and the actual completed-workout sheet, including after Framework7 loads. Production CSS exposed an offscreen sheet translation that the development fixture missed; selecting the existing uncentered dialog layout removed that conflict. See `lazy-controls.json`. Original failing diagnostics remain alongside the passing evidence.

### Workout Reports popup correction

- Desktop recorded reports now open directly to Analysis in the existing calendar workout popup. Summary and analysis stay inside that popup. The Reports page remains mounted behind it, retaining filters, selected rows, scroll and focus. Deep links open the same popup; closing a direct link returns to Reports. Mobile keeps its existing touch-oriented detail route.
- Loading/error states use the shared modal primitive with close/retry recovery. The loading-to-loaded handoff retains one report-row focus target; completed Strength Analysis → Summary also restores it on close.
- Hands-on testing exposed a false unsaved-changes prompt: a deferred activity-description updater compared against an already advanced baseline. Capturing the pre-read baseline fixes untouched reports while preserving concurrent typing and recovered drafts. The actual hydration callback failed before the fix and passes afterward.
- WebKit exposed a separate immediate-dismissal race: an input followed by Escape four milliseconds later could outrun passive dirty-state publication. Dirty notification and guard registration now run in the layout phase. The browser regression retains immediate input → Escape, verifies the confirmation, cancels, and checks the draft remains intact.
- Analysis → Summary revealed a WebKit ResizeObserver loop caused by fitting a textarea while observing its parent's size. Width-driven fitting now runs in a cancellable animation frame; value-driven fitting remains immediate. No error filtering or suppression was added.

Evidence: `tools/premium-report-popup-check.mjs`, `report-popups-chromium/results.json` and `report-popups-webkit/results.json`: two desktop widths (1280/1440) plus completed Strength transitions per engine; initial analysis, Summary, clean Escape, real draft protection, Cancel, Close, Back/Forward, direct links, retained list/filter/selection/scroll/focus and no root overflow. `tools/premium-analysis-check.mjs` verifies inspector geometry, lap selection and time/distance controls at five desktop widths. `tools/premium-description-resize-check.mjs` passed 13 checks per engine, including repeated tab changes, textarea growth/shrinkage and viewport resizing. Successful runs have no console/page errors. Original failure traces remain in `premium-report-popup-*-debug.log` and `resize-trace-webkit-before.json`.

### Nutrition

- Add Food still opens All with recent/frequent foods and the AI entry point retained. Search focus occurs once during the original mobile action.
- Adding through details preserves query, tab, results and scroll. Returning from details no longer reopens the keyboard or resets WebKit scroll.
- Invalid quantity remains visible with an accessible adjacent error and disabled Save. Serving hydration does not overwrite typing. Quick Add/library saves verify their account scope.
- Slow search is announced after two seconds while previous usable results remain. Optional catalog storage denial no longer breaks reads.
- Retained existing 250ms debounce, abort/shared-read deduplication, 15s client/12s backend deadlines, four-request provider bound, one transient retry, Retry-After cooldown, licensed scoped cache, signed serving facts, immutable operation IDs and durable pending-write recovery.

Production fixture journeys passed on Chromium and WebKit for rapid query changes, 429/retry, rejected save retaining quantity and operation ID, response lost after commit replaying exactly once, reload, offline recents, totals, browser Back and focus/body unlock. A live **read-only** FatSecret probe returned oats search in 264ms and detail in 40ms (n=1 each). Historical provider timeouts were **not reproduced**; historical failing request IDs/server traces were unavailable, so these healthy samples do not establish the original cause or a 3× speedup. No real diary writes were made. See [nutrition evidence](artifacts/premium-app/nutrition-results.md).

### Desktop builders and analysis

- Compact 1120px builder summaries now give duration inputs 109px instead of roughly 38px; notes remain in the existing scroll region. Expanded geometry is retained.
- Swim, bike and run keep distinct sport units, targets, recovery/repeat structures, validation and serialization. Existing real editing/save paths were exercised rather than replaced.
- Analysis primary metrics size to their contents and wrap when necessary, preventing overlapping duration/distance/TSS. Five production checks at 768, 1024, 1148, 1280 and 1440 verify metric containment, lap selection/reset and time/distance axes, with no console/page errors. See `analysis/results.json`.
- Final QA found a desktop layout-shift regression introduced by taller summaries replacing virtual-week placeholders. Desktop now mounts nearby weeks before first paint, aligns during the resize layout pass, and restores alignment when annual-plan data changes. Normal measured virtualization resumes after startup; narrow mobile retains its existing path. Matched attribution traces improved CLS from **0.3430 to 0.0312**, three samples per build at 1440×844. This uses the largest session window with gaps below one second and total length below five seconds, excludes recent input, and captures through 1.5 seconds after network idle. It is an unthrottled synthetic lab result, not field p75. See `calendar-layout/{before,after}/trace.json` and `tools/calendar-layout-stability-check.mjs`.

## Performance evidence

The final comparative results are recorded in `artifacts/premium-app/performance-accepted.json` and `journey-performance-accepted.json`, compared with `performance-before.json` and `journey-performance-before.json`. Earlier diagnostic runs and asset snapshots remain available, including failures and the first-editor regression investigation; they are not substituted for the final complete runs.

Measurement contract: useful data is visible and the primary control is enabled; cold Home additionally requires populated session metrics and numeric fitness. A subsequent Next day action verifies responsiveness. No shell/spinner-only readiness is used.

Entry profile: production static assets, Edge Chromium 156.0.4314.42 on Intel Core Ultra 7 265, 390×844 touch/mobile emulation, America/Chicago, 4× CPU slowdown, 40ms network latency, 40Mbps down/10Mbps up, the same deterministic local account/date/data (100 planned, 108 history), no external provider calls. Each cold sample uses a new browser context. Warm navigation reuses loaded route modules. Retained-data reload keeps device data but fetches uncached assets; the fixture sends no-store and blocks the service worker, so it is **not** an installed-PWA/background-resume measurement. Both builds use identical conditions. n=12 per flow; nearest-rank empirical p95 is the maximum with this small sample.

**The 3× target was not achieved in any measured entry/core flow.** Both useful cold loads are below the 2-second goal on this defined lab profile. Values are rounded milliseconds, **median / empirical p95**; speedup compares medians.

| Entry/navigation flow | Before (ms) | After (ms) | Median speedup | Acceptance |
| --- | ---: | ---: | ---: | --- |
| Useful cold Home | 1,373 / 1,468 | 1,246 / 1,311 | 1.10× | ≤2 s goal; not 3× |
| Useful cold Calendar | 2,148 / 2,333 | 1,600 / 1,661 | 1.34× | ≤2 s goal; not 3× |
| Retained-data reload, uncached assets | 1,020 / 1,165 | 956 / 1,022 | 1.07× | Not 3×; not a PWA resume test |
| Warm Home → Calendar | 305 / 469 | 246 / 312 | 1.24× | p95 >200 ms; not 3× |
| Warm Calendar → Home | 207 / 234 | 157 / 194 | 1.32× | p95 ≤200 ms; not 3× |
| Home Next day response | 47 / 55 | 38 / 43 | 1.23× | p95 ≤100 ms; not 3× |

All 12 samples per entry flow completed with no console/page errors. See `performance-comparison-accepted.json` for unrounded values and ratios. The warm reload label in raw data is clarified above: cached account data with uncached assets, not actual return from iOS suspension.

Additional journeys use the same mobile profile, n=12 per flow, with a fresh browser context and reset disposable server fixture per sample. Values below are rounded milliseconds, **median / empirical p95**. The editor is opened immediately after useful details; the date picker is preloaded only before the separate week-jump measurement. Both baseline and final runs use those boundaries.

| Journey | Before (ms) | After (ms) | Result |
| --- | ---: | ---: | --- |
| Calendar week jump | 271 / 321 | 243 / 258 | Improved; p95 >200 ms |
| First workout details | 241 / 266 | 213 / 250 | Improved; not 3× |
| First editor open | 485 / 521 | 762 / 834 | **Regression; not 3×** |
| Cached editor open | 92 / 118 | 83 / 94 | p95 ≤200 ms |
| Save feedback | 51 / 62 | 47 / 54 | p95 ≤100 ms; not a durable acknowledgment |
| Save to changed visible details | 238 / 291 | 220 / 233 | Separate from immediate feedback |
| Durable local acceptance | 170 / 194 | 156 / 168 | Strict IndexedDB completion; p95 ≤300 ms |
| Backend acknowledgment | 316 / 371 | 292 / 310 | Synthetic in-memory backend |
| Observed external sync completion | 2,052 / 2,394 | 2,008 / 2,047 | Synthetic provider with fixed 800 ms delay |
| First usable food results | 363 / 374 | 355 / 382 | Includes debounce; not 3× |

The first-editor regression is a material remaining limitation: the original calendar eagerly initialized Framework7, while the optimized startup defers its required editor controls. Despite selected-workout preloading, the final immediate first-editor result remains about **57% slower than the baseline**. Removing the remaining cost requires isolating the mobile editor's Framework7 lists, ranges and nested sheets, or restoring that startup work. The current change prioritizes useful calendar loading and retains existing editor behavior; it does not claim that every journey is faster. The final 12-sample journey run had no console/page errors or failed assertions.

Reproduce the comparison sequentially, with other builds/browser suites stopped. The tools start and stop their own isolated fixture servers and write fresh JSON under the phase name:

```powershell
$env:PERF_SAMPLES = "12"
$env:PERF_REUSE_RECORD = "0"
$env:PERF_DETAILS_ONLY = "0"
$env:PERF_DIST = "artifacts/premium-app/baseline-dist"
$env:PERF_PHASE = "baseline-recheck"
node tools/premium-mobile-performance.mjs
node tools/premium-journey-performance.mjs
$env:PERF_DIST = "artifacts/premium-app/review-build-accepted-dist"
$env:PERF_PHASE = "release-recheck"
node tools/premium-mobile-performance.mjs
node tools/premium-journey-performance.mjs
```

The scripts require the installed Edge browser and the bundled Codex Playwright runtime resolved in their imports. Fixtures use ports 5398 and 5404 by default; `PERF_PORT` can override them. Do not mix baseline assets with a development server or compare an authenticated live API run to these synthetic runs.

Independent save evidence: ten production-browser saves with a deliberately seven-second synthetic provider delay, desktop 1280×820, no CPU/network throttle. Visible save feedback median **59.2ms**, p95 **80.6ms**; actual IndexedDB transaction completion median **18.6ms**, p95 **26.6ms**. This satisfies the local-feedback and local-acceptance targets for that fixture. Backend acknowledgment is recorded separately and uses an in-memory server fixture, not measured Supabase durability. See `workout-commits-browser.json`.

Editor input-to-profile/frame p95: swim **12.6ms**, bike **11.8ms**, run **10.7ms**, n=40 each. First shared mobile confirmation **61.1ms** in the final build, n=1 at 4× CPU; no p95 claim from one sample. These are lab DOM/frame boundaries, not physical display measurements or field INP.

Measured root causes and remaining cost: eager nutrition/realtime/date-picker JavaScript and hidden desktop summary work were reduced. In the first sample, completed JS resources observed at useful readiness changed from **1,637,657 to 1,191,451 decoded bytes** for Calendar, and **799,322 to 728,890** for Home. These are readiness snapshots, not full-session transfer totals. Observed long-task duration sums changed from **1,041 to 427 ms** for Calendar and **442 to 403 ms** for Home. Global CSS remains large (roughly 543KB calendar/449KB Home decoded), and React rendering/style work remains significant on the throttled profile. The build retains a large, deferred Mapbox chunk warning. Do not infer real-user Core Web Vitals from these lab runs. Field p75 LCP/INP/CLS is unavailable.

## Direct TrainingPeaks reference and parity

Used the user's signed-in in-app browser session, after the user opened it. Inspected at 1148×669 and compared equivalent app surfaces. No subscriptions, integrations, account settings or messages were changed. One clearly titled disposable run and its copy were saved and then deleted; no matching disposable records remained. Real workouts were opened read-only and closed with Cancel.

| Surface/workflow | Reference observed | App verification and remaining gap |
| --- | --- | --- |
| Calendar | 40px top nav, 56px toolbar, 64px library rail, seven day columns, right summary, card hover/menu, day Add/Cut/Copy/Paste/Shift/Delete | Existing dense calendar retained; explicit summary added; keyboard/mouse actions and persistence covered by fixtures. App identity rail/header differ. No pixel-identical claim. |
| Bike builder | Duration / %FTP / Range default; four × (6 min at 85–95% + 3 min at 50–60%); cadence, notes, lap end; 36 min total | Matched-state capture, validation, structured serialization, save/reopen and drag pass. |
| Swim builder | Distance / yds / %ThresholdPace / Range; four × (200 yd at 105–115% + 50 yd at 75–85%); 1,000 yd, 15 min using reference threshold; 25 yd / 25 m / 50 m pools; no cadence | Separate sport fixture verifies yards, pace/recovery/repeats, totals and round trip. |
| Run builder | Duration / %ThresholdPace / Range; four × (6 min at 105–115% + 3 min at 75–85%); 36 min | Reference changed to three repeats and saved 27 min, then reopened unchanged. App separate run tests pass. |
| Copy/move/delete | Disposable run Copy/Paste created a second 27 min workout; Delete cleaned both | Reference drag attempt did not establish a successful persisted move. App drag/move is fixture-tested; exact live drag parity remains unverified. |
| Library | Search, Recents/folders, title/sport A–Z/Z–A, content/sport/distance/duration/TSS/intensity filters | App library/search and calendar library surfaces inspected; complete folder/filter/drag parity is not implemented or verified. |
| Analysis | Recorded Bike Summary/Analyze, map/graph, time/distance, colored signal controls, min/avg/max, laps and selection | Existing app analysis inspected, lap and axis controls verified, inspector overlap fixed. Complete Analyze360/map/tooltip geometry parity remains unverified. |

41 endurance browser groups and 14 drag groups passed after the shared-confirmation build. They cover interval order, repeats, recovery, duration/distance, ranges, cadence/lap behavior, invalid drafts, exact native description/private model serialization, save/reopen, reload and cleanup. Existing geometry tests now explicitly expand the default compact dialog before asserting expanded dimensions; assertions were not removed. These are Intervals.icu adapter/serialization fixture round trips, **not a new live Intervals.icu write/readback for each sport**.

## Persistence, recovery and account boundaries

The existing durable local journal and server commit service remain authoritative. Verified: save/navigation/reload, ten interrupted delivery cycles, real browser offline/reopen/reconnect, stale concurrent-tab rejection with a recoverable losing draft, latest intent surviving tab closure, source responses not replacing newer accepted edits, duplicate operation replay, IndexedDB transaction abort without false save acknowledgment, and account changes during retry. All browser tabs were closed after backend acceptance; the synthetic server still finished the pending seven-second provider operation.

The new cold-device regression passed again in the final frozen build: two fresh contexts edited the same event and reached `app:1` then `app:2`, with local durable completion, backend acceptance and simulated provider synchronization for both and no errors. Evidence: `journey-performance-accepted-cold-device.json`. The original second-device HTTP 409 is preserved in `journey-performance-diagnostic.json`.

The deployed architecture has a durable backend journal and Vercel `waitUntil` for its initial drain. **No scheduled cron drain is configured in vercel.json.** Prolonged provider failures after that execution window may wait for the next open/webhook. Indefinite synchronization while the app stays closed is therefore not certified. Authentication expiry, rate limits, ordering, conflicts and failure receipts have automated coverage; hosted session expiry and production provider recovery were not manually exercised against real records.

Service worker/account cache compatibility, pending writes, auth and account-boundary tests pass. A real installed-PWA upgrade with pending writes, iOS process suspension and background execution were not available for hands-on verification.

## Gates, devices and acceptance checklist

| Gate/check | Result |
| --- | --- |
| Production build + TypeScript | Pass, `premium-report-popup-build.log`; deferred Mapbox size warning retained |
| ESLint | Pass, `premium-report-popup-lint.log` |
| Full UI tests | **931 passed**, `premium-report-popup-ui-tests.log`, including new hydration and immediate-dismissal regressions |
| Full backend tests | **1,003 passed**, `premium-backend-tests.log` |
| Python tests | **5 passed**, `premium-python-tests.log` |
| Responsive route matrix | **56 combinations per engine**, eight routes × seven widths, Chromium and WebKit; no page errors or root overflow |
| Shared dialog matrix | **10 per engine**, normal/reduced motion; focus, touch sizing, containment, Escape and scroll unlock |
| Detail sheet matrix | **5 per engine**, including first-open gestures and reduced motion; focus, Back, containment and scroll unlock |
| Production confirmations | **6 journeys**, including browser Back, duplicate requests and editor return |
| Endurance / drag / calendar actions | **41 / 14 / 5** browser groups passed |
| Sidebar / analysis | **2 / 5** desktop viewport checks passed |
| Desktop report popups | **3 groups per engine**, plus **13 description resize checks per engine**; Chromium and WebKit |
| Nutrition | Two engines, five interaction widths plus four production failure widths; 34 UI and 43 backend targeted tests passed |

Route matrix: Home, Calendar, Nutrition, Settings, Library, Workout Reports, Annual Plan and Coach; widths 320, 360, 390, 430, 768, 844 landscape and 1440. Detail/editor/dialog flows are covered separately. Final artifacts: `artifacts/mobile-stability/premium-final/geometry.json` and `premium-final-webkit/geometry.json`. The deliberate Home carousel still scrolls independently. Mobile calendar day-add buttons are absent while desktop buttons remain; Home's verified greeting position remains 56–90px from the top.

After the final calendar/canonical-read fixes, all seven calendar widths passed again in both engines (`premium-final-calendar` and `premium-final-calendar-webkit`), as did all five analysis widths. The preview server was restarted to load the new backend module before the final analysis pass. The broad geometry recorder's simple sum of layout shifts is a diagnostic; only the dedicated session-window trace above is reported as CLS.

The measured accepted-build snapshot is preserved separately from the later report-popup corrections. Sidebar totals and geometry passed at 1280 and 1440 against that measured snapshot (`premium-release-sidebar.log`, `sidebar/evidence.json` and screenshots), with no root overflow or console/page errors. The latest review server uses the popup-final snapshot described above; its report-popup browser coverage is listed separately.

Browsers actually tested: Windows Edge Chromium 156; Windows WebKit 26.5, runtime r2359 (`Playwright.exe` explicitly selected); manual in-app Chromium browser for TrainingPeaks and production review. These are desktop/emulated devices. No physical iPhone, mobile Safari hardware, VoiceOver, native iOS keyboard/autofill, installed PWA, notch/home-indicator device interaction, or actual suspension test was performed.

- [x] Preserve data and unrelated changes; establish baseline before performance edits.
- [x] Explicit sidebar labels/totals and shared arithmetic; linked/unknown/zero/date tests.
- [x] Improve shared confirmations, mobile targets/zoom, search recovery and contextual return.
- [x] Verify durable acceptance, offline retry, stale tab conflicts and integration-independent fixture saves.
- [x] Separate swim/bike/run editing, validation, structured persistence and drag coverage.
- [x] Production build, relevant automated gates, two-engine responsive and failure checks.
- [ ] 3× faster useful mobile loading on the defined profile; see measured results above.
- [ ] p95≤200ms for every warm core route/editor; see per-flow results, not a global pass.
- [ ] Complete indistinguishable desktop parity, including all library and Analyze360 states.
- [ ] Live Intervals.icu round trips for each sport, production Supabase latency/failure recovery, and original FatSecret timeout reproduction.
- [ ] Real-iPhone/PWA/VoiceOver/background/upgrade acceptance and representative field CWV.
- [ ] Guaranteed scheduled recovery after prolonged provider failures while the app remains closed.

No unhandled rejection, page error, lost accepted edit, duplicate retried mutation or wrong total was observed in the successful verified fixtures. Deliberately injected failures are recorded as test inputs. Finite coverage does not prove absence of every possible defect; the unchecked acceptance items remain open.

Guidance used: [Apple accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), [Apple buttons](https://developer.apple.com/design/human-interface-guidelines/buttons), [Apple layout](https://developer.apple.com/design/human-interface-guidelines/layout), and [Core Web Vitals](https://web.dev/articles/vitals). Lab timings are explicitly separated from field p75 targets.
