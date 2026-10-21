# Release history

## Compact summary and inline interval controls — 2026-10-21

The requested follow-up narrows the lower summary pane from 54.66% to 38% of the desktop editor and gives the interval pane 62%. Summary fields remain readable; interval duration/distance, percentage range, physical readout and training-zone selector share one row at 1280px for Swim, Bike and Run, including repeat blocks. Smaller layouts retain natural wrapping and the existing stacked summary. Branding, header, chart and workout data behavior remain unchanged. This intentionally supersedes the prior reference split and lower-panel geometry.

Validation: UI846/846, build/typecheck, full UI lint and69 browser groups (Endurance34, Calendar27, Layered8) pass. The browser suite checks non-overlapping inline controls, usable summary widths, exact save/reload, native description cleanliness, whole-number zone boundaries and1280/1024/768px layouts. Synthetic records are cleaned up. Evidence and deployment identity: `artifacts/endurance-inline/`. Rollback baseline: `dpl_FfMcjnFKuw9SzVBRkfjbxgcPV1j9`.

## Endurance visual refinement — live 2026-10-21

Swim, Bike and Run use the measured TrainingPeaks inset frame, panel proportions, Inter weights, 15px/weight 200 interval fields, 11px/weight 700 titles, control sizes, chart spacing/ranges and regular clock ticks. Planned-value and description fields match the measured positions and dimensions. Action buttons, lap-switch wrapping and 14px multiline notes now follow the reference layout. Notes retain the 2000-character limit and save guards. Zone clicks retain the selected percentage basis and round boundaries to whole numbers, per the user clarification; open zones stay native and manual fractional edits remain supported.

New metre and yard swim pool presets use the same nominal distances (600 warm-up, 200 Active/cool-down, 100 Recovery, 200/50 repeats). The prior physical conversion on *insertion* incorrectly made a default yard warm-up 656 yd. Switching the units of an *existing* 600 yd interval still converts physically to 548.64 m. The native/private roundtrip test includes mixed metre/yard intervals, and real pointer dragging into the empty swim-chart tail and back preserves the prescription. Existing saved workouts are not migrated. Branding, sidebar and site header remain.

Gates: backend 929, UI 846, build/TypeScript, full UI lint and backend formatter pass. Endurance 34 + Calendar 27 + Layered 8 = 69 browser groups pass, with synthetic cleanup verified. At 1280×720, the measured frame, overview, lower panels, step cards, role/range/zone controls, planned-value/description fields, actions, lap toggle and notes are within 1 CSS pixel of the live reference. Exact per-property deltas are in artifacts/endurance-visual/geometry-comparison.json. Reference evidence includes matched live DOM/computed styles and JPEG screenshots; no overall 1% visual or 5% functional score is certified, and a full state-by-state matrix is not claimed.

The first visual candidate dpl_3FfVcxAKvYAAzQRHRcSi78DSqeZx was promoted after 63 passing browser groups and byte-for-byte static verification. Its authenticated smoke exposed the yard-preset discrepancy; final local testing also caught and fixed an actions-menu overflow. Those diagnostics are retained. A second promoted candidate dpl_FzHCK5EW96MtxRYUrMpMMowWSRsS corrected the yard defaults and action/notes geometry. Final screenshot review then identified a bike chart-scale discrepancy, now repaired: reference percentage profiles fit 20-point bands with 20% headroom and a 100% minimum, regular upper-axis labels and a full-height selection background. Repeat chart labels use the same duration/unit wording as individual steps. A very large numeric draft keeps a bounded axis without freezing or writing. The harder Bike/pace blue-band tops and the easier Run quarter-tick scale are checked against reference captures within 1 pixel. The final freeze is artifacts/endurance-visual/release-profile/freeze.json; READY dpl_FfMcjnFKuw9SzVBRkfjbxgcPV1j9 is live at https://training-agent-omega.vercel.app (immutable training-agent-ox94uzhz1-arussell159s-projects.vercel.app), index 670f7f9e7ae99201fd9222c3f797a5f8ff852f9583420b267809768d8e45bc00. Staged and canonical 10 shells+56 assets match the tested build; 991 regular upload files pass exclusion/source/hash auditing. Authenticated Swim/Bike/Run drafts confirm the final chart positions, whole-percentage zone ranges, 600 yd swim warm-up and 14px notes. Console errors 0; all drafts are discarded and no live workout was saved. Original unit/shape preferences remain unchanged. Evidence: artifacts/endurance-visual/release-result.json, live-smoke-release.json and live-*-editor.jpg. Immediate rollback is dpl_FzHCK5EW96MtxRYUrMpMMowWSRsS; the earlier endurance functionality rollback remains dpl_AdmPMd1MdyA47CZRgpNVUeMC5oLL. No new live workout was saved during smoke testing.

