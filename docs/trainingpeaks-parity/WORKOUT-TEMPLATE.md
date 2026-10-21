# Explicit workout template contract

Status: production routes, request-scoped service, library read/scheduling
boundaries and synthetic preview are integrated in source. No deployment or
browser acceptance is implied by the backend checks below.

The observed reference saved-Strength action opens **Add exercise to Workout
Library**, prefills Workout Title (128 characters), requires an existing folder
and enables Add only after selection. A successful disposable Add was inspected:
the template contains the last committed source instructions even when the open
editor has different unsaved instructions. The editor remains dirty. The source
and template were separately cleaned up by the lead. New drafts disable this
action. This is a workout-template library, separate from custom exercise
definitions.

## Route bindings

- `GET /api/workout-library/folders` calls `listFolders()` and returns
  `{accountScope,readOnly,folders:[{id:'folder:N',name,revision,editable}]}`.
- `POST /api/workouts/event:N/save-template` calls `save(sourceId,input)` with
  `{accountScope,sourceRevision,folderId,folderRevision,title,operationId,reconcileOnly?}`.
  Title is nonblank, at most128 characters; operationId is UUIDv4. Unknown fields,
  draft models and invalid identities are rejected. `reconcileOnly:true` never
  first-writes. The saved source revision, rather than the unsaved editor, is used.
- Success is `{accountScope,operationId,verified:true,workoutId:'library:N',workout,
intent:{sourceWorkoutId,sourceRevision,folderId,folderRevision,title}}`.
  The echoed title is trimmed. All other intent fields bind exactly to the
  original immutable request. `workout` passes the existing library-row validator.
- `GET /api/workout-template-operations/<UUID>?accountScope=<64hex>` calls
  `inspect(operationId,expectedAccountScope)`. It returns account/operation,
  the same intent, `workoutId`, `workout` and status
  `saved|changed|deleted|unconfirmed|rejected`. Changed/deleted status requires a
  durable verified receipt and current native GET/404. Permission/network errors
  cannot certify absence. Unconfirmed state has no successful-save proof.

The existing authenticated handler/origin protection must apply. The service
independently requires the trusted actor and expected opaque account scope;
clients cannot select an actor. Scope includes origin, trusted actor, settings
scope and current provider connection. Key rotation deliberately changes scope:
this does not solve the existing application-wide private-metadata migration gap.

## Native folder and payload evidence

The archived official schema, originally obtained from
`https://intervals.icu/api/v1/docs`, declares Folder `athlete_id`, `canEdit`,
`visibility` and `read_only_workouts`. The authorized two-GET read-only probe
(`/athlete/0` plus `/athlete/0/folders`) returned two actual FOLDER records; each
had matching athlete_id, explicit canEdit:true, visibility:PRIVATE and
read_only_workouts:false. Names, IDs, child workouts and share tokens remain in
ignored private evidence. Public folder responses expose none of those tokens.

Only owned PRIVATE native FOLDER records are offered; public/shared/foreign
folders and PLAN records are excluded. Unknown edit permission remains disabled.
The selected folder's exact revision, ownership, privacy and write permission
are rechecked immediately before every still-prepared native POST claim,
including retained write-ahead intents. No folder is created and visibility is
never broadened. Native API state cannot be locked atomically with our claim;
provider permission enforcement remains authoritative after the final check.

Workout fields copied only when present and schema-valid are moving_time,
distance, icu_training_load, icu_intensity, joules, joules_above_ftp, target,
targets, indoor, color, carbs_per_hour and sub_type. The native body has a new
identity, selected folder, chosen title and clean human description. Calendar
date, paired activity, source UID/external ID, source tags, attachments,
athlete results, personal equipment and comments are not copied. Exact editor
model and planned values remain private; null and zero are preserved.

## Persistence and integration boundary

The new encrypted operation namespace stores the full prescription before native
I/O. CAS claims allow one POST for an operation across instances. Native tags
carry only `training-agent-template-<opaque hash>`, distinct from old source-event
mirror tags. No internal JSON, manual/planned envelopes or hidden model fields
are written into native descriptions. Lost POST replies reconcile by that exact
marker plus an independent complete native readback. Duplicate markers fail;
uncertain attempts never blindly repeat POST. Definite provider rejection remains
authoritative even when recording the rejection itself fails.

`hydrateTemplate` and `wrapLibraryReads` restore exact committed metadata only for
the recorded native ID, marker and matching native snapshot. Existing newer
attached editor metadata takes precedence. Subsequent native edits are not
overwritten. Changed/missing templates produce replay conflict and explicit
read-only inspection proof. An unresolved or rejected operation cannot publish
its private metadata.

Library list/detail/scheduling paths now use these reads. The two editor-route
automatic mirror calls and their retry warnings were removed; every existing
native template/tag stays untouched. The obsolete mirror writer was retired.
Its old test now verifies unchanged native/legacy template reads, and both
Strength library-clone tests use explicit snapshots with their original
independence assertions retained. Existing browsing/scheduling/deep links remain.

A failed/corrupt individual sidecar does not blank the native library list.
Affected rows retain normal identity/title/native prose and additionally expose
`structure_read_only:true` plus `template_metadata_error`; the response also has
`metadataWarnings:[{workoutId,message}]`. Ordinary rows remain usable. Singular
detail/scheduling fails closed with `TEMPLATE_METADATA_UNAVAILABLE`. The legacy
metadata adapter isolates individual library-list decode errors too; singular
reads still fail. No unsafe private Strength decoding fallback is used.

An already-attempted calendar schedule can still reconcile its durable copy
claim even when the source template later becomes unavailable. It verifies the
captured event identity/body without reloading the source and never POSTs on a
recheck. A new Add remains blocked; no-claim rechecks cannot create. The real
adapter regression commits a copy, loses its response, corrupts the source
sidecar, then resolves the original UUID with an unchanged native write ledger.

The desktop preview uses the actual service, synthetic native folders and clean
template transport. Its provider ledger includes `libraryWorkouts`. The explicit
localhost-only `preview/workout-template-state` hook controls actor/readOnly,
native before/after-write failure, folder ownership/privacy/permissions,
changes/deletion/corruption of newly created operation-tagged templates only.
These are test fixtures, not production administrative endpoints.

Focused tests cover validation, folder permissions/privacy, clean native text,
last-committed source, private Strength/startTimeAssigned/subtype/planned values,
cross-actor/provider isolation, actual encrypted-record adapter, lost replies,
concurrent claims, failed storage/rollback, prepared retry after folder change,
changed/deleted replay, current-state inspection and real scheduling adapter
round trips. These are synthetic; no native write was made by this backend slice.

Integrated checkpoint:19 focused service tests,4 actual HTTP/production-callback
and preview lifecycle tests, plus2 new legacy metadata read-isolation tests pass.
The complete881-test backend suite passes, including the coordinated five-curve
warning cleanup. Formatting and server/preview syntax checks pass. Source proof
includes actual production create/PUT callback execution with zero library or
folder writes and unchanged existing templates. This does not certify browser
acceptance or deployed behavior.
