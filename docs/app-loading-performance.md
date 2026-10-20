# Calendar, workout and Nutrition responsiveness — October 19, 2026

The October 19 speed audit now includes Calendar, planned and completed workout popups, Analyze, Analyze 360, the structured builder, and Nutrition. No database schema, authentication policy, provider write verification or watch integration is changed.

## Measurements

The original pre-speed production build (`index-CXvWxK8E.js`) is preserved in ignored `artifacts/responsiveness/baseline-dist/`. Tests use the same disposable synthetic records, a 390×844 phone viewport for route startup, a 1440×900 desktop viewport for workout popups, and fixed 500ms response latency for session verification, training data, diary reads, workout reads and recording reads. JavaScript files remain local. Both builds use the same optional local diagnostic observer. Diagnostic records are retained in ignored `artifacts/full-app-speed/`.

| Ready state | Before, ms | After, ms | Improvement |
| --- | ---: | ---: | ---: |
| Calendar with refreshed data, median of three | 1,439 | 667 | 53.6% |
| Nutrition with refreshed diary, median of three | 1,415 | 620 | 56.2% |
| Planned workout inputs accepting typing, three sports | 546 | 22 | 96.0% |
| Analyze 360 recorded charts after its button is clicked, median of three | 355 | 33 | 90.7% |

Calendar's three original refreshed samples were 1,435, 1,439 and 1,439ms; final samples were 716, 667 and 667ms. Nutrition's original refreshed samples were 1,425, 1,415 and 1,404ms; final samples were 634, 620 and 619ms. Original editable-input samples were 546, 549 and 542ms; final samples were 34, 22 and 21ms. Analyze 360 samples were 852, 355 and 348ms before, and 34, 32 and 33ms after. In a separate first-open observation, classic Analyze showed its recorded chart at 869ms before and 30ms after; that observation is not a three-run median. Recordings now start loading when the completed summary is opened, so button-to-chart time benefits from that preparation. These measurements do not claim that the recording's network download disappeared.

Route gains include the shared startup improvements shipped in the preceding release. They are not an additional 50% gain over that release. The immediately preceding build (`index-Do1IUoEM.js`) is also preserved separately for regression comparison. Its warm refreshed Calendar observations were 662 and 648ms; the final 667ms median is within a few percent. The additional work primarily reduces Calendar's initial editor dependency, eliminates cold-navigation reveal waits, prepares popup reads, permits immediate typing and removes food-search delay. First cached content and fully refreshed readiness are different measures: a fixed 500ms authentication round trip bounds how early private content can appear. No authentication checks are skipped to improve a timing result. Network, device and cache state affect live results.

## Changes and safeguards

Route components can commit their own matching skeleton while an import resolves, then render it directly. The implementation captures readiness during render so a module resolving between render and effects cannot leave a permanent skeleton. Warmed components render on the first commit. Home's food-entry and workout shortcuts warm after its first paint. The structured editor and its Framework7 controls are separate from Calendar's initial dependency chain; the shared workout-profile chunk fell from about 181kB to 19kB. Planned, completed, Analyze and 360 interfaces retain their existing layout and behavior.

Near-viewport Calendar cards prepare read-only values/comments using bounded, session-scoped caches, at most two groups at a time. Intent and summary opening prepare recording/editor code and data. Mutable reads expire after 15 seconds, include the current training version, and invalidate on local mutations and session/cache resets. A failed or mismatched response never becomes a cached provider revision. Closing one view does not abort another view's shared read. Sign-out aborts private pending reads and prevents late responses from being cached. Mapbox loads only for a real route; indoor recordings do not import it. Existing map, chart and editor skeletons remain in use.

Planned inputs accept typing while the provider revision loads. Incoming values update untouched fields and preserve each typed field. Saving remains gated on the provider revision, with the existing independent write/readback verification and conflict handling. Optimistic UI, rollback, durable operation identities, completed-recording protection and draft recovery remain in place. No timeout or unknown provider response is represented as confirmed success.