## Endurance editor focus — live 2026-10-21

The user's updated priority is Swim, Bike and Run; Strength expansion is outside this follow-up. The release is live at https://training-agent-omega.vercel.app on READY deployment dpl_AdmPMd1MdyA47CZRgpNVUeMC5oLL (immutable training-agent-lt8d51m85-arussell159s-projects.vercel.app). Immediate rollback is dpl_Bv4S9oXvzCPbaHV34Ucv8ebFKE3b. Branding, sidebar and header are preserved.

Invalid visible duration, pace and target drafts remain visible and block both Save buttons and Ctrl/Command-S before any private/native write. Repeat/ramp local errors also reach the common synchronous save gate. Clearing the date cannot save the previous date. Power permits zero; cadence must be ordered from1 to300, Run starts at160–170spm and Bike80–90rpm. Step notes match the2000-character model limit; converted distance fields retain their precision.

The prior swim palette incorrectly reused generic kilometre-scale presets. The independently inspected TrainingPeaks metric defaults are now600m warm-up,200m Active,100m Recovery,200m cool-down; two-step repeats200/50m, three-step75/25/50m, and100m ramp stages. Yards convert physically, and lap ending survives insertion. New swim models use a private explicit-unit discriminator so metre/yard distances and per100m/per100y paces survive native export and exact reopen. Historical models without this discriminator retain their existing yard-token contract; no saved workout was migrated. The native pool selector is wired for these explicit-unit models.

Final gates: backend929/929, UI842/842, build/TypeScript, full UI lint, backend formatter and whitespace checks pass. Focused endurance21 + existing Calendar27 + Layered8 =56 browser groups pass on index2701c290f695ba3ef30fd6015e45be3a039cbbbf55da23e148b78b13af957f01. Endurance browser runtime/unexpected-network errors are0; deliberate rejection responses in other suites remain recorded. All owned synthetic records are cleaned up. Staged and canonical10 shells+56 critical assets match the frozen local build;991 upload files pass exclusion/required-source/hash auditing.

Additional real-provider evidence comes from an unsaved Intervals.icu Swim draft, Download→JSON:400m plus200yd parses to582.88m, exact secs/100m and secs/100y targets,20s rest and both lap flags. The production verifier accepts that actual native JSON with zero discrepancies. The native draft was cancelled without saving. Canonical authenticated UI smoke confirms the corrected presets and pool selector, console errors0, then discards the local draft and restores the original new-block yards preference. Independent native listing confirms no smoke workout was created. No live workout was changed by this follow-up and no device execution is claimed.

Evidence: artifacts/endurance-editor/release-result.json, release/freeze.json and source/dist snapshot, browser/result.json, calendar/results.json, layered/results.json, icu-unsaved-native-parser.json/.jpg, live-swim-editor.jpg and release logs. Initial baseline failures and intermediate diagnostics are retained. A Layered attempt against an already-used synthetic write ledger was invalid isolation evidence; the unchanged suite passed after a fresh preview. Full TrainingPeaks numerical/visual percentages remain uncertified; broader chart/Strength work stays outside this focus. No commit, push, credential, schema or security-setting changes occurred.

## Live release — 2026-10-21

The user explicitly instructed “Proceed and deploy” after the incomplete-parity checkpoint was disclosed. The verified fixes are now live at https://training-agent-omega.vercel.app on READY deployment `dpl_Bv4S9oXvzCPbaHV34Ucv8ebFKE3b` (immutable `training-agent-k7w287p18-arussell159s-projects.vercel.app`). Original rollback remains `dpl_HnoEUMfGPzbsnW2AfaTsDSG7zDWo`; the first promoted candidate `dpl_9raCToE91ZCd2s6r14idfBXQusQH` was superseded after live smoke exposed a false intensity-verification failure. This release does not certify overall TrainingPeaks parity.

The repaired backend treats Intervals.icu intensity as provider-derived while retaining exact manual IF privately. A real600s70–80%FTP workout with rounded load9 returned native intensity73.484695 rather than requested75, previously trapping its successful create as unconfirmed. Create, editor-update and planned-value update no longer author that calculated native property; all actual authored fields/prescription/private values remain verified. Narrow legacy lost-POST recovery validates immutable private text/IF, original app UUID, actual parsed prescription and every other native authored field. It never acknowledges an existing-record/private-only PUT.

