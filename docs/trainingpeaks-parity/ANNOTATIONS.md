# Goals and Availability persistence — 2026-10-20

Goals and Availability now use genuine Intervals.icu calendar events with narrow native updates and independently checked readback. Exact checklist identities/order/completion and reference-specific sport/reason distinctions persist in the existing encrypted account store. Provider descriptions contain readable text only. No database schema, policy, grants or client credential exposure is introduced.

The reference form observations below were supplied by the lead agent; this backend worker did not access the signed-in reference browser. They establish the observed form behavior, not complete functional or visual parity.

## Native compatibility

The current official [Event API schema](https://intervals.icu/api/v1/docs) exposes native `training_availability` (`NORMAL`, `LIMITED`, `UNAVAILABLE`) and `can_train_sports`. The [official availability guide](https://forum.intervals.icu/t/athlete-training-availability/124956) describes date-specific NOTE/HOLIDAY/SICK/INJURED events as overrides of weekly availability. Availability therefore has real provider semantics rather than merely looking like a calendar ribbon.

| App entry | Native representation | Exact private metadata |
| --- | --- | --- |
| Goals | NOTE with title, one all-day date and readable `[ ]` / `[x]` checklist lines | Goal identities, order, text and completion |
| Availability with Injury / Sick / Vacation reason | INJURED / SICK / HOLIDAY, native date span, availability flag and available sports | Exact reference reason, description, selected reference sport labels |
| Availability with None / Appointment / Work / Other reason | NOTE with native date span, availability flag, available sports and readable reason/description | Same exact fields |

Goals deliberately do not use TARGET: native TARGET represents numerical weekly training targets and is not an equivalent arbitrary checklist. Native event all-day end dates are exclusive, as explained by the provider's author in the [official API discussion](https://forum.intervals.icu/t/api-access-to-intervals-icu/609?page=17). The API presented to this app uses inclusive `endDate`; persistence adds one calendar day at midnight. Date arithmetic uses calendar dates, including leap days, month boundaries and DST, without introducing UTC date shifts.

Run, Bike, Swim, Crosstrain, Mtn Bike, Strength, XC-Ski, Rowing, Walk and Other have explicit native mappings. The reference's Brick and Custom selections have no equivalent native sport enum. Their exact selection remains local. For those selections only, the native event receives LIMITED availability with the complete currently documented native sport enum, avoiding an invented restrictive mapping and replacing any previous restrictive list. `nativeSportsComplete:false` and `nativeWarning` explicitly identify that Intervals.icu cannot enforce the exact selected formats. This is a concrete cross-provider limitation, not a parity pass. The native enum was checked against the public schema on October 20, 2026.

## Shared model and public API

`app-backend/lib/calendar-annotations-model.mjs` and `.d.mts` export the browser-safe catalogs, `CalendarAnnotation`, `CalendarAnnotationEntry`, `CalendarAnnotationKind`, `CalendarAnnotationGoal`, the sport/reason types, `validateCalendarAnnotationEntry` and `isCalendarAnnotation`.

Goals entry:

```json
{"kind":"goals","date":"2026-10-31","endDate":"2026-10-31","title":"Goals","goals":[{"id":"goal-identity","text":"Steady effort","completed":false}]}
```

Availability entry:

```json
{"kind":"availability","date":"2026-10-31","endDate":"2026-11-02","mode":"limited","sports":["Run","Swim"],"reason":"Work","description":"Morning only"}
```

These JSON examples describe app API payloads. They are never placed in provider descriptions.

Observed Goals behavior is enforced: title defaults to Goals and is limited to 150 characters; blank/whitespace checklist rows are removed; an entirely empty checklist is rejected. Goal order and completion persist. The implementation additionally bounds one entry to 100 rows, 8,000 characters per row and 28,000 combined provider-text budget; those are protective implementation limits, not observed reference limits.

Availability has inclusive start/end dates, `mode: unavailable|limited`, exact twelve sport labels and exact reasons None, Appointment, Injury, Sick, Vacation, Work, Other. Limited requires at least one selected available sport. Unavailable writes an empty sport selection. The plain description is bounded to 12,000 characters. Unknown fields, unsupported labels, duplicate identities/selections, invalid dates, reversed spans and unsupported kind conversions are rejected before provider writes.

- `GET /api/calendar/annotations?start=YYYY-MM-DD&end=YYYY-MM-DD` returns `{annotations:[...]}`. Ranges are inclusive and bounded to 371 days.
- `POST /api/calendar/annotations` accepts `{operationId,entry,reconcileOnly?}`.
- `GET /api/calendar/annotations/event%3A123` returns one row directly.
- `PUT /api/calendar/annotations/event%3A123` accepts `{operationId,revision,entry,reconcileOnly?}`.
- `DELETE /api/calendar/annotations/event%3A123` accepts `{operationId,revision,reconcileOnly?}`.

A row contains the entry fields plus `id`, `title`, opaque `revision`, `creationId`, `editable`, `metadataCurrent`, `nativeSportsComplete` and optional `nativeWarning`/`providerDescription`. `creationId` is the original create identity, allowing a lost-create draft to associate with its exact visible native card without matching titles or dates.

Confirmed writes return `{annotation,workoutId,workout,verified:true,context?}`; deletion returns `{id,workoutId,deleted:true,verified:true,context?}`. Native events are used internally for verified snapshot projection; mutation routes strip that internal top-level event. The embedded workout contains `calendar_annotation`, native opaque key/kind, safe native projection and inclusive `workout_end_date` so existing calendar history/range merging continues to work. No pending claims, receipts, account storage identities or credentials are public.

## Concurrency and recovery

Each annotation uses an encrypted, connection-scoped `calendar-annotations` record. A separate bounded index maps known native ids to their private identities for deletion recovery. The index never targets unrelated provider records. Native event external identity encodes the entry kind and original creation identity, not a serialized checklist or application response.

The server durably stages the exact normalized operation before claiming transport through compare-and-swap. A claimed create/update/delete is sent at most once by this service; uncertain retries only recheck that same intent. Existing-event routes also share the production workout write queue so ordinary app writes cannot run concurrently through a second editor. Plain provider fields are patched only when changed; unedited native properties such as attachments, imported notes/fields or maximum training time are preserved.

Provider responses are not treated as confirmation by themselves. A fresh GET must match every intended native field. Deletion requires a fresh 404. Lost replies and provider-accepted writes followed by a lost metadata commit recover after process restart using the original operation. An attempted operation absent from readback remains explicitly unconfirmed; rechecking does not send another POST/PUT/DELETE. A failed pre-transport store write prevents provider mutation.

The original operation identity and payload remain immutable during recheck; `reconcileOnly:true` is a transport flag excluded from the payload fingerprint. The latest 64 confirmed receipts support bounded retries. Reusing an identity for different changes is rejected. Replaying an older successful operation after a later update or external native content change returns 409 `ANNOTATION_REPLAY_CHANGED`, rather than falsely reporting that its original content is currently saved.

Other errors distinguish `INVALID_ANNOTATION` (400), revision/provider-content conflict, write busy or reused identity (409), read-only/foreign notes (403), missing annotations (404), and malformed/unconfirmed provider or storage states (502). Important codes are `ANNOTATION_CONFLICT`, `ANNOTATION_PROVIDER_CHANGED`, `ANNOTATION_WRITE_BUSY`, `ANNOTATION_OPERATION_REUSED`, `ANNOTATION_UNCONFIRMED`, `ANNOTATION_PROVIDER_INVALID` and `ANNOTATION_STORAGE_INVALID`.

Provider updates and private-store commits are separate systems. No documented conditional provider revision write is used; an external writer can race between a fresh read and narrow PUT. Durable app claims, revisions and readback reduce errors but do not constitute a distributed atomic transaction. API-key rotation also follows the existing connection isolation rules and does not automatically migrate old private metadata to a new credential.

## Calendar refresh and edge behavior

Native moves preserve checklist/availability metadata and inclusive span duration. Current native dates and ordinary valid title changes win over stale private dates/title. Altered native checklist/availability content becomes read-only instead of overwriting foreign prose from a stale private model. An externally enlarged title remains readable but cannot bypass the 150-character write bound. If the native entry becomes timed, its actual inclusive end day is retained and the all-day editor reports a read-only limitation.

Historical queries, retained snapshots, fast/week views and server range filters use span overlap for annotations; a multi-day entry beginning outside the selected window remains visible on its covered days. Deletion removes the native source card, so private metadata cannot resurrect a ghost event. Generic workout copy explicitly rejects annotations with `ANNOTATION_COPY_UNSUPPORTED`; the dedicated entry-transfer route clones exact private metadata under a new identity or moves the same identity with its full inclusive span. See `TRANSFERS.md` for verified reference evidence, recovery and outstanding browser integration. Generic Note editing also rejects these entries so the checklist/availability editor remains authoritative.

Context hydration uses the safe native projection plus private record. It never issues one provider GET per visible annotation. Repeated context decoration uses a bounded two-second hydration-only cache (32 provider/storage scopes, 512 records each), invalidated before and after writes. Form reads and revisions remain fresh. A missing/corrupt private record affects only its own native card: `calendar_annotation_error` remains visible with stable key/kind and native text, while unrelated workouts stay usable. It does not silently drop the entry or attach fabricated private details.

## Verification

The annotation service has 21 focused tests and the disposable route adapter has three. They independently check human native descriptions, exact private checklist recovery, supported and unsupported sport mappings, narrow patches, blank normalization, stale/read-only guards, concurrent and lost-response recovery, stale receipt rejection, malformed storage/provider inputs, native delete absence, account isolation, hydration cache behavior, month/DST moves, ongoing-span retention and external timed/out-of-bounds records. Preview updates/deletes use the production shared write queue. `--lose-annotation-response-once` enables browser recheck verification without any account credentials.

Final full-suite result is recorded in `artifacts/backend-parity-annotations-tests.log` and the release record. The lead agent owns integrated UI tests, browser capture and deployment. No live provider record, live database row, real note or account setting was changed by this backend work.
