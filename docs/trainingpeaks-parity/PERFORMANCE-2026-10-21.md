# Endurance responsiveness measurements — 2026-10-21

These measurements use the optimized production UI, not the development server. They are controlled synthetic browser evidence; they do not establish production-host, live-account, mobile, or pixel parity. Provider/database round trips are reported separately.

The final delivery snapshot meets the sampled targets: Save feedback p95 75.1ms, strict local acceptance 23.5ms, focused structured editors 102.9–146.4ms, and cold useful content 1492.6ms. Each boundary has 40 samples. All eleven persisted-state recovery checks pass. The exact asset hash, full table and remaining live-service limits appear below.

## Conditions and method

- Windows 11 build 26200 x64; Intel Core Ultra 7 265, 20 logical processors; headless Microsoft Edge 155.0.4283.62.
- Viewport 1280 × 820, DPR 1, light appearance, default browser zoom. No CPU throttling. The host also performed implementation/build work; the initial editor baseline overlapped part of the calendar baseline. This can inflate tail latency and prevents treating differences of a few milliseconds as statistically significant.
- Ordinary navigation benchmark: CDP network shaping with 40ms latency, 40Mbps download, 10Mbps upload; local HTTP fixture server with production assets and no response compression. Browser cold samples each use a new isolated context. Warm samples reuse already imported components and cached workout reads after one initial opening.
- Dataset: 108 history rows and 100 planned rows, 90-day retained context, populated calendar. Numeric provider-ID fixtures exercise the actual editor endpoints. `event:preview-*` display-only rows are unsuitable for editor hydration and were excluded from editor samples.
- Each reported p95 uses 40 samples and nearest-rank selection (38th ordered observation). This is a descriptive sample percentile, not a confidence bound. Raw individual samples and exact machine conditions are in ignored `artifacts/performance-2026-10-21/`.
- Cold readiness means populated visible workout cards with available week navigation, followed by an animation frame. Summary readiness requires the real planned-duration input to be enabled. The initial structured-editor baseline requires an enabled title field and populated interval cards; the delivery harness additionally requires the profile SVG and actual title focus. This stronger predicate prevents a focus deferral from appearing to improve readiness and makes the final editor boundary stricter than the baseline. The timing starts with the trusted click event and ends after the readiness predicate and an animation frame; Playwright's pre-click scrolling and actionability wait are excluded.
- Calendar navigation waits for the actual scroll position to change with populated workout content. New-draft timing starts at the Run choice in the already opened sport picker and waits for enabled creator input and the actual header. Cached structured-editor timing starts at Edit in the already opened action menu. Neither spinner nor toast presence is used as persistence/sync proof.

## Before

Immutable baseline UI assets: ignored `artifacts/performance-2026-10-21/baseline-dist/`. Captured before new durable-commit integration and new editor corrections.

| Boundary                        | Median ms | p95 ms | Maximum ms | Target status under these conditions |
| ------------------------------- | --------: | -----: | ---------: | ------------------------------------ |
| Cold calendar useful content    |    1433.2 | 1596.3 |     1610.6 | Below 2000ms in all 40 samples       |
| Warm populated editable summary |      48.2 |   89.6 |      226.4 | p95 below 200ms                      |
| New Run draft interactive       |      54.2 |   97.0 |      127.3 | p95 below 200ms                      |
| Cached calendar week change     |      42.7 |   83.6 |      155.6 | p95 below 200ms                      |
| Cached Run structured editor    |      70.9 |  162.1 |      168.5 | p95 below 200ms                      |
| Cached Bike structured editor   |      57.5 |  207.3 |      274.5 | Above 200ms target                   |
| Cached Swim structured editor   |      75.9 |  270.3 |      345.7 | Above 200ms target                   |

Raw evidence: `before.json`, `editors-before.json`. The existing route implementation already splits most page code, uses cached initial state, prefetches on intent, deduplicates visible workout reads, and preserves populated context during refresh. No speculative wholesale route rewrite was made merely to make already-low baseline numbers smaller.

## After navigation checkpoint

The 11:12:57 production build was copied to immutable `after-navigation-dist/` before its runs. Later save/recovery changes require their own final-build check; this timestamp identifies the measured assets precisely.

