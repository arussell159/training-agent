# Endurance editor and save refinement — 2026-10-21

This checkpoint supersedes earlier verification claims where fresh evidence disagrees. It records implementation and evidence, rather than certifying complete TrainingPeaks parity or a production deployment.

## Save pipeline

Before: the editor awaited provider reads, writes, independent provider verification, private metadata and prepared snapshots. Some paths closed optimistically, while the original request still owned delivery. Creation recovery existed, but it was not an atomically accepted workout revision plus independently recoverable delivery intent.

After: explicit Save atomically commits the full workout, revision and immutable operation to a strict IndexedDB transaction. Only transaction completion permits Save & Close to dismiss. The shared client resumes delivery across navigation, reload, reconnect and tabs. A backend encrypted-record CAS transaction accepts the revision and operation together; a leased worker performs the verified Intervals.icu adapter work. Correct-revision acknowledgement changes synchronization status separately. Browser Web Locks reduce duplicate handoffs; backend operation identities and leases protect implementations without Web Locks.

The durable local boundary and acknowledged backend boundary are distinct. An offline accepted workout is described as saved on that device. Backend acceptance changes this to saved in the app/pending synchronization. External acknowledgement alone permits a synced status. Persistence rejection retains the editable draft. Permanent handoff/provider failures retain the accepted model, stop automatic retries and expose a small Retry action. Genuine external conflicts retain both versions and reject blind retries. Review changes opens a comparison of the retained app model and freshly read native model, including all retained fields. An explicit choice checks both revisions again, archives both copies and either rebases the app version or adopts the reviewed provider version. Unsupported partial imports cannot be adopted; an externally deleted workout cannot be silently resurrected.

Full editor models, comments, manual planned values, configured zones and private fields remain separate from the external adapter. Immutable handoff bodies, per-workout ordering, safe coalescing, revision guards, timestamp-aware snapshot overlays, tombstones and delayed-read guards prevent older work from replacing later accepted edits. New app identities remain stable while the linked native event ID is retained separately. Imported event identities are preserved.

An explicit conflict choice is itself an atomically persisted local intent with an immutable operation identity and both reviewed copies. Its background handoff resumes after reload or reconnect, including a lost response after backend success. A pending choice blocks another save of that same workout while retaining the unsaved draft; unrelated workouts continue normally. Fresh authoritative calendar changes can flag an external conflict before bounded server reconciliation finishes, and an older cached synced receipt cannot clear that warning.

See [save/sync design](SAVE-SYNC-2026-10-21.md), [performance measurements](PERFORMANCE-2026-10-21.md), and [endurance evidence](ENDURANCE-REFINEMENT-20261021.md).

`tools/workout-conflict-browser-check.mjs` passed against the production UI and real service with a synthetic provider: a native edit after review rejected the stale choice without overwriting either copy; an explicit keep-app choice converged to the full app model; an accept-provider choice survived a lost response and complete page close/reopen by replaying the identical persisted operation body. Both resolutions retained their reviewed copies in `resolutionHistory`. Five additional client recovery tests verify atomic choice acceptance, the same-workout save guard, retry identity, Retry-After, authoritative-context conflict protection and rejected imported-handoff recovery. This is controlled recovery evidence, not a live-account conflict overwrite test.

## Real integration evidence

Using the app's existing connection, three disposable Swim/Ride/Run records completed backend acceptance → worker → independent raw Intervals.icu read → independent service reopen → edit → second worker/read/reopen. The full model survived and each edit retained its original native identity. All three records were removed, with independent 404 readback. No real scheduled workouts/history were edited.

The three backend acceptance samples were 513, 290 and 439 ms: two exceed the 300 ms backend target. This small sample is not a percentile. These measurements used an isolated durable audit ledger, not the user's production workout ledger. [Sanitized run evidence](LIVE-COMMIT-ROUNDTRIP-2026-10-21.json) names the measured boundaries precisely; combined round-trip spans must not be presented as isolated first-sync latency.

## Reference corrections

Fresh signed-in Swim, Bike and Run creators were inspected separately at a controlled 1280×720, DPR1 viewport. Earlier reference captures briefly followed the app panel's variable width; the final Run capture and subsequent computed measurements explicitly lock the viewport. Existing completed bike and swim summaries were also inspected without modifying them. All reference drafts were discarded.

Observed corrections include the 54.66%/45.34% lower split, 351 px summary field column, matching step/title/input widths, sport-specific zone widths and distance spacing, 200-yard swim chart fitting and ticks, ascending physical pace ranges, distance/pace conversion invariance, swim lap defaults, retained invalid numeric drafts, Escape restoration and menu dismissal. Forty input-to-SVG/next-frame samples per sport are recorded separately from opening and save timings.

Planned metrics now use separate sport calculations corroborated by fresh native examples and bounded inspection of observed public calculator assets: cycling rolling normalized power, duration-adjusted running stress, and cubic swimming intensity. Native planned swim timing quantization is explicit and leaves prescribed distance unchanged. [Formula observations, probes and limits](PLANNED-METRICS-20261021.md) retain the evidence and distinguish tested cases from unverified arbitrary ramp/target behavior.