Release gates: backend924/924, UI836/836, build/TypeScript and formatter pass. UI source/bundle remains identical to the full-lint/142-browser-group C840 checkpoint; affected Calendar27/Layered8/Template15 (50 groups) pass after the backend repair. Staged and canonical live10 page shells and56 critical assets match the tested build byte-for-byte. Upload987 regular files passes credential/local-data/artifact exclusions. No credentials, origin settings, schema or permission changes were made; no commit/push occurred.

Authenticated live create/recheck/update/reload verifies exactly one owned QA identity146805510 on2026-11-01, exact10m/9TSS, manual IF0.75 then0.76, original coaching/private notes and native600s70–80%FTP prescription. Independent Intervals.icu read confirms no private editor/statistical JSON or private note in the native description. Cleanup is complete after the user provided specific action-time approval following the initial automatic-review rejection. The approved live UI Delete removed only QA146805510; an independent native list confirms it absent and original145209079 present with unchanged updated timestamp2026-10-16T14:13:51.998+00:00. Evidence: live-cleanup-verified.json/.jpg. Evidence: `artifacts/release-provider-if-20261021/release-result.json`, live UI/native JSON and JPEGs, browser manifests, deployment records and logs; prior failure evidence remains under frozenC840.

The locally configured Supabase secret was stale and production secrets were nonpullable during an independent local probe; that probe changed no data/settings. The authenticated deployed write/read cycle and independent connector read subsequently passed. Staged auth correctly rejects the nonconfigured staging origin; canonical authenticated behavior passed after promotion. Full chart/Strength/state/lossless-reference and historical metadata-rotation gaps remain open in PARITY.md.

## Historical preparation — 2026-10-20

This record prepares delivery; it does not assert visual parity or that a new release has been deployed.

## Existing delivery path

- Repository: `https://github.com/arussell159/training-agent.git`, current branch `main`.
- Linked Vercel project: `training-agent` (`.vercel/project.json`).
- Canonical production URL: `https://training-agent-omega.vercel.app`.
- Existing Git delivery deploys `main`; prior successful releases are recorded in `docs/desktop-calendar-release.md`.
- Local Vercel CLI is cached, rather than installed on `PATH`: `C:\Users\AlexRussell\AppData\Local\npm-cache\_npx\323e1700ae881c51\node_modules\vercel\dist\index.js` (64.3.1). Invoke it with `node`; no new dependency is needed.
- Read-only `whoami` succeeded with the existing login. Restricted sandbox attempts failed on worker/network access; the same command succeeded with authorized elevated execution. This was an environment restriction, not missing login.
- `deploy --help` and `inspect --help` were read. Production deployment can be staged using `deploy --prod --skip-domain --yes`, then inspected and promoted through the existing project. A Git push to `main` may promote automatically; avoid treating that as a harmless staging-only action.

## Verified pre-release rollback target

An authenticated read-only inspection of the canonical alias returned:

- Deployment: `dpl_HnoEUMfGPzbsnW2AfaTsDSG7zDWo`.
- Immutable deployment URL: `https://training-agent-kuanscu5q-arussell159s-projects.vercel.app`.
- State: `READY`, target `production`.
- Node runtime: `nodejs24.x`; functions in `pdx1`.

Recheck the alias immediately before promotion in case another release has occurred. No deployment, promotion, rollback, environment change, commit, or push was performed by the preparation audit.

## Required release gates

1. Review the final diff, especially new files required by imports. Keep the user's branding, sidebar, and site header intact.
2. Run `npm run format:check`, `npm run lint`, `npm test`, `npm run test:ui`, and `npm run build`. CI runs the existing checks on Node 22 and 24.
3. Run the relevant real-browser suites and paired reference comparisons. A passing synthetic fixture suite is not proof of TrainingPeaks parity; unresolved parity rows remain open.
4. Audit deployment inputs with the existing `.vercelignore`. Exclude credentials, account data, local database/cache/config files, screenshot artifacts, logs, and the local TrainingPeaks MCP server. CLI 64.3.1 supports `deploy --dry --json` for listing upload inputs without deploying.
5. Stage the production build without aliasing, wait for `READY`, and inspect build/runtime diagnostics. Verify page shells and critical asset responses against the tested build.
6. Promote the inspected deployment using the existing project workflow, then verify the canonical URL loads the new build and existing authenticated navigation still works. Keep deployment ID, commit/build identity, and rollback target in this record.
7. Exercise disposable app records only for live writes. Independently read raw Intervals.icu descriptions and confirm no `Workout editor v1` or `training-agent-*-v1` envelopes were sent. Reload/reopen and confirm exact steps, manual prose, comments, planned values, and identity persist. Delete only the records created for verification.
8. Recheck browser console/runtime errors and cold/reloaded sessions. Restore or clean up disposable records and stop only previews started for this task.