| Boundary                        | Before p95 ms | After median ms | After p95 ms | After maximum ms |
| ------------------------------- | ------------: | --------------: | -----------: | ---------------: |
| Cold calendar useful content    |        1596.3 |          1463.2 |       1609.0 |           1639.0 |
| Warm populated editable summary |          89.6 |            49.0 |        162.2 |            221.4 |
| New Run draft interactive       |          97.0 |            47.5 |        129.6 |            174.4 |
| Cached calendar week change     |          83.6 |            50.8 |        146.3 |            253.3 |

Each row has 40 after samples under the same network/viewport conditions. These sampled p95 values remain inside the requested navigation targets. The after tails increased; the experiment does not demonstrate an improvement in ordinary navigation and should not be described as one. Concurrent host implementation/test activity and occasional garbage collection remain uncontrolled influences. Cold content stayed below two seconds in all 40 measured runs. Raw evidence: `after.json`.

## Save boundary and controlled integration

The new local acceptance boundary is the `complete` event of one IndexedDB readwrite transaction with strict durability. It contains the complete editor model, accepted local sequence/revision, and pending delivery operation together. A completed object-store `put` alone is insufficient. Production backend acceptance is a separately acknowledged encrypted-store transaction; Intervals.icu acknowledgement is another later boundary.

`tools/workout-commit-browser-check.mjs` instruments actual UI Save clicks and verifies the IndexedDB ledger after transaction completion. Visible feedback is measured separately. The same production worker runs against a serialized in-memory backend record and the existing independently inspectable native-provider double. Its backend response timings demonstrate separation from the delayed provider; they do **not** measure Supabase durability or production network latency.

`tools/desktop-preview.mjs --calendar-edits --commit-provider-delay-ms=7000` delays native mutation requests by seven seconds without delaying local acceptance. The fixture implements documented external-ID bulk upsert matching, supplies the existing personal-field service, overlays accepted app revisions on background reads, and exposes test-only raw queue/provider inspection. It never contacts Intervals.icu or reads credentials.

Initial two-sample smoke tests established actual transaction records, calendar visibility during pending work, reload survival, ten delivery-outage Save/reload cycles, second-tab visibility and final native convergence after the first tab closes. First-save visible response exceeded 100ms in these small smoke runs (271–311ms), while local durable completion was 53–92ms; these are not p95 claims. The delivery outage uses failed commit transport with static assets and authentication available, explicitly distinct from a totally disconnected cold browser start. Persistent backoff accumulated during the ten-cycle outage caused tens of seconds of recovery delay before automatic convergence; this is observable recovery latency, not lost work.

The first full integration checkpoint (`commits-browser.json`) measured 40 UI saves with seven-second native-write delay: IndexedDB median 75.1ms, p95 202.4ms, maximum 237.5ms. Its visible-feedback check also permitted a previously displayed saved notice, so its 218.9ms p95 is not adequate evidence of newly painted feedback. This defect in the initial measurement was corrected rather than used as a passing result.

The stricter 11:17:23 build checkpoint (`commits-final.json`) measures the clicked Save button's actual disabled transition followed by an animation frame, including its `Saving…` label. This is a next-frame proxy for visible feedback, not a direct hardware paint measurement. It records 40 samples:

| Boundary                              | Median ms | p95 ms | Maximum ms | Result                                       |
| ------------------------------------- | --------: | -----: | ---------: | -------------------------------------------- |
| Save control response / next frame    |      43.0 |  117.5 |      189.0 | Misses 100ms p95 target                      |
| Strict IndexedDB transaction complete |      24.7 |   54.1 |       79.5 | Below 300ms p95 target                       |
| Synthetic backend acceptance response |         — |  120.9 |      212.8 | 44 actual handoffs; not production DB timing |

This checkpoint reduced measured local acceptance substantially while native writes remained delayed. The four feedback observations above 100ms had only 19–22ms IndexedDB completion, so the remaining tail concerns rendering/scheduling and concurrent host work rather than slow durable storage. Later idle-host measurements are recorded separately; this checkpoint is not relabelled as passing.

The same run verifies full persisted/native state, not merely messages:

- Forty successive accepted revisions, ten commit-transport-outage Save/reload cycles, and second-tab visibility retain the latest full editor model.
- A stale editor in the second tab cannot commit over a newly accepted revision; its losing draft remains visible and recoverable.
- True browser offline mode accepts a full model and operation locally. An attempted fully offline reload cannot open the app; reconnecting reopens the accepted revision.
- After the backend accepted `app:44` as pending, every browser page closed. The fixture's independent server timer completed synchronization. Raw test inspection does not trigger that timer. The independently checked native record had the correct final name and identity. Correct-revision synchronization was observed 7752ms after backend acceptance with a 7000ms artificial native-write delay (one sample; includes up to a one-second polling bound).
- Cancel followed by Discard creates no operation and preserves the earlier accepted workout.