The final populated comparisons use the same in-app browser at 1280×720, DPR1, with matched sport, titles, intervals, units and thresholds. Paired captures are `artifacts/trainingpeaks-parity/{reference,actual}-{run,bike,swim}-same-browser-final-20261021.jpg`; `same-browser-final-20261021.json` records actual planned values and scroller dimensions. Run and Swim summary client width/height are 627×213 px with 628 px content width, matching the reference horizontal scrollbar. Forty-eight measured Run/Swim coordinates differ by at most 0.125 CSS px. The final corrections include chart colors, white plot background, input padding, zero-padded pace, two-decimal IF and the 116.859375×32 px Save & Close button.

Reference JPEGs, local screenshots, computed geometry and workflow manifests remain under ignored `artifacts/trainingpeaks-parity/` and `artifacts/endurance-current-reference/`. Earlier captures include unmatched workouts or thresholds and are not the final matched comparisons. These establish the measured geometry and behaviors; they do not establish pixel identity. Every tooltip, hovered, disabled, invalid, saved and keyboard state has not been certified. Initial structured drafts still prefill a sport title while the reference shows an Untitled Workout placeholder; final comparisons explicitly populate both titles. Extra app context actions and Ramp options remain extensions. Nonselected pace-zone boundaries depend on athlete configuration and are not completely matched by the synthetic fixture. These are open parity limits, not rendering noise.

## Recovery limits

- The standalone Node server wakes the durable worker every 30 seconds and continues after browser tabs close. The synthetic browser test independently checks a native result after all pages close; it is not a hosted deployment test.
- Hosted initial work uses bounded invocation lifetime. Indefinite hosted retry requires an independently configured scheduler calling the protected drain endpoint with `CRON_SECRET`. This run has not deployed a scheduler, changed hosting plans, or installed credentials. [Vercel's documented scheduling limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) depend on the existing plan; an every-minute schedule must not be silently added to an unknown plan.
- An authenticated open app accepts offline edits. A completely offline fresh reload cannot pass the existing server session check until reconnection. Its accepted IndexedDB data survives; this is not fully offline authenticated startup support.
- The backend encrypted ledger has an explicit 2 MiB acceptance limit and compacts completed job payloads. It rejects further acceptance rather than claiming an unwritten save. Long-term archival remains capacity work.
- Durable changes are integrated for endurance workout create/edit/move/copy/delete. Other entry kinds and unrelated library/recurrence/provider workflows retain their existing contracts; this is not a claim that every application mutation was migrated.

## Final verification

- Full backend suite: 967/967 pass; full UI suite: 866/866 pass; Python suite: 5/5 pass.
- Production build and TypeScript compilation pass; full UI ESLint passes.
- The final frozen-build browser suite passes all 41 groups with zero unexpected runtime/network errors. All three sports complete create, durable local acceptance, synthetic provider synchronization, exact model/comment readback, reload/reopen and owned-record cleanup. Three desktop widths and context-menu keyboard/focus behavior are included.
- Forty input-to-SVG/next-frame samples per sport give p95 Swim 21.5 ms, Bike 15.6 ms and Run 15.6 ms. These are DOM/frame readiness proxies, not hardware presentation timestamps.
- Lost backend acknowledgement, persistent conflict choices, stale conflict review, IndexedDB failure, delayed provider writes, rapid revisions, reload/reconnect, multi-tab coordination and closed-tab worker continuation have controlled persisted-state evidence. The real integration evidence uses the three disposable records described above.

The final delivery build (2026-10-21 17:34:08.996 UTC, index SHA-256 `59dc3ed4754e8a9d3895ca09b2c928a07045a8ce36ae3ff4fb4289d08c1fb990`) was measured with competing browser/build/test work paused. Each row uses 40 samples and nearest-rank p95:

| Boundary | Final p95 | Target |
| --- | ---: | ---: |
| Save control response / next-frame proxy | 75.1 ms | ≤100 ms |
| Strict local IndexedDB transaction completion | 23.5 ms | ≤300 ms |
| Cached structured Run / Bike / Swim with title focus | 102.9 / 146.4 / 132.7 ms | ≤200 ms |
| Warm editable summary / new Run draft / week navigation | 104.1 / 75.1 / 61.7 ms | ≤200 ms |
| Cold calendar useful content | 1492.6 ms (maximum 1547.4 ms) | ≤2000 ms |

Eleven full-state Save/recovery checks pass on these delivery assets. The final calendar-anchor regression retains desktop 86 px/mobile 56 px positions through delayed content growth and virtualized scrolling. Full conditions, before/after checkpoints, raw evidence and immutable asset fingerprint are recorded in [the performance report](PERFORMANCE-2026-10-21.md). Its synthetic backend timings do not certify production database latency or hosted scheduler execution.

This change set includes all accumulated repository source and documentation changes at the user's request. Generated private screenshots/logs, local configuration and credentials remain ignored.