## Provider-description audit

The production client removes private editor/manual-description/planned-value/comment envelopes before provider writes. The private representation and a separate prepared intent are persisted before the write in the existing encrypted backend-only `app_settings` store; the committed pointer changes only after provider acknowledgement or verified recovery. No new SQL schema, grants, authentication policy, or browser database access is required. Storage failure blocks the write rather than sending JSON as fallback. Account stores and resource kinds are isolated. See `RELEASE-REVIEW.md` for rejected-write cleanup protection, migration compatibility and external transaction limits.

This audit corrected a newline edge case: CRLF-normalized legacy envelopes previously escaped the LF-only stripping expression. Both LF and CRLF envelopes are now stripped, preserving surrounding human prose and native lines. A regression independently checks the raw provider body, a metadata round trip, and rejection of a stale editor model after native content changes.

Verification:

- Focused provider metadata suite: **17 passed**, including production HTTP/encrypted-store mock transport and independent native-step checks.
- Entire backend suite: **597 passed, zero failures**, with the permissions needed for local HTTP servers and temporary files. The initial restricted-sandbox run had seven environment failures; those are not the final test result.
- Prettier passed for the three audited metadata/helper files.
- No live workout, provider record, Supabase record, or account setting was mutated by this audit.

The follow-up sport implementation and export regressions bring the final full backend suite to **606 passed, zero failures**, recorded in `artifacts/backend-parity-sports-tests.log`. Backend Prettier and whitespace checks also pass. See `SPORT-MAPPING.md` for canonical provider mappings, zone isolation and FIT/cycling-export verification.

The subsequent aggregate data and disposable preview slice passes **612 backend tests and 439 UI tests**, with TypeScript checking passing. Evidence: `artifacts/backend-parity-aggregate-tests.log` and `artifacts/ui-parity-aggregate-tests.log`. See `AGGREGATE.md` for the new real-provider measurement projections, missing/zero semantics, historical HR-zone grouping, and remaining dashboard verification scope. Final release checks must include any later UI changes.

The namespace currently includes the provider API key hash. Rotating that key intentionally isolates the new connection, but does not automatically migrate sidecar metadata created using the old key. A future same-athlete credential migration must establish the verified athlete identity before sharing that data; the current tests establish isolation, not automatic key-rotation migration. Preserve this limitation until that lifecycle is implemented and independently verified.

Supabase skill review used the current changelog and RLS guidance. The upcoming retirement of obsolete TLS 1.2 CBC suites does not affect the supported current Node HTTPS client; the existing server-only table remains inaccessible to browser roles. No Supabase product implementation was changed.

## Final release result

The latest integrated persistence checkpoint passes **715 backend tests and 506 registered UI tests**, zero failures (`artifacts/backend-parity-release-review-tests.log` and `artifacts/ui-parity-release-review-tests.log`). `RELEASE-REVIEW.md` records the concrete Event receipt/routing and workout metadata transaction fixes, Generator option guards, regression scope and recovery limits. Formatter, server/preview syntax and Git whitespace checks pass. Integrated build/browser/visual verification and any deployment remain pending lead-owned gates.

Goals and Availability persistence plus span compatibility pass **673 backend tests, zero failures** (`artifacts/backend-parity-annotations-tests.log`), including 21 annotation service tests and three production-service/queue preview tests. `ANNOTATIONS.md` records the native availability contract, exact private goals/sport storage, narrow writes, independent confirmation, immutable recovery identities, stale receipt rejection, timed/native outlier handling, per-card errors and real cross-provider limits. Generic annotation Copy remains explicitly unsupported pending a dedicated metadata-preserving clone. Final integrated UI/browser/build and deployment are still lead-owned gates.

The calendar Metrics persistence slice passes **635 backend tests, zero failures**, recorded in `artifacts/backend-parity-wellness-final-tests.log`. Its 21 service tests and 11 preview tests cover native narrow writes, private exact-label/time storage, refresh, concurrency and recovery. The aggregate/context validation UI suite passes nine tests, and TypeScript plus focused context validation lint pass. `METRICS.md` documents the public contract, provider constraints, hydration-only caching, missing/zero semantics and external transaction/key-rotation limits. The lead agent's final integrated UI/browser/build/deployment gates remain authoritative.

Pending the lead agent's implementation, parity verification, and deployment. Fill in actual results; do not replace pending gates with an unsupported completion claim.
