# Strength completion and exercise history: proposed next slice

Read-only source review, 2026-10-21. This document proposes work; it does not describe a completed implementation or certify parity. No source, package, build, provider record or reference account was changed by this review.

## Reference evidence and its limits

The reference owner's observations in `REFERENCE.md` distinguish three things which must remain separate:

- A saved future Strength prescription reopens directly in its editable builder. Its own future prescribed sets do not appear as prior exercise performance: the inspected AirSquat history showed **No exercise history available**.
- An imported completed Strength workout opens in a read-only Summary with **Edit Workout**. The reference owner's later captures, `reference-strength-completed-hydrated-summary.json` and `reference-strength-completed-edit-state.txt`, show planned/completed Exercises, Sets, Reps and Volume, plus independently recorded Duration, TSS and IF. The inspected example had zero exercise totals, actual Duration 00:46:56, TSS 30 and IF 0.59. Those particular zeros do not establish how an unknown exercise total should display.
- Editing the completed workout exposes the prescription editor and an **Analyze Workout** return action. The reference owner observed editable planned Duration, plain completed Duration and editable planned/completed TSS and IF. Save remained disabled when nothing changed. Feeling has five states; this example showed RPE 0. This observation does not establish the provider scale mappings or permission rules needed to implement those writes.

The reference owner also reported that the current official Strength Builder help describes mobile execution, actual reps/weight history, Apply Last Prescribed/Completed and 1RM/Volume/Compliance trends. This review did not fetch that article independently. Older device-pairing guidance conflicts with newer autosync guidance; neither is sufficient to impose a pairing restriction locally. Completed-set entry, completion toggles, partial sets, historical matching, trend formulae and paired-file behavior still need direct reference evidence. The built-in reference exercise catalog is not local actual-result evidence.

## What the app actually stores and renders

| Surface | Current evidence | Consequence |
| --- | --- | --- |
| Canonical Strength model | `app-backend/lib/workout-strength-model.{mjs,d.mts}` strictly permits a versioned prescription, blocks, exercises, parameter columns and set values. No result document exists. `recordMode: "completion"` is the only accepted block mode. | That literal is a prescription mode, not an execution status or proof a set was performed. |
| Editor | `workout-editor.tsx` passes only the prescription model/planned fields into `DesktopStrengthBuilder`. The builder computes totals from `model.strength` and edits those same set values. | Adding a Completed heading to the existing table would mislabel prescribed values as results. |
| Completed routing | `workout-permissions.ts` excludes completed/paired activities from `canEditWorkout`. Calendar `WorkoutDialog` and direct `workout-detail-page.tsx` select the Strength builder only for editable planned rows. | Completed Strength uses the generic completed view; the observed Strength Summary/Edit/Analyze lifecycle is absent. Removing this permission guard would incorrectly send activity writes through the planned-event editor. |
| Last Performance | The exercise button in `desktop-strength-builder.tsx` opens the left history panel. It does not load an actual performance or offer a verified Last Completed action. | Its current destination is prescribed history, despite the broader button label. |
| Exact exercise history | `strength-exercise-library.mjs` `history()` reads `editor_model.strength` from retained planned/history context, matches `libraryExerciseId`, and returns `actualResultsAvailable: false`, `coverage: "retained-calendar-context"`. | Correct identity separation exists, but this is not completed exercise history. `workoutCompleted` only describes the session; its copied sets are still prescribed. |
| Legacy history | Builder matches unlinked exercise titles; backend returns those separately as `legacyMatches`. | A title match must never become an exact identity match or be silently merged into an ID-linked trend. |
| History coverage/order | Backend deduplicates by calendar row ID, without a completed-only or before-current cutoff, and does not explicitly sort its result. Builder's legacy list sorts by workout date but also includes future/current prescriptions. | “Last” cannot safely mean the first returned row. Same-name future prescriptions and the current session are not prior performance. |
| History UI | `StrengthLibraryHistoryView` explicitly says actual set results are unavailable and offers Apply Last Prescribed. The action copies a retained prescription into a new Single block. | Preserve this truthful, working action as a separate feature. It is not the reference's completed-set reuse. |

