# Calendar Metrics persistence — 2026-10-20

The calendar Metrics form now has an authenticated backend read/write contract. Native measurements are written narrowly to Intervals.icu and verified with an independent GET. Exact reference labels, measurement times and unsupported measurements persist privately in the existing encrypted account store. This implementation uses no new SQL schema and performs no live account writes during its tests.

## Shared fields and units

`app-backend/lib/calendar-metrics-model.mjs` and its declaration file export `calendarMetricFields`, `isCalendarMetricsEntries`, `CalendarMetricKey`, `CalendarMetricEntry`, `CalendarMetricRow` and `CalendarMetricChange`. The browser and server use the same fourteen field descriptors. Each entry has `{ value, time, source }`; `time` is an optional `HH:mm` clock value attached to the selected calendar date. No unobserved time-zone conversion or imported measurement time is invented.

| Form field | Accepted changed value | Persistence |
| --- | --- | --- |
| Weight | 0–1000 lbs | Native `weight` kg, using exactly `lbs × 0.45359237`; entered lbs/time retained privately |
| Sleep Hours | 0–24 hrs | Native `sleepSecs`, requiring whole-second representability; entered hours/time retained privately |
| Sleep Quality | Horrible, Poor, Bad, Average, Good, Better, Best | Exact label/time privately |
| Fatigue / Stress | None, Very Low, Low, Average, High, Very High, Extreme | Exact label/time privately |
| Soreness | None, Extremely Low, Very Low, Low, Moderately Low, Moderate, Moderately High, High, Very High, Extreme | Exact label/time privately |
| Yesterday's Training | Worse than normal, Normal, Better than normal, RestDay | Exact label/time privately |
| Overall Feeling | Horrible, Extremely Poor, Poor, Bad, Below Average, Above Average, Good, Superior, Extremely Superior, Best | Exact label/time privately |
| Resting Heart Rate | 10–200 bpm, whole numbers | Native `restingHR`; entered time privately |
| MuscleMass | 0–1000 lbs | Exact value/time privately |
| Percent Fat | 0–80% | Native `bodyFat`; entered time privately |
| Time in Deep Sleep / Time in REM Sleep | 0–24 hrs | Exact value/time privately |
| HRV | 0–200 | Native `hrv`; entered time privately |

Reference bounds and subjective labels come from the lead agent's observed form. The official current [Intervals.icu API schema](https://intervals.icu/api/v1/docs) identifies `restingHR` and `sleepSecs` as integers. Whole bpm/second restrictions are provider constraints; TrainingPeaks decimal rejection was not established. Imported native values outside form write bounds remain readable and do not prevent an unrelated change. An unchanged imported note longer than 8,000 characters is also preserved. Changed notes are plain text, at most 8,000 characters, and written to native `comments` only when explicitly supplied.

No subjective rating is converted to the provider's differently sized scales. Existing provider `fatigue`, `soreness`, `stress`, `sleepQuality`, custom fields, steps, CTL/ATL and other unedited measurements are preserved.

## API contract

- `GET /api/calendar/metrics?date=YYYY-MM-DD` returns `{ date, revision, entries, note, recordExists, providerUpdated, source, locked }`. `entries` contains every catalog key. An entry's source is `manual`, `intervals` or `unavailable`. The opaque revision includes the fresh provider record and committed private metadata.
- `POST /api/calendar/metrics` accepts `{ date, revision, operationId, changes, note? }`. `changes` contains only edited keys. Each changed entry is `{ value, time }` or `null`; `null` clears its value and time. Omitted keys and an omitted note remain untouched. Measured zero is distinct from clearing or missing data. Unknown keys and invalid dates, times, labels and changed values are rejected before a native write.
- `operationId` must remain stable for retries of the identical draft. A confirmed response includes `verified: true` and, when a training snapshot exists, the refreshed `context`. A recovered receipt also returns `replayed: true`.
- The provider record is used internally to project verified context; route responses strip that internal field. Pending claims, receipts, storage identities, credentials and configuration are never part of the public response.
- A valid empty provider day is represented by a 404. A malformed successful response, or a response for another date, is rejected with 502 before any write. This is fail-closed handling of the documented object schema, not a claim that every provider missing-date variant was observed live.