Three backend integration regressions independently verify Run, Bike and Swim using the real commit service plus the preview store/provider doubles: duplicate receipt replay and concurrent drains produce exactly one native identity, and reopening retains the complete structured model. These tests passed; they do not substitute for live provider round trips.

An additional final-build run paused other agents' heavy tests/builds (`commits-idle-final.json`, 40 samples) measured Save feedback median 52.6ms, p95 103.6ms, maximum 180ms; strict local transaction median 24.3ms, p95 96ms, maximum 106.6ms. The 100ms feedback target still missed under this better-controlled host condition, so a paint-boundary correction and subsequent measurement are required. All ten lifecycle checks passed, including an injected IndexedDB transaction abort: the failed Save retained the editable draft, added no operation, and changed neither accepted model nor backend record. Backend revision `app:43` completed while every browser page was closed; correct synchronization was observed 7847ms after backend acceptance with the seven-second artificial delay (one sample, one-second polling bound).

## Profiled correction and passing Save checkpoint

Swim opening diagnostics captured both long animation frames and individual slow DOM geometry reads. The first slow stack mapped to `CalendarWeekViewport`'s dependency-free layout effect. Opening or closing an editor re-rendered its calendar parent, which synchronously measured every mounted week and restored navigation anchors despite no calendar layout change. Recorded forced-layout portions reached 50–80ms. The chart observers were initially left intact because this first profile did not identify them as the dominant reads.

Week heights now come from `ResizeObserver`'s completed border-box measurements; synchronous restoration runs for actual mount/layout changes rather than every unrelated dialog render. Real visibility transitions retain their final height measurement. A browser regression grows an earlier day's history to nine workouts behind a delayed refresh and scrolls through virtualization: Today remains at exactly 86px on desktop 1280×820 and 56px on mobile 390×844 before/after growth and on return. Raw evidence: `calendar-anchor.json`; all eight existing viewport unit tests and the changed calendar's lint check passed.

The Save handler also yields a paint opportunity for its actual saving/disabled state before persistence and accepted-context work. It still waits for strict transaction completion before reporting local acceptance. The 11:37:02 production checkpoint, including this change, the measured calendar correction and editor CSS, passed TypeScript and Vite build. Later focus and conflict-recovery changes require another measurement on the final combined build.

With other agents' heavy tests/builds paused, `commits-paint-final.json` records:

| Boundary                                     | Samples | Median ms | p95 ms | Maximum ms | Target                                          |
| -------------------------------------------- | ------: | --------: | -----: | ---------: | ----------------------------------------------- |
| New Save control response / next-frame proxy |      40 |      55.2 |   89.1 |      125.0 | Meets100ms p95                                  |
| Strict local IndexedDB transaction complete  |      40 |      27.0 |   87.8 |       92.1 | Meets300ms p95                                  |
| Synthetic backend acceptance response        |      43 |      63.9 |  163.9 |      173.4 | Measured separately; not production DB evidence |

All ten persisted-state/native-state lifecycle checks passed again. Correct-revision completion after all pages closed was observed 7793ms after acknowledged pending backend acceptance with the artificial 7000ms native-write delay (one sample; one-second polling bound). The accepted local transaction, acknowledged synthetic backend transaction and correct native result are distinct observations. No claim is made that real Intervals.icu takes this time.

## Additional editor profile

The calendar correction alone did not reliably meet the structured-editor target: `editors-layout-final.json` records Run p95 209.8ms, Bike 154.1ms, and Swim 215.7ms (40 each). These misses prompted a second profile rather than being omitted. Native title `autoFocus` forced 37–82ms of layout during React's DOM commit; another sample attributed 57.3ms to the chart effect's immediate geometry read. Title focus now runs after initial layout with `preventScroll`, and the chart relies on ResizeObserver's initial notification instead of a redundant immediate read. The real focus predicate also exposed the closing toolbar menu stealing focus back from the newly opened editor. Changing its explicit resolver to the ordinary Boolean return-focus policy preserves focus transferred into the editor. The dialog first receives modal focus, then its title receives focus after layout, unless the user has already interacted. The corrected diagnostic run (`swim-focus-profile3.json`) passed all 40 actual-focus opens at p95 153.5ms; only two title focus calls exceeded the profiler's 3ms reporting threshold, taking 4.5ms and 7.6ms. These diagnostic runs are supporting profiles, not the final uninstrumented certification.

