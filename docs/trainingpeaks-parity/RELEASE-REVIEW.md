# Integrated persistence review

This bounded review covers provider description containment, Event identity and recovery, Note routing, private workout metadata, and shared Generator/RPE guards. It does not certify complete TrainingPeaks parity or a production deployment.

## Corrected defects

- A replayed Event creation receipt previously returned verified success even when that Event had since changed. Replaying the original creation intent now reads the current native record and private entry, compares both against the original intent, and returns `409 EVENT_REPLAY_CHANGED` with a validated existing Event identity when they differ. It performs no duplicate create or overwrite. The client retains the immutable creation identity and draft, and offers an explicit current-record reload before a revisioned update.
- Editing Event prose externally previously discarded its exact private Event type and goals. Fresh native prose now wins while compatible native sport preserves those private fields. The full revision changes, so an older draft conflicts. An incompatible external native sport makes the record read-only until reconciled.
- Generic Note routes previously accepted app Events represented by native NOTE records. They now reject both marked Events and private-indexed legacy Events, including a durable pending Event before index completion. Ordinary native Notes and existing provider permission checks remain supported.
- A rejected provider write followed by metadata cleanup failure could replace the old private workout model and hide the original provider rejection. Prepared metadata now has a separate pending intent and cannot replace the committed pointer before successful provider acknowledgement or independently verified recovery. Definitive provider errors retain their original status/code even if cleanup fails. A new read retains the old committed model after a rejected same-native-body variant change or a rejected prose/model change.
- The shared editor input adapter now clones and preserves typed numeric RPE targets rather than converting them through unrelated sport thresholds. Generator result validation also binds executed step endings and active target kind, unit, and single/range mode to the attempted options, in addition to model validity and date/sport/variant identity.

## Workout metadata commit and recovery

Private editor envelopes remain in the existing encrypted, account-scoped backend store. The native request contains cleaned human prose and supported native workout syntax only. No storage failure falls back to putting private JSON into Intervals.icu descriptions.

The existing `entries[identity][nativeDescriptionHash] = privateTextDigest` format remains the committed pointer. Legacy pointers require no migration or new intent record. New saves first persist immutable private text and an immutable cleaned native intent, then place a bounded prepared entry in the separate pending index. A successful provider response commits the pointer. A definite rejection only attempts pending cleanup and always rethrows the provider rejection.

An independent native read may reconcile an ambiguous create only through its stable new external identity (or the existing library source tag) and exact intended native fields. An ambiguous existing-record edit additionally requires observed native change and matching intended native fields. An unchanged native body cannot prove a private-only edit committed: it retains the previous committed metadata and requires a later explicit confirmed save. Multiple matching pending intents fail explicitly. Pending intent and index shapes, hashes and sizes are validated before use.

The provider and encrypted store do not share an atomic transaction or provider-side compare-and-swap. Independent field readback proves the observed state, not exclusive authorship of every provider change. If an uncertain no-op native write changed a provider revision, the user may need to reload before retrying. Credential rotation still creates an isolated metadata connection rather than automatically migrating old sidecars. These limits remain open lifecycle constraints; there is no promise of external atomicity.

## Verification checkpoint

- Entire backend suite: **715 passed, zero failures** (`artifacts/backend-parity-release-review-tests.log`).
- Registered UI suite: **506 passed, zero failures** (`artifacts/ui-parity-release-review-tests.log`).
- Backend formatter check passed. Server and both desktop preview modules passed syntax checks. Git whitespace validation passed.
- Meaningful regressions cover stale Event receipt replay after native and private edits, external prose preservation and revision conflict, native sport incompatibility, rich Event rejection by generic Note routes, failed cleanup after provider rejection, later fresh reads, ambiguous changed-native recovery, legacy committed metadata, RPE clone immutability, and Generator option mismatch rejection.
- Tests use synthetic records, mocked HTTP/encrypted storage, and independent raw native reads. This review performed no real provider/account writes, deployment, commit, push, or settings change.

Final integrated TypeScript, lint, build, browser workflow gates, measured visual comparisons, and production promotion remain lead-owned release gates. The broader chart library, supported native/provider differences and unverified reference states remain tracked separately.

## Production dependency audit, 2026-10-21

Read-only `npm audit --omit=dev --json` completed successfully for the root and UI lockfiles: both report zero known advisories at this checkpoint. Ignored raw results are `artifacts/trainingpeaks-parity/npm-audit-production-{root,ui}.json`. This is the registry's current known-advisory result, not a general security, commercial-readiness or parity certificate. No package upgrade or audit-fix command ran.