Errors distinguish invalid input (400), stale revision, active writer, locked record or reused identity (409), and unavailable/unconfirmed provider or storage results (502). Important codes are `INVALID_METRICS`, `METRICS_CONFLICT`, `METRICS_WRITE_BUSY`, `METRICS_LOCKED`, `METRICS_OPERATION_REUSED`, `METRICS_WRITE_UNCONFIRMED`, `METRICS_PROVIDER_INVALID`, `METRICS_DATE_MISMATCH` and `METRICS_STORAGE_INVALID`. The UI must retain uncertain drafts and retry their original identity.

## Persistence, concurrency and refresh

Each date uses an encrypted `calendar-wellness` record in the existing server-only `app_settings` table. A durable date index is updated before a provider commit. A compare-and-swap claim then records the intended changes and native patch before the external request. All provider writes contain only changed native fields. Subjective-only and time-only edits require no provider PUT. The server performs a fresh independent GET before reporting success and committing the private fields.

Lost provider responses reconcile from readback. A provider-accepted write followed by a lost private commit can recover the original labels/times using its durable pending operation. A different expired operation cannot discard those fields: it recovers the old confirmed operation first, then rejects the stale new draft. Completed identities retain the latest 64 receipts; this is bounded retry recovery, not permanent exactly-once storage.

Provider calls and encrypted-store commits are separate systems. The provider does not expose a documented conditional revision write here; an external writer can race between GET and PUT. Narrow patches avoid erasing unedited measurements, and readback verifies the submitted fields, but this is not a distributed atomic transaction. An unconfirmed result remains explicit rather than reporting a fabricated success.

Calendar context hydration reads only indexed dates in its requested window, in batches of eight. It preserves imported wellness rows/properties and adds safe `calendar_metrics`/`calendar_metrics_note` projections, including subjective-only dates and receipt-backed note-only dates. Fast context projection retains validated metric entries. Browser context validation rejects corrupt entry shapes before replacing a usable snapshot. An all-cleared record remains empty; zero-valued measurements remain visible.

Repeated startup/save context decoration uses a hydration-only two-second cache, bounded to 32 provider/storage scopes and 512 records per scope. Saves invalidate that scope before and after completion. Form loads and save revisions never use this settled cache. Separate credentials, encryption keys and storage endpoints cannot share cached values. Independent warm processes may display up to two seconds of stale private decoration; authoritative form reads remain fresh. Failed reads are not cached. The durable date index is bounded to 20,000 validated unique dates and never silently prunes old entries.

The namespace follows the existing provider-connection identity, which includes the API key hash. Credential rotation isolates the new connection and does not migrate old private metadata automatically. A verified same-athlete migration remains separate work. Context hydration refuses to combine a different connection's context and private metadata. If decoration storage is unavailable, the existing provider context remains usable with an explicit generic `calendar_metrics_error`; it does not report private entries as saved.

## Verification

- Full backend suite: **635 passed, zero failures**; `artifacts/backend-parity-wellness-final-tests.log`.
- Wellness service: **21 tests**, covering raw narrow patches, imported-property preservation, exact private scales/times, zero/null/omission, native-only and local-only changes, note-only reload, stale/locked/concurrent writes, idempotency, lost responses/private commits, expired-claim recovery, invalid dates/DST/leap days, malformed provider responses, corrupt stored metadata/indexes, cache expiry/isolation/invalidation and account separation.
- Disposable preview: **11 tests**, including production service execution, independent raw provider records, context reload and a lost HTTP response with one native PUT. `--lose-metrics-response-once` enables the browser recovery fixture; no real API credentials are loaded.
- Aggregate/UI validation suite: **9 passed**, including rejection of corrupt metric projections while accepting measured zero and unchanged imported outliers.
- TypeScript build checking and focused lint of the context validation module passed. The lead agent owns final integrated UI checks, browser evidence and deployment.

These checks verify actual persistence and edge handling in isolated fixtures. They do not establish TrainingPeaks numerical identity or a pixel-similarity percentage.