## Combined production checkpoint

These combined runs use the same immutable `final-optimized-dist/` snapshot, built at 2026-10-21 17:02:42 UTC. Its `index.html` SHA-256 is `33389e4560a3c79894f368bd94ca421775804e6f7d83c254f9a34758b4180dad`. This includes sport calculations, focus handoff, chart/calendar layout changes, contextual header controls and durable conflict recovery. Other agents paused builds, tests and browser work during these runs. Later recurrence, validator and presentation corrections were followed by the final repetition below; this checkpoint is retained as separately identified evidence.

| Boundary | Samples | Median ms | p95 ms | Maximum ms | Target |
| --- | ---: | ---: | ---: | ---: | --- |
| New Save control response / next-frame proxy | 40 | 54.6 | 77.6 | 95.2 | Meets 100ms p95 |
| Strict local IndexedDB transaction complete | 40 | 17.2 | 26.3 | 45.3 | Meets 300ms p95 |
| Cached Run editor, actual title focus | 40 | 76.7 | 120.2 | 151.0 | Meets 200ms p95 |
| Cached Bike editor, actual title focus | 40 | 85.4 | 146.2 | 223.2 | Meets 200ms p95 |
| Cached Swim editor, actual title focus | 40 | 78.5 | 148.5 | 228.5 | Meets 200ms p95 |
| Cold calendar useful content | 40 | 1432.5 | 1525.1 | 1543.9 | Below 2000ms in all samples |
| Warm populated editable summary | 40 | 58.2 | 83.8 | 108.1 | Meets 200ms p95 |
| New Run draft interactive | 40 | 38.1 | 63.8 | 65.0 | Meets 200ms p95 |
| Cached calendar week change | 40 | 47.9 | 89.2 | 134.0 | Meets 200ms p95 |

Raw evidence: `commits-combined-final.json`, `editors-combined-final.json`, `navigation-combined-final.json`, and asset metadata `final-build.json`. Individual Bike/Swim observations still exceed 200ms; meeting a sampled p95 target does not mean every interaction is below it. Because final editor readiness requires focus and the baseline did not explicitly require it, these values establish the final target under the stated conditions rather than an exactly comparable percentage speedup. The final calendar-anchor browser regression also passes unchanged desktop 86px/mobile 56px positions after delayed growth and virtualized scrolling (`calendar-anchor.json`).

All ten complete-state lifecycle checks passed on this build, including ten blocked-delivery Save/reload cycles and the injected transaction abort. Synthetic backend acknowledgement was measured separately across 44 handoffs (median 64.6ms, p95 106.3ms, maximum 128.0ms); this is an in-memory test backend, not Supabase. Backend revision `app:44` was acknowledged pending before every browser page closed. Correct native completion was observed 7730ms later with a deliberately imposed 7000ms provider-write delay (one sample; one-second polling bound). The raw inspector does not schedule work.

An additional functional run (`commits-lost-response.json`, two initial saves, not a performance sample) deliberately receives a successful real backend response via `route.fetch()` and drops it before the browser receives it. After reload, the complete delivery body and operation UUID replay identically, the backend returns the original accepted revision, and the local ledger eventually records that acknowledgement. It passed together with all ten existing lifecycle checks. This distinguishes lost acknowledgement from a request that never reached the server.

## Final delivery build

All delivery measurements use immutable `artifacts/performance-2026-10-21/delivery-dist/`, built at **2026-10-21 17:34:08.996 UTC** (12:34:08.996 America/Chicago). The `index.html` SHA-256 is **`59dc3ed4754e8a9d3895ca09b2c928a07045a8ce36ae3ff4fb4289d08c1fb990`**. Its referenced asset filenames contain the build's content hashes. Other agents paused builds, tests and browser work throughout these measurements.