Nutrition reduces the food-search debounce from 750ms to 120ms, shares recent searches and library reads, and prepares adjacent diary days after the current diary paints. Explicit search retry bypasses the prior cached result. Library writes invalidate prepared results. Cache/session resets retain their existing protections. Adding food still paints its global keyboard-safe toast before saving, preserves focus, updates totals provisionally, and rolls back rejected changes. Adjacent-day preparation is bounded; it does not fetch the whole diary history.

## Validation

Production build, UI lint and whitespace checks pass, along with 499 backend and 328 UI tests. Added regressions cover cache expiry/weight accounting, shared prepared reads, mutation invalidation, mismatched workout IDs, sign-out during pending reads (including reads retired by a write), search retry/library invalidation, typing while the provider revision loads, and cold-route skeleton rendering. Write invalidation allows an active reader to finish without a false abort error, while preventing its older response from replacing a newer cached revision. A session reset aborts all private reads. Confirmed builder saves refresh the popup's comment list.

Synthetic browser QA verifies immediate typing before a planned read completes, retention of that input after loading, a confirmed duration save, opening and cancelling an existing structured builder, opening and cancelling summary-first and structured creation, classic Analyze and Analyze 360, and a confirmed Nutrition quick-add with no console warnings/errors. No live food or workout records are changed during verification. Preview latency/failure flags are local-only and disabled by default.

Live verification also found that a non-draggable mobile wrapper announced paired completed workouts as disabled. The wrapper now retains its pointer listeners without adding a second button role or a disabled ancestor around the real workout button. The real button still disables pending writes. A synthetic paired workout and a real completed swim both opened successfully after this correction.

## Production release

Final deployment `dpl_9movqosp8u6Z2N3xzZ3X6PSJnYGw` is READY and promoted to `https://training-agent-omega.vercel.app`, serving the tested `index-Dq9Beyi8.js`. Rollback is available to the preceding performance deployment `dpl_oXx3AbavbYmnugw2WwsgTDeVkPre`, or the prior release `dpl_3djudZSjnQzwJR8W8XrVWW3veAvV`. The upload manifest contains 639 regular files, with no artifacts, credentials, environment files or local data. An ignored empty artifacts directory has no uploaded file contents.

Canonical Calendar/Nutrition shells and the session endpoint return 200; anonymous full training reads return 401. The signed-in final browser build opens today's planned Run, a paired completed workout, editable desktop planned fields and the Nutrition diary/library, with no console warnings/errors or horizontal overflow. No live records were changed. Home retained 629ms refreshed readiness in an additional controlled guard check. Temporary benchmark servers/tabs were removed; the ordinary port 5194 preview remains available without injected latency or failures. Installed app shells may need a refresh/reopen to pick up the update; no forced reload can interrupt a draft.


## Remaining workspaces and Nutrition follow-up — October 19, 2026

All local development, benchmarks, UI interaction tests and mutation tests used the synthetic preview. It does not start the backend, load credentials, call Supabase, or connect to Intervals.icu. Its CSP and browser guard reject external requests. Requests from local testing to the remote database or providers: **0**. No production account data was edited for this pass.

Three-run browser medians with cached static assets and a fixed 500 ms auth/read delay, identical synthetic datasets, desktop 1280 × 720 and mobile 390 × 844. Readiness requires loaded content, not the skeleton. Settings waits for the race-event response and paint; Reports waits for an enabled Columns control and the report table.

| Workspace | Original desktop | Final desktop | Reduction | Original mobile | Final mobile | Reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| coach | 1389 ms | 585 ms | 57.9% | 1381 ms | 582 ms | 57.9% |
| atp | 1428 ms | 606 ms | 57.6% | 1402 ms | 595 ms | 57.6% |
| library | 1413 ms | 598 ms | 57.7% | 1401 ms | 586 ms | 58.2% |
| settings | 1392 ms | 621 ms | 55.4% | 1406 ms | 603 ms | 57.1% |
| workout-reports | 1451 ms | 692 ms | 52.3% | 1451 ms | 719 ms | 50.4% |