Existing regression `strength-exercise-library.test.mjs` verifies exact IDs versus a different same-title definition and unlinked legacy rows. It deliberately asserts `actualResultsAvailable: false`; it is not completed-result coverage.

## Available actual evidence

`intervals.mjs` already projects paired `raw_activity`, `activity_id`, recorded start, actual duration and `workout_summary.completed`. Its summary has measured duration/load/intensity and other activity-level fields; `completed_data.rpe` uses native `icu_rpe`. These are usable session inputs with their existing null/zero semantics. They do not establish any exercise count, set, rep, weight, per-set RPE/RIR or compliance result.

The archived official OpenAPI at `artifacts/trainingpeaks-parity/public-intervals-openapi.json` contains activity-level `kg_lifted`, `icu_rpe`, `feel` and `session_rpe`. The reviewed schema contains no strength/exercise endpoint or named exercise/set-result field. `kg_lifted` cannot be distributed among prescribed sets; session RPE/feeling cannot fill per-set cells. Absence from this schema is not proof no provider or file can ever carry set data.

`activity-bundle.mjs` retains raw activity, streams, original recording bytes and analysis in the completed archive. Its current FIT adapters read laps and swim lengths (`activity-analysis.mjs`); they do not decode strength sets. An original file's mere presence is not actual-set evidence. A future importer would need real authorized recording samples, a documented message/unit mapping, provenance and independent byte-to-result tests before displaying imported results.

The existing encrypted sidecar stores exact **prescriptions**, including stable exercise/set/parameter IDs. No reviewed private document stores manual or imported actual Strength set results. Neither a completed status, paired activity nor a readable native Strength description changes that fact.

## Smallest implementable slice with current real inputs

Implement a **read-only completed Strength Summary**, before any new actual-set writes:

1. Route completed Strength to a distinct summary state while retaining ordinary completed recordings without private Strength metadata. Use authoritative `workout_summary.completed`/activity summary for actual Duration, TSS and IF; preserve unknown values as unknown, known zero as zero. Do not fall back to planned or interval-derived values when a modern actual field is null.
2. Show planned exercise/set/rep/volume totals from the retained prescription. Show completed exercise totals as unavailable unless an actual-results source exists; do not copy the reference example's zeros as a default. Label any provider-only total separately if its semantics have not been established.
3. Keep current retained-prescription history and Apply Last Prescribed explicitly separate from completed history. Add a stable ordered history query with an explicit current-workout exclusion/as-of boundary; do not rename all retained prescriptions “performance”. Same-day ordering needs an explicit timestamp/tie rule rather than assuming a calendar date establishes chronology.
4. Do not add enabled Edit Workout, Last Completed, trend or completion controls until each has a real data/write path. An existing paired event's prescription edit can be a later bounded extension, but must not treat its activity ID as a writable planned event. For an unpaired imported activity, there may be no editable planned document at all.

This slice can use existing real measured totals without inventing sets or creating a new native workout. It closes the completed presentation gap only; actual-set logging, completed reuse, feeling/RPE editing and performance trends remain open.

## Subsequent manual actual-results slice: proposed contract

The first genuine set-result source can be explicit user entry, independently stored from the prescription. This is a design proposal requiring implementation and reference review, not an available capability.