| Boundary | Samples | Median ms | p95 ms | Maximum ms | Target |
| --- | ---: | ---: | ---: | ---: | --- |
| Save control response / next-frame proxy | 40 | 56.2 | 75.1 | 105.3 | Meets 100ms p95 |
| Strict local IndexedDB transaction complete | 40 | 16.9 | 23.5 | 68.9 | Meets 300ms p95 |
| Cached Run editor: SVG, interval cards and title focus | 40 | 76.4 | 102.9 | 194.6 | Meets 200ms p95 |
| Cached Bike editor: SVG, interval cards and title focus | 40 | 92.6 | 146.4 | 224.9 | Meets 200ms p95 |
| Cached Swim editor: SVG, interval cards and title focus | 40 | 69.7 | 132.7 | 193.0 | Meets 200ms p95 |
| Cold calendar useful content | 40 | 1452.5 | 1492.6 | 1547.4 | Below 2000ms in all samples |
| Warm populated editable summary | 40 | 62.2 | 104.1 | 111.2 | Meets 200ms p95 |
| New Run draft from sport choice | 40 | 40.5 | 75.1 | 87.2 | Meets 200ms p95 |
| Cached calendar week change | 40 | 44.9 | 61.7 | 75.0 | Meets 200ms p95 |

Raw evidence: `delivery-build.json`, `delivery-commits.json`, `delivery-editors.json`, `delivery-navigation.json`, and aggregated `delivery-summary.json` in `artifacts/performance-2026-10-21/`. One Save feedback sample exceeds 100ms and two Bike editor samples exceed 200ms; the sampled p95 targets pass. This does not guarantee every future interaction meets the threshold. The final readiness predicate is stricter than the original baseline, so no exactly comparable percentage improvement is claimed.

All **eleven** complete-state lifecycle checks pass on this delivery snapshot. They include ten blocked-delivery Save/reload cycles, actual offline Save followed by failed offline reload and successful reconnect recovery, stale-tab rejection retaining the losing draft, all-pages-closed worker completion, Cancel/Discard, and transaction-abort atomicity. The additional response-loss check receives actual backend acceptance, drops the acknowledgement, reloads, and confirms two byte-identical request bodies and UUIDs replay to original revision `app:41`; local acknowledgement then recovers.

The browser independently observed 45 successful synthetic backend acceptance responses (median 62.0ms, p95 82.8ms, maximum 92.4ms); dropped responses are recorded separately. This exercises the real backend service with an in-memory store and is not a Supabase latency measurement. After acknowledged pending revision `app:45`, every browser page closed. The correct native revision was observed 7715ms after backend acceptance, including the deliberate 7000ms provider delay and a one-second polling bound. Raw inspection does not schedule work. The final anchor browser check again retains desktop 86px/mobile 56px positions exactly through delayed nine-workout growth and virtualized scrolling.

The final three-sport suite separately measures trusted field input through an observed SVG mutation and the next animation frame, using the same production build, headless Edge, 1280×820 and DPR 1. This is a DOM/frame proxy rather than hardware presentation timing:

| Input to graph boundary | Samples | Median ms | p95 ms | Maximum ms |
| --- | ---: | ---: | ---: | ---: |
| Swim | 40 | 10.9 | 21.5 | 22.3 |
| Bike | 40 | 10.7 | 15.6 | 20.1 |
| Run | 40 | 9.5 | 15.6 | 21.2 |

Raw per-sample evidence is in `artifacts/endurance-current-reference/final/{swim,bike,run}-input-graph-timing.json`. The suite also passed 41 complete-state assertions with zero unexpected requests, including context-menu focus, typed comments checked through an independent native GET, and create/save/reload/reopen/delete for all three sports. These validate behavior beyond the numeric-ID editor-opening fixtures.

## Limits and separate release checks

Final delivery measurements and the repeated local-transaction-abort scenario are complete under the stated conditions. Separately, real configured encrypted-store CAS acceptance and native create/edit/reopen round trips passed for all three sports: acceptance took 513ms, 290ms and 439ms, with two of three observations above 300ms. Exact models and external readbacks were verified, and the disposable records were removed; see [live round-trip evidence](LIVE-COMMIT-ROUNDTRIP-2026-10-21.json). These are backend acceptance samples, distinct from the 40 local IndexedDB acceptance measurements above. Statistically supported production-acceptance p95 and isolated real first-sync latency remain unverified: the three recorded 10.6–12.0s round-trip spans also include independent reads, two reopens and a later edit/sync, so they are not first-sync measurements. Browser-closed production scheduled-worker execution and fully disconnected app startup remain separate release checks. The preview's backend memory store does not survive server-process restart.

The current authentication boundary requires server session verification on a fresh page mount. An already authenticated open workspace can accept offline edits locally; the preserved ledger can resume after reconnection. A completely offline fresh reload cannot open the authenticated workspace until session verification can complete. The synthetic preview also intentionally substitutes a non-caching service worker. Neither limitation should be represented as a verified fully offline reopen.