The original build is /assets/index-CXvWxK8E.js; the immediately preceding release is /assets/index-Dq9Beyi8.js; the tested final entry is /assets/index-BVlb8-39.js. This pass improved the first four desktop workspaces by an additional 42.8–46.3% against that preceding release. The 50% figures above compare against the original pre-performance baseline, not an additional 50% against the last release. These controlled measurements do not guarantee identical timings on every device/network. Evidence: artifacts/remaining-app-speed/comparison.json, original-desktop.json, final-desktop.json, mobile-comparison.json, reports-warmed.json and reports-mobile.json (excluded from deployment).

Coach, Library, ATP and Settings start only their own protected reads in parallel with startup. Intent navigation shares short-lived session-scoped reads. Mutations invalidate future reads; a local generation header prevents a post-write read from joining an older in-flight transport. Late responses cannot overwrite newer Coach/Library results. Logout clears the private caches and pending bootstrap responses. Saved report buttons now use the same session cache instead of retaining an unscoped module promise.

Library imports its extracted card instead of the whole calendar. Its initial manifest payload fell from 524,444 to 371,946 gzip bytes against the preceding release. Coach/ATP defer Markdown rendering until a saved report opens; Reports defers its comparison view. Existing card behavior, verified workout writes and provider synchronization remain in their established paths. Settings preserves typed thresholds during delayed reads and formats editable pace fields in the units shown by their labels. Workspace and ATP boot skeletons now match their layouts.

Reports first-page reads overlap startup only for the default All time view. Selected date ranges retain their existing query path. Metadata stores only version/expiry. A fresh archive skips the speculative history request; the local IndexedDB read is warmed during route/auth loading, then validated after authentication. A missing/invalid cache falls back normally. Explicit refresh discards an older bootstrap response. Final warmed report revisits issued zero history API requests; the controlled cold read overlap was also exercised.

Nutrition clearing retains/refocuses the search field during the original tap. Toasts sit near the bottom of the visual viewport, above the keyboard, while a measured search-control boundary limits their stack height. Geometry checks: search bottom 151.5 px; toast top 754 px at 390 × 844 and 340 px at 390 × 430. Search remained focused, empty after Clear, and unobscured during pending saves. Two separate confirmed synthetic additions updated diary totals from 1,257 to 1,467 kcal. The shorter viewport models available keyboard space; it is not a physical iOS keyboard test.

Validation: **499 backend + 340 UI = 839 passing tests**, TypeScript/Vite build, ESLint, whitespace checks, desktop/mobile route loads, Coach report rendering, Library filtering, Settings performance/sport filters and thresholds, ATP current-week controls, Reports filtering and two-workout comparison, Nutrition search/clear and visible pending/success feedback. No new dependencies. A stale local tab encountered removed old chunks during an in-place rebuild and recovered through the existing Reload app control; fresh final-build interaction checks showed no runtime errors.

Released to https://training-agent-omega.vercel.app as dpl_4hLmFnwB6RnA1nxrqMueTgAdkM8N (training-agent-6m0q7rjlv-arussell159s-projects.vercel.app). Static verification at 2026-10-19T14:24:12Z confirmed HTTP 200 and the tested /assets/index-BVlb8-39.js on all ten supported paths, with byte-identical entry JavaScript. This verification did not execute page scripts or query a database/provider. Live route checks caught an existing missing /atp rewrite; it was added and a production deep-link regression test now covers every app path. The corrected staged ATP route passed before promotion. Previous release for rollback: dpl_9movqosp8u6Z2N3xzZ3X6PSJnYGw. The synthetic localhost preview remains on port 5194 at normal speed.