- Bind a separate versioned result document to the authenticated actor/account scope, immutable native activity identity and its native revision. A paired calendar event is an optional reference, not its primary identity. Re-pairing/moving a plan must not transfer another session's actual results.
- Capture the prescription revision/snapshot on which recording began. Reference exercise-instance, set and parameter IDs, plus exact `libraryExerciseId` when available. Store actual values and units separately. Added/unplanned sets need independent IDs; removed or edited planned sets must not silently erase existing actual results. Catalog edits/deletes must not rewrite historical snapshots.
- Distinguish unknown, explicitly skipped, completed and any supported partial state. These states need reference verification. A blank actual rep count is not zero, a checked session is not every set completed, and a default copied planned value is not measured. If a future “copy prescribed” convenience exists, require an explicit user action and preserve its manual provenance.
- Read permissions and current account identity before exposing data; authorize every write server-side. Require both result revision and the applicable source snapshot revision. Use a stable immutable operation ID retained durably before HTTP, serialize conflicting writes and independently read back the exact normalized result. A local cache is not successful persistence.
- Retain draft/identity on lost replies, denied rechecks and unknown outcomes. Reconcile the same operation; never auto-create a second session or overwrite a changed result. Provide explicit review of stale source/result revisions. Account switches, deleted recordings, unavailable encryption keys and missing private metadata must fail closed with a review/reload path.
- Keep native event revision, native activity revision and private result revision distinct. Existing `workoutRevision()`/editor queue protects planned WORKOUT events only and cannot provide cross-system atomicity or a provider conditional PUT for a new actual-results operation.
- Keep results out of native workout descriptions, machine JSON and template snapshots. Calendar copy/library scheduling may copy the prescription, never actual results. Deleting a catalog definition retains historical result identity. Native activity deletion needs an explicit retention policy; do not silently attach its results to a same-name replacement.

Initially write only the separate manual result document. Provider activity-level TSS/IF/feel/RPE mutation needs its own verified native contract, permissions, scale/null handling, revision/readback and recovery tests. Do not introduce an implicit paired native activity or mark an unperformed planned workout completed merely to store a set.

## Actual history and trends after a real result source exists

History should query persisted actual documents, not just the currently retained calendar window. Return explicit coverage/cursor/limits and distinguish manual from verified imported results. Exact library identity is primary; legacy name-only data stays separate with an explicit association flow if later supported. Exclude pending writes and current/future prescriptions; use actual recording time, not planned date. Pairing duplicates collapse by native activity identity without merging different sessions or accounts.

Apply Last Completed must copy a selected verified historical actual snapshot into a new **prescription**, regenerate prescription instance IDs and retain source attribution. It must not mutate the earlier result or imply the new session was completed. Selection of “last” requires a deterministic eligible-record ordering and explicit missing/deleted-source behavior.

Volume requires compatible known reps/load and explicit per-side semantics. Do not add kg to lb, treat missing cells as zero, or infer duration/TSS/IF from lifted weight. A 1RM estimate needs a named formula and eligibility rule; Compliance needs a documented planned-versus-actual definition. Neither is established by the reviewed reference/source evidence. Defer those trend labels until verified, rather than reusing prescription totals as measured trends.

## Required verification and outstanding evidence

- Actual JSX/routing tests: completed Strength opens Summary, future planned opens the editable builder, completed paired IDs cannot enter the planned mutation path accidentally, missing private metadata preserves measured totals, Summary/Edit/Analyze retain drafts and permissions when later implemented.
- Data tests: planned values differ intentionally from actual values; null/zero remain distinct; kg/lb, per-side, duplicate parameter kinds, partial/missing sets and unmapped provider totals never fabricate reps or volume.
- History tests: ID equality rather than title; deleted catalog definitions; same-name different exercises/accounts; current/future exclusion; same-day ordering; paired recording deduplication; pagination beyond retained calendar coverage; no result means no completed performance.
- Result lifecycle tests: storage failure before HTTP, held/duplicate Save, lost acknowledgement and page reload, changed prescription/result revisions, account switch, denied recheck, deleted/unpaired native source and missing private metadata. Assert zero prescription/native/calendar/template mutation for a result-only write unless explicitly requested.
- Independent browser evidence: enter distinct actual reps/weights, save/reload via authoritative GET, then inspect actual versus planned totals and exact-ID history; cancel and failed writes leave provider/private state unchanged. A fixture may exercise transport but cannot certify the reference's logging semantics.
- Before importer work: obtain permitted real device samples with known performed sets, document message/units/identity mapping and verify raw bytes independently. No present adapter or captured result proves this path.
- Reference owner still needs to inspect an actual populated completed exercise history, Last Completed selection/copy behavior, manual/partial completion, completed field validation, permissions, trend formulae and latest device pairing. The new completed Summary observations narrow presentation requirements, but do not answer these result semantics.

No live I/O, browser checks or tests were run by this document-only review. Existing tests cited above establish current prescription behavior, not completion parity.

## Standalone Summary implementation checkpoint

Following the review, a separate bounded implementation was authorized. New files only:

- `ui/src/lib/strength-completed-summary.ts`: pure planned/actual projection, strict valid private prescription use, separate compatible lb/kg subtotals and bound recording snapshots.
- `ui/src/components/desktop-strength-completed.tsx` and `.css`: read-only modal, Summary table, saved prescription display and existing activity-summary reads. Modern explicit nulls stay unknown; a downloaded snapshot replaces completed fields only when workout/activity/revision all match. Failed refreshes retain existing context values and expose Retry. Known zero remains zero. Completed exercise/set/rep/volume totals remain unavailable for every current source.
- `ui/tests/strength-completed-summary.test.mjs`: ten passing tests covering distinct prescribed/measured values, modern null authority, explicit zero/empty and invalid models, mixed units/per-side ambiguity, stale snapshot binding, provider-only legacy inputs, nonnumeric values, actual content rendering, cancellation/error retention, Files duplicate/error handling and optional action composition. The first render assertion incorrectly matched the word “Saved” when checking for a Save button; it was narrowed to an actual Save button. No product behavior was relaxed.

The component API is `DesktopStrengthCompleted({workout,onClose,onFiles?,fileDialogs?,onHistory?,onAnalyze?,details?})`. Analyze Recording, Files and Exercise History appear only when their real callbacks are supplied. `details` retains existing real comments/personal fields in a right pane, and `fileDialogs` is mounted inside the modal React content tree. Neither changes the calendar implicitly. No Edit Workout, Save, Last Completed, feeling/RPE write or trend control is invented.

The subsequent integration review adds `onDetails?` with a real **Notes and Details** action. The root can retain the full existing completed-details view behind that action instead of squeezing its entire layout into the optional 320px slot. It also adds `isCompletedStrengthWorkout`: completed status plus the authoritative presentation sport's exact case-insensitive WeightTraining/Strength/Weights aliases, never title-based detection.

Snapshot hardening binds the request and visible snapshot to `apiSessionRevision()`, `deviceCacheScope()` and a local reset generation as well as workout/activity/revision identity. Cache/auth/provider reset subscriptions immediately abort old reads and clear local actual snapshots; old context actuals are withheld after reset until a fresh bound read succeeds. Late success from another scope cannot republish values for unchanged recording IDs. The dialog keyboard boundary prevents underlying/browser Ctrl/Cmd+S while leaving Escape's default handling available. These follow-up routing/provenance/effect/keyboard regressions bring the focused suite to **14 passing tests**; scoped lint passes. A subsequent whole TypeScript run found only an unrelated root integration's unused `lazy` import in `workout-detail-page.tsx`, reported to the root without modifying its file.

The reference's initially supplied geometry measured only Summary's heading. The later `reference-strength-completed-full-summary-geometry.json` supplies aside/header/row styles: heading 15px/18.75, labels 13px/16.25, 56px label column, 100px numeric cells and 38.5px row progression. Scoped styles use those facts and existing Strength shell dimensions. Their rendered fit is **not yet measured**; no screenshot or percentage parity claim follows from source styling.

TypeScript and scoped component/helper lint passed. No package registration, route wiring, shared source/CSS change, build or browser verification was performed by this agent. The root owns Calendar/direct-link integration and must preserve existing analysis, comments/personal controls and file behavior; a wholesale route replacement without those callbacks would regress available actions. The earlier current-state table describes the pre-integration baseline. Manual actual-set recording/history remains a separate open slice.
