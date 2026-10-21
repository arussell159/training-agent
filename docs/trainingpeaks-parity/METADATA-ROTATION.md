# Private workout metadata and credential rotation

Read-only design audit updated2026-10-21 after explicit workout-template
integration. No migration is implemented or certified. This audit changed only
this document: no settings, credentials, database rows, provider records or
runtime source were changed. The latest completed backend checkpoint is881;
the older760-test checkpoint below records the original protective-guard work.

The smallest safe next slice is a **verified private-storage binding**, retaining
the original storage identity across same-athlete credential refresh. Bulk
copying/relabeling every legacy encrypted row is neither necessary nor safely
enumerable with the current indexes. Keep credential fingerprints for transport
and cache isolation; introduce a separate server-resolved private storage token.
Do not simply remove the API-key hash from `providerConnection`.

The current provider sidecar namespace hashes `SETTINGS_SCOPE` and the Intervals.icu personal API key. Replacing that key creates a new namespace even when it authorizes the same athlete. Exact editor grouping, Strength structure and exercise-library links, variants, comments and manual fields remain in the old encrypted records; clean human provider descriptions deliberately do not contain a recovery JSON copy. Related personal attachments, calendar Metrics/annotations/Events, transfer/creation receipts and archive/cache identities also depend on the existing provider connection fingerprint. No complete migration is implemented or certified.

An independent synthetic same-native-record experiment reproduced a concrete defect: the original namespace restored Strength, while a fresh namespace returned a valid unstructured model with no issues even though the readable Strength prescription remained native. This could allow a later save to replace typed exercise structure. The guard now recognizes the reserved readable Strength prescription marker when no private model is available. Import returns a blocking issue and `reviewRequired:true`, with no unstructured flag; readable prose remains visible. A typed replacement or freeform editor save performs no provider mutation. Ordinary native freeform Strength notes without the reserved marker remain supported.

The generic description editor had a related preservation hole: it retained endurance/unstructured suffixes but could remove a Strength prescription. It now serializes a changed manual introduction alongside the exact stored Strength model. An introduction may be edited or cleared while workout instructions, exercises, sets, parameter identities, private fields and human native prescription remain intact. Missing/damaged private Strength data blocks description updates before PUT with `PRIVATE_WORKOUT_MODEL_UNAVAILABLE`; unconfirmed readback is not reported as success. This is a protective guard, not credential migration.

The configuration POST currently reads bootstrap configuration, validates the submitted key with the native athlete endpoint, saves settings and invalidates memory/file context. It does not compare old/new athlete identity, read the full prior credential configuration for migration, or rebind private namespaces. Bootstrap configuration can omit the old stored API key or contain an older environment value; `settingsService.read` gives stored application keys precedence. A safe follow-up must retain the full prior configuration and trusted authenticated actor before update, independently verify the new athlete, and resolve a persisted prior actor/athlete binding. Different athletes must remain isolated even if event IDs and visible descriptions coincide. Legacy metadata lacking actor binding cannot silently establish future multiuser ownership merely from a shared deployment origin or API-key hash.

A stable target key should bind trusted actor, configured origin, settings scope, provider and verified native athlete identity. Background sync needs a server-owned verified binding because it has no browser session actor. Same-athlete rotation may then copy validated immutable text records and committed index pointers through a resumable write-ahead migration journal, independently check readback, and acknowledge the credential/binding transition only after completion. Old namespaces must remain recoverable. Current target data and legacy exact models may conflict after independent manual edits; migration must validate/merge supported envelopes or require review rather than overwrite newer fields.

The preceding paragraph preserves the original physical-copy proposal for
history. That approach is superseded for ordinary API-key refresh by the
source-grounded storage-binding design below: current personal/draft/operation
records are not all enumerably indexed, and their authenticated ciphertext
cannot merely be relabeled. Physical re-encryption remains a separate possible
encryption/project migration, requiring its own complete manifests and review.

Prepared metadata, rejected-write cleanup remnants, pending creation receipts and client recovery keys cannot simply be promoted or reset during migration. They must retain their immutable original intent and at-most-once transport semantics; ambiguous outcomes require read-only reconciliation against the verified same athlete. An editor-only namespace rewrite would leave other sidecars and pending/recovery scopes behind, and is therefore an incomplete migration.

Encryption compatibility is separate from identity. The existing encrypted record store derives its AES key from explicit `SETTINGS_ENCRYPTION_KEY`, falling back to the Supabase secret. Rotating that fallback secret without a compatible old key makes existing records, including authentication, unreadable. A migration needs a stable explicit encryption key or controlled old-key read/new-key write verification; no plaintext fallback belongs in provider descriptions or public responses.

Required follow-up tests include same-athlete key rotation preserving every sidecar, different-athlete and different-actor isolation, revoked old credentials with a prior verified binding, incompatible/unbound legacy ownership, interrupted migration and idempotent resume, target conflicts, pending/rejected-write separation, stale client intents and background ownership, cache invalidation, and old/new encryption-key compatibility.

The protective guard and description preservation have independent regressions using the same unchanged synthetic native record with separate metadata stores. The full backend checkpoint passes760 tests (`artifacts/backend-parity-strength-private-model-guard-tests.log`), including the independently persisted custom library. No live credentials, provider records or database rows were changed by this audit.

## Current identities and consumers

Here `C = SHA256(SETTINGS_SCOPE + ':' + INTERVALS_API_KEY)`, from
`app-backend/lib/completed-workout-store.mjs:6`. An encrypted-record identity is
itself hashed inside `createEncryptedRecordStore`; table scope is
`<settingsScope>:<namespace>:SHA256(identity)`. Its AES-GCM AAD includes that exact
scope (`app-auth-store.mjs:43,57`). A ciphertext cannot be moved to a new scope
without decrypting and re-encrypting it.

| Data                                                                          | Current identity and source                                                                                                                                      | Refresh consequence                                                                                                                                           |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Editor models/manual/planned/comment envelopes                                | `workout-editor-data`, identity `C/<key>`; index, immutable `text:<digest>` and `intent:<digest>` (`provider-workout-metadata.mjs:359`)                          | Clean native instructions cannot reconstruct exact Strength/RPE/variant/grouping metadata.                                                                    |
| Personal fields, draft migration state, equipment, attachments and tombstones | `workout-personal`, identity `<requestHost>/C/<key>` in `server.mjs:1752`; keys `workout/<id>`, `equipment`, `attachment/<digest>` in `workout-personal.mjs:125` | Draft UUIDs, pending deletes, blob generations and `migratedTo/migrationTarget` must stay linked. There is no complete global workout/draft index.            |
| Metrics                                                                       | `calendar-wellness`, identity `C:<date                                                                                                                           | index>` (`calendar-wellness.mjs:540`)                                                                                                                         | Preserve entries, exact subjective scales/times, note, revision, receipts and pending native patch.                                                                 |
| Goals/Availability                                                            | `calendar-annotations`, identity `C:<index                                                                                                                       | entry:key>` (`calendar-annotations.mjs:693`)                                                                                                                  | Preserve entry IDs/revisions/span, index routing, expected native hash and pending/rejected operations.                                                             |
| Event details and creations                                                   | `race-event-details`, identity `C:<index                                                                                                                         | event:id                                                                                                                                                      | create:creationId>` (`race-event-details.mjs:364`)                                                                                                                  | Preserve private exact type/goals and indexed legacy NOTE routing; do not create replacement native Events. |
| Entry clipboard transfers                                                     | `calendar-entry-transfer`, identity `C:<operationId>` (`calendar-entry-transfer.mjs:147`)                                                                        | Keep immutable source/action/destination digest and attempted flag.                                                                                           |
| Workout/library/coach scheduling copies                                       | `calendar-copy`, identity `C/copy/<creationId>` (`calendar-workout-copy.mjs:25`)                                                                                 | Preserve prepared/attempted/rejected/verified claim and event ID; same UUID must never acquire a fresh POST opportunity.                                      |
| Recurrence                                                                    | `workout-recurrence`, identity `C` (`workout-recurrence.mjs:30`)                                                                                                 | Keep series and deterministic occurrence creation IDs and their separate copy claims.                                                                         |
| Mutation queue/direct write claims                                            | `mutation-queue`, identity `C`; legacy/archive `sync_state` IDs `mutation:v1:C:*`/`mutation:v2:C:*` (`mutation-queue.mjs:169`)                                   | Preserve leases, sequence, unknown/rejected states, hashes and receipts; never reimport an uncertain job as pending.                                          |
| Explicit workout-template snapshots                                           | `workout-templates`; account `S=H({actor:strengthLibraryAccount,provider:C})`; identity `S/H({accountScope:S,operationId})` (`workout-template.mjs:50,564`)      | Keep public scope, immutable input, private description, native operation marker and verified native ID together. Changing `S` also orphans browser recovery. |
| Recorded archives and fast views                                              | `sync_state` IDs `completed:v1:C:<id>:<kind>` and `view:v1:C:<startup                                                                                            | training>` (`completed-workout-store.mjs:15`, `fast-context.mjs:12`)                                                                                          | These backend archives are distinct from encrypted `app_settings` rows. Preserve original recordings; regenerate disposable projections under the verified binding. |
| OAuth and webhook state                                                       | `intervals-oauth`, identity `<origin>:C:<clientId>`; `intervals-webhook`, identity `C` (`server.mjs:344,375`)                                                    | Preserve same-athlete OAuth connection and inbox claims where compatible; API-key refresh is not permission to reconnect another client/athlete.              |
| Section11 export claim                                                        | `section11-export`, identity `C:<repo>@<branch>` (`server.mjs:632`)                                                                                              | Do not reset an in-flight external export lease or automatically repeat its effect.                                                                           |

The custom exercise library is **not API-key bound**:
`strengthLibraryAccount = H({origin,actor.id,SETTINGS_SCOPE})`
(`strength-exercise-library.mjs:27`). Leave its definitions, opaque IDs,
tombstones/receipts and `libraryExerciseId` links untouched for same-actor key
refresh. Do not incorrectly migrate it to a new athlete-specific namespace.
Auth, nutrition, reports and coach proposal stores have other existing
origin/repository identities; they are not credential-migration targets.

`performanceAccount` includes API key/OAuth fields (`performance-curves.mjs:75`),
and tag scope adds trusted actor/origin (`chart-tags.mjs:8`). Provider request
caches also use the current key digest (`server.mjs:294`). These should remain
credential-sensitive and invalidate/reload on refresh. They are not private
storage aliases. Public `trainingCacheScope()` currently comes from the context
`cache_scope`, falling back to `provider_connection` in fast projections. It
indexes local pending creation, clipboard, Metrics recovery and dashboard
preferences. A stable, verified same-owner cache scope is necessary to keep
those retained intents discoverable; do not rename or clear them speculatively.

## Exact settings cutover boundary

`server.mjs:1479–1513` implements authenticated `GET/POST /api/config` after
`handleAuth`. POST selects a string patch from stored settings plus Supabase
URL/secret, trims values, checks theme/layout, and then:

1. `current = await readBootstrapConfig()` (not full saved settings).
2. If a key was supplied, native GET `/athlete/0` using `{...current,...patch}`.
3. `writeConfig(patch)` calls `settingsService.save`.
4. On key patch, clear only `intervalsMemoryCache` and remove the local context
   file. No migration, same-athlete comparison, storage binding, mutation gate,
   authenticated actor capture or rotation receipt exists here.

`settings-store.mjs:190–272` reads the encrypted old settings, upserts a patch,
checks the returned decrypted values, and clears its caches even after failure.
That verifies a settings write, not an atomic transaction with sidecar binding.
Its lost-response error explicitly requires settings reload; the current config
route nevertheless reports400 for every caught error. A refresh implementation
must distinguish definite validation failure from uncertain committed settings.

The new hook must read full `readConfig()` **before** overwriting the key, fail
on `settingsError`, capture `req.appActor`, and compare independently verified
native athlete IDs. It must not use browser-supplied athlete/actor IDs as proof.
Do not combine API-key rotation with Supabase URL/secret/encryption/scope repair:
these change the database/decryption authority and need a separate controlled
procedure. Hosted bootstrap changes are already rejected by the settings store.

## Implementable minimal binding design

Use one encrypted CAS-controlled owner/active-provider binding and refresh journal
under a new namespace derived from the configured origin, settings scope and
trusted app owner. The schema should carry `version`, owner/actor hash, provider,
verified athlete identity, opaque `dataConnection`, stable public `cacheScope`,
credential fingerprint, revision and an optional immutable refresh operation.
Raw credentials are never returned or included in record IDs/logs.

Add these explicit interfaces rather than weakening `providerConnection`:

- `credentialFingerprint(config)` retains current-key cache/transport separation.
- `resolvePrivateProviderBinding(fullConfig, trustedActor|serverOwner)` returns a
  server-verified binding only when owner and credential fingerprint match an
  active or journaled verified transition. It supplies `privateDataConnection`
  and stable cache scope internally; API settings cannot set these fields.
- Every private factory in the table reads the resolved storage token. Existing
  legacy installations retain their original `C` as that token. Native IDs,
  snapshot descriptions, hashes, ciphertext scopes and pending bodies do not
  change. Template account `S` consequently stays exact. Archives/views use the
  storage token, while context credential provenance can remain separately
  checked and refreshed. Never use a client-selected alias or search another
  actor's namespace when a read misses.

This is an identity migration by verified binding, not a data-copy migration.
It avoids the non-enumerable personal/draft/blob/operation keys: their existing
identities remain addressable without scanning other users' rows. Adding only an
editor alias while leaving the other factories credential-bound is incomplete.

A concrete refresh input can extend the existing config POST with an explicit
`credentialRefresh:{operationId,expectedBindingRevision}` alongside the new API
key; keep it out of `STORED_SETTINGS`. The config GET should supply only an opaque
binding revision/status for concurrency. A separate operation-status GET accepts
the immutable operation ID; it never returns the candidate key. Ordinary theme
or layout updates remain unaffected. The browser retains the operation identity,
not the raw credential, before dispatch.

Refresh sequence:

1. Authenticate and require a writable trusted owner. Load full old config and
   current binding fresh. Enforce the expected binding revision/account before
   any settings write; reject mixed bootstrap changes.
2. Verify candidate key with native GET `/athlete/0`. Compare with the binding's
   verified athlete. A different athlete is an explicit new connection with a
   fresh data/cache namespace; it cannot inherit aliases or replay old pending
   intents. The old connection remains retained and recoverable.
3. CAS a write-ahead journal binding operation UUID, original revision and old/
   candidate fingerprints to the verified same athlete and existing storage
   token. Candidate material needed after lost replies is encrypted server-side.
   Preserve all pending data in place; do not resolve it by executing writes.
4. Verify every private factory supports the binding before enabling cutover.
   Block conflicting credential changes. New and old instances must not split
   into different claim stores; deployment must gate legacy writers before a
   mixed-version rollout can accept refreshes.
5. Save the new key, independently reload/decrypt the actual setting, then CAS
   the binding/journal to committed. Settings and journal are separate rows:
   a lost response is reconciled by the stored actual fingerprint plus journal,
   not by retrying an unconditional settings overwrite. Same operation is
   idempotent; changed payload/revision conflicts. If the actual setting is old,
   leave old binding active; if candidate, finish its verified transition; if a
   third fingerprint, retain conflict and do not overwrite it.
6. Return success only after settings and binding readback agree. Invalidate
   current-credential provider/performance/tag/hydration caches and rebuild
   disposable native projections. Preserve stable private/cache identities and
   browser recovery bodies. No automatic native mutation, recurrence execution,
   export, OAuth reconnection or outbound report is part of refresh.

Background work resolves the persisted verified owner/athlete binding; it must
not invent `currentActor` globally or accept an unauthenticated actor selector.
In-flight native operations already captured the old config. Keep their shared
claim namespace and require independent readback after a revoked-key error;
permission denial of a recheck is not proof the original mutation failed.

## Enrollment, rollback and explicit limits

An already-established verified binding allows a revoked old key to be replaced
after a new GET proves the same athlete. Without that binding, safely enrolling
legacy data requires proof of the configured old athlete and established app
owner. Old-key GET plus new-key GET can establish athlete equality, but a shared
deployment origin or matching numeric event IDs alone cannot prove legacy
multiuser ownership. An unbound/revoked-old-key or changed-auth-owner situation
must fail closed for alias adoption; preserve old data and offer recovery rather
than silently assigning it to the current actor. This is a concrete legacy
enrollment blocker, not a reason to erase or reinterpret Strength.

The configured request host currently participates in personal-field identities.
Changing deployment origin/hostname is a separate migration; the binding must
retain a verified canonical legacy personal host when adopting it. Do not accept
arbitrary Host/body aliases to locate private blobs. Changing settings scope,
Supabase project, actor identity, OAuth client, encryption material or provider
athlete is not an ordinary same-athlete key refresh.

No old encrypted records are deleted. Rollback selects a previously verified
credential through the same revisioned journal and data binding; it never blindly
restores a key whose permissions/athlete cannot be verified. If settings commit
was uncertain, inspect first. If encryption material changes, existing settings
and app-auth records may fail to decrypt before migration even starts: explicit
stable `SETTINGS_ENCRYPTION_KEY` or controlled old-key/new-key re-encryption is
required. The existing algorithms have different key domains for settings and
app records; copying ciphertext or resetting auth is not recovery.

## Required independent tests before implementation is called complete

1. Seed an actual encrypted-record adapter with all table namespaces, including
   unreachable-from-current-calendar draft IDs, attachment blobs/generations,
   template operation markers, old copy receipts and mutation archives. Same
   actor/athlete key A→B returns identical private state and IDs without any
   native write or ciphertext relocation. Exercise definitions and links remain.
2. Same IDs/description under a different actor or athlete never read old private
   state or dispatch a retained old intent. Candidate athlete IDs must come from
   mocked native responses, not request input. Missing/invalid binding and
   changed origin/scope are rejected before settings mutation.
3. Initial enrollment proves both valid configured-old and new credentials;
   revoked old succeeds only with prior verified owner/athlete binding. Unbound
   legacy ownership cannot silently be claimed by a new auth identity.
4. Inject lost responses before/after journal CAS, settings upsert/readback and
   final binding CAS. A fresh instance converges on the actual saved key and
   original storage token; same operation causes no second native mutation or
   overwrite of a competing credential C. Settings errors are not mislabeled as
   definite400 rejection after a possible commit.
5. Keep a template Add, calendar copy, annotation move, Metrics patch and direct
   edit uncertain while refreshing credentials. Rechecking exact original UUIDs
   resolves committed results with zero additional POST/PUT. Rejected and
   prepared metadata never become committed simply because visible text matches.
6. Browser scopes stay discoverable for same-owner refresh, including a retained
   global Strength create and `workout-template-pending:<S>`; fresh account
   switches do not adopt them. Account/operation proof still binds every response.
7. Background reconciliation and an already-running old-config request share
   the same durable claim but use their own captured credentials; no global actor
   or cross-tenant cache fallback. New provider reads use key B; old cache/tag
   scopes cannot satisfy new credential-bound requests.
8. Test encrypted record AAD/key compatibility independently. Changing a Supabase
   secret with a fixed explicit encryption key preserves reads; changing the
   fallback encryption material fails safely. No logs/public DTO/provider prose
   contains either key, plaintext private data or encrypted record contents.

No live provider reads were needed for this audit. These tests are a proposed
implementation acceptance plan; they have not been added or executed as a
credential-migration suite.

## Standalone binding/journal checkpoint (not runtime migration)

New standalone modules now implement the binding and refresh protocol:
`private-provider-binding-model.mjs`, `private-provider-binding.mjs` and its
declaration, `provider-credential-settings.mjs`, and
`private-provider-binding.test.mjs`. They are deliberately not imported by config
routes, existing storage factories, background workers or browser settings. The
current application still changes private scopes when its old factories receive
a different key. A regression explicitly demonstrates that remaining boundary;
this checkpoint does not certify migration completeness.

The exported factory is
`privateProviderBinding(config,trustedActor,{verifyAthlete,legacyAuthority,writerGate,fetchImpl})`.
It uses the existing encrypted/CAS app record adapter in a new namespace,
`private-provider-binding`, with identity
`<trusted origin>:intervals:private-provider-binding`. The owner hash is validated
inside that shared origin record so another actor cannot adopt it. Environment
identity includes scope, database and effective encryption material; changing a
service secret with an explicit stable encryption key remains compatible.

The service exposes:

- `enrollLegacy({expectedCredentialFingerprint})`: requires a saved encrypted
  credential row, verifies the configured old key's native athlete through the
  injected GET-only reader, and obtains a trusted server-owned attestation from
  `legacyAuthority`. The attestation must bind owner/environment/fingerprint/
  athlete plus an opaque evidence digest. It is not accepted in an HTTP body.
  Missing authority defaults to denial; matching IDs or deployment origin alone
  do not enroll anything. The original credential fingerprint becomes the
  storage/cache token, keeping legacy identities intact.
- `resolve()`: **internal server result**, containing verified owner/athlete,
  `privateDataConnection`, stable `cacheScope`, current DB credential fingerprint,
  binding revision and `writesAllowed`. It must not be serialized as a public
  API response. Writes are disallowed during an unresolved refresh and for a
  read-only actor. Its fresh fingerprint must be checked against the caller's
  captured transport config or the config must be reloaded before use.
- `refresh({operationId,expectedBindingRevision,candidateKey,reconcileOnly?})`:
  UUIDv4 and immutable expected revision, independently verified same athlete,
  explicit writer gate, write-ahead preparation/claim, settings CAS and separate
  readback, then binding receipt. Public success returns only operation ID,
  verified flag, provider, generation and opaque binding revision. It contains
  neither key, internal storage token nor native athlete ID. Different-athlete
  keys are rejected as a separate-connection operation. An unchanged key is a
  definite no-op validation result, with no provider or settings write.
- `inspect(operationId)`: public status
  `committed|rejected|settings-confirmed|unconfirmed|conflict`, a `current` flag and
  binding revision. A previously committed operation becomes `current:false`
  after a later successful refresh; it cannot overwrite that newer credential.
- `recheck(operationId)`: UUID-only recovery. The candidate key is recovered from
  the encrypted server journal, never retained/resubmitted by the browser. It
  cannot issue a settings replacement. It can finalize an already-installed
  candidate after a lost binding response; an old/unknown setting stays pending.

`writerGate` is a trusted server callback returning
`{legacyWritersBlocked:true,allPrivateFactoriesBound:true,revision:<64hex>}`.
Both flags and the revision are required and re-read immediately before a
prepared operation is claimed. Missing/failed/withdrawn gate disables refresh.
The callback is an integration prerequisite, not evidence that today's
unmodified factories meet it. No production caller currently supplies an
enabled gate. Likewise, the test ownership attestation is not a permissive
production enrollment fallback.

The dedicated credential settings adapter reads and PATCHes the existing
`INTERVALS_API_KEY` row using its exact ciphertext **and** timestamp as CAS
conditions. This prevents a third-key overwrite even when two writes share the
same timestamp. Encryption matches the existing settings store's domain, AAD
and format; the existing settings reader independently decrypts the new value in
tests. There is no upsert, table change or local-file/bootstrap fallback. It
requires an already-saved key and bounds keys to1–1024 characters. No provider
mutation is issued by these modules.

One additional integration requirement is now explicit: this safe CAS bypasses
`settingsService.save` and therefore bypasses its private ten-minute read-cache
invalidation. Config integration must provide an identity-safe invalidation/
fresh-read path after committed **or uncertain** replacement, and handle reads
already in flight. Reusing an old cached config after the DB key changes cannot
be treated as a freshly resolved binding. This standalone slice does not change
that shared cache or any factory.

The record has one active refresh and at most256 immutable terminal receipts;
new refreshes fail explicitly at the cap rather than pruning an operation's
identity. Candidate size, object keys, hash fields and receipt counts are
validated before fingerprinting/serialization of stored subdocuments. Unknown
fields and excessive/corrupt state fail closed. Definite settings rejection
remains authoritative if saving the rejection receipt fails; an ambiguous
attempt never gains another blind write opportunity. No old private row is
copied, renamed or removed.

The focused suite currently covers19 cases with mocked native GETs and a
functional encrypted REST/CAS database double. Evidence includes lost replies
at every journal boundary, independent settings readback, third-key/same-time
conflicts, revoked old key only after verified enrollment, concurrent same-UUID
instances, immutable/replayed operations, actor/environment isolation, fixed
versus fallback encryption keys, and sanitized dependency errors. Representative
opaque records in every encrypted namespace remain readable using the resolved
legacy token. An **actual calendar-copy service** creates an uncertain synthetic
native event, then reconciles its original durable claim after refresh with one
POST total. The actual custom exercise catalog retains its existing definition
ID and parameters. No live database/provider access occurred.

Acceptance cases1–8 above are therefore partly implemented at the standalone
boundary. Real factory wiring for every specific model/receipt/blob/archive,
config HTTP concurrency/cache invalidation, server-owned background resolution,
legacy-owner evidence policy, existing-writer rollout gating, browser retained
intent recovery and a live-read-only postdeployment audit remain required.
Neither the new tests nor an injected test gate establish those missing pieces.

Standalone verification checkpoint:19 focused tests pass, as does the complete
903-test backend suite (`artifacts/backend-private-provider-binding-standalone-tests.log`).
Owned-file formatting/diff checks pass. No shared build or runtime integration
was performed for this checkpoint.

## Integration authority audit (read-only, 2026-10-21)

This section records source evidence and integration requirements, not an
enabled enrollment policy. No configuration, auth record, storage factory,
deployment or provider record changed during this audit. The903-test checkpoint
above remains the last executed backend gate; documentation review does not add
test coverage.

### What the existing auth record actually proves

`createAuthStore` (`app-auth-store.mjs:7–23`) stores one encrypted `APP_AUTH`
record per configured origin. Its initial fields are a random43-character
`userID`, credentials, sessions, challenges and rate limits. The server verifies
a hashed session token, password epoch and expiry against that record on normal
API requests (`app-auth.mjs:102–109,175–183`), then assigns
`req.appActor = {id:state.userID,origin:config.origin,readOnly:false}`.
Password and passkey sessions at that origin share this same logical user ID;
there are no individual users, roles or separate persisted owner/member claims.
Password changes invalidate sessions through the epoch without changing userID.
Local bypass creates a synthetic actor and supplies no durable ownership proof.

The record therefore attests the **current authenticated shared app identity**.
It does not record which actor created legacy provider metadata, the native
athlete, a credential fingerprint, the original data connection, or a binding
between these values. Recreating the auth record creates a new userID. The
generic encrypted row timestamp identifies its latest mutation, not historical
ownership or an immutable enrollment event. Existing settings/private rows also
have no such ownership stamp. An actor-scoped exercise catalog or template
receipt can prove its own scoped object, but cannot attest ownership of every
older actorless sidecar or unknown pending operation.

Concrete enrollment decision: **the present APP_AUTH record alone is
insufficient for automatic `legacyAuthority` approval**. Keep unbound legacy
credential refresh disabled under the standalone service's existing deny
default. A server-owned attestation needs independently established authority
for this exact deployment/legacy connection and its current actor, plus a fresh
GET verification of the old configured athlete. A separately authorized,
audited one-time ownership claim could establish that new fact; it must be
identified as a claim and bound to actor/origin/scope/database/encryption/old
credential/athlete before CAS enrollment. It must not be inferred from a new
login, matching IDs, broad task permissions, a request-body owner flag or an
invented `APP_OWNER` environment fallback. No such attestation source or claim
flow currently exists. This is an essential integration blocker for automatic
adoption, not a reason to erase legacy records or disable ordinary current-key
use. Previously verified binding refresh can proceed without re-proving a
revoked old key, as already covered by standalone tests.

### Configuration authorization is authentication, not a separate owner role

`server.mjs:1005` invokes global auth before `/api/config`. Non-GET/HEAD calls
must carry the exact application Origin and a valid session. However,
`server.mjs:1486–1513` does not inspect `req.appActor`, `readOnly` or recent
authentication. Any normal authenticated session can currently write allowed
settings. All normal sessions happen to receive `readOnly:false`; this is not
an independent owner-only policy. A hypothetical injected read-only actor would
not be rejected by this route itself. Recent verification exists for passkey
changes (`app-auth.mjs:109,272,285`), not config POST. Hosted bootstrap changes
are separately rejected in `settingsService.save`; that is not user ownership
authorization. Do not label the present route owner-only.

Future refresh HTTP integration must explicitly require the trusted writable
actor and exact existing binding/attestation; no actor selection from HTTP.
It must intercept every `INTERVALS_API_KEY` change before ordinary settings
upsert and reject mixing credential refresh with database/scope/encryption
repair. Definite validation failures and ambiguous settings outcomes need
different status/recovery handling. A recent-authentication requirement would
be a new explicit security policy, not something already enforced by config.

### Complete storage and call-site integration checklist

Use a server-only resolved descriptor, passed explicitly with transport config;
do not overload API-key fields or silently change every `providerConnection()`
call. Preserve original legacy token C and all original UUIDs. The matrix above
describes identities; this is the concrete hook checklist:

| Hook                                                                                                                                 | Required binding behavior                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `intervalsWorkoutMetadata` in `provider-workout-metadata.mjs:359`, called by **every** `createIntervalsClient` in `intervals.mjs:53` | Resolve private storage before wrapper construction; cover direct native clients as well as cached `intervalsClient`. Preserve immutable text/intent and committed pointers.                                                                                                                                           |
| Personal service record closure, `server.mjs:1749–1752`                                                                              | Keep original host/C/workout-or-draft/blob keys; authorize with current transport. Include attachment reads/deletes, equipment, draft migration and pending deletions.                                                                                                                                                 |
| `calendarWellnessService`, `calendarAnnotationsService`, `raceEventDetailsService`                                                   | Stable index/date/entry/Event/create claims for reads, writes and all context hydration paths. Their `context.provider_connection/cache_scope` checks must compare the intended stable binding, not accidentally reject current transport.                                                                             |
| `calendarEntryTransferService`, `copyCalendarWorkout`, `createWorkoutRecurrenceStore`                                                | Stable transfer/copy/series stores and occurrence copy claims, including library and coach scheduling callers. Existing pending claims cannot acquire a new namespace or another native POST.                                                                                                                          |
| `createMutationQueue`, `createMutationProjection`, `providerWorkoutWrite`, `reconcileDirectWorkoutWrite`, `flushMutations`           | Stable queue/direct claims, legacy sync-state migration and projection identifiers. Reconciliation must use original claims with current verified transport and distinguish uncertain from rejected.                                                                                                                   |
| `workoutTemplateAccount` and `workoutTemplateService`                                                                                | Retain actor plus original provider token, operation scope, marker, private snapshot and browser pending key. Cover folders/save/inspect/list/detail/schedule, including verify-only schedule recovery.                                                                                                                |
| `createCompletedWorkoutStore`, `fastViewId`, `persistFastViews`, `createContextStore` snapshot consumers                             | Preserve archives and original fast-view identity; audit `loadSupabaseTrainingSnapshot`, `persistTrainingContext`, `saveVerifiedSnapshot`, `prepareFastView`, queue overlays, startup/history/update projections and all provider_connection comparisons. Separate stable cache scope from live credential provenance. |
| `webhookSync`, `scheduleTrainingReconciliation`, `intervalsOAuth`, `section11SyncService`                                            | Stable inbox/OAuth/export lease identities and verified server-owned owner resolution. No global current browser actor. API-key refresh does not change OAuth client, native athlete or repository authority.                                                                                                          |
| Editor create/save/note/copy scopes in `server.mjs:1731,1875,1965,2134`                                                              | Preserve serialization/creation UUID scopes and existing private metadata; a scope argument is not itself proof of a durable create claim.                                                                                                                                                                             |
| Credential-sensitive reads/caches                                                                                                    | Keep `performanceAccount`, `chartTagScope`, providerReads, activity downloads and transport request keys credential-sensitive. Resolve `cache_scope` separately for retained browser intents/preferences; do not reuse an old-key authenticated response as a new-key proof.                                           |

The custom exercise catalog (`strengthLibraryAccount`) already uses actor,
origin and settings scope without the provider key; retain its exact IDs and
history links. Auth, nutrition, report and coach-proposal records are not key
refresh targets. Review all direct factory callers/tests, not only route imports:
`createIntervalsClient` constructs metadata even for otherwise read-only work.

### Fresh settings and background resolution

`createSettingsService.read` (`settings-store.mjs:198–235`) caches settled reads
for600000ms, coalesces an in-flight read, and returns bootstrap plus a
`settingsError` on failure. Its only public methods are `read` and `save`;
there is **no** public invalidate/fresh-read method. `save` clears the cache
before and finally after its ordinary upsert. The new credential CAS adapter
does not call it. Clearing just local intervals files/memory at config POST is
insufficient, and clearing a Map in one Vercel instance cannot invalidate other
instances' ten-minute caches.

Minimal safe integration needs an explicit uncached `readFresh` path and an
identity-safe local invalidation/generation mechanism. After either confirmed or
uncertain replacement, discard this instance's old entry; a superseded in-flight
read must not become its current result. Other instances must use fresh settings
at binding-sensitive request/task admission (or compare against the fresh DB
credential adapter and reload config when fingerprints differ), not trust their
existing read cache. Do not change this to bootstrap fallback on DB failure.
If the DB has candidate B but a captured client uses A, rebuild that client or
fail explicitly before private reads/writes. A descriptor returned by `resolve`
does not mutate its caller's captured config.

Background entry points currently capture config: webhook reads it before auth
(`server.mjs:251–281`), OAuth callback reads it before normal auth
(`990–1002`), reconciliation closes over it in `waitUntil` (`351–370`), training
update/warm/queue work and Section11 export also retain it. These need a
server-owned resolver that reads an **already attested binding** for the exact
configured origin/environment. It can recover its owner from that binding;
it must not create/adopt one from the last request actor, a mutable global or
first request. Re-read the binding/fingerprint and write eligibility at task
admission and immediately before an external write/claim after a wait. Existing
same-identity reconcile-only outcomes remain readable; unresolved refresh must
not dispatch a new mutation under a mismatched captured credential.

### Vercel writer gate must have external enforcement

`vercel.json` specifies300-second Node and Python functions but no deployment
epoch fence. An enabled new-code callback cannot constrain an old deployment
that does not read it. Promotion alone is insufficient: immutable deployment
URLs, aliases, automation bypasses and pinned clients need inspection. Normal
auth rejects a host different from configured origin, but webhook and OAuth
callback run before that host/session check. Old code can also read the **new**
saved key from shared settings, so revoking key A alone does not stop it using B
with its old storage derivation.

Vercel documents that Standard Protection excludes production domains and that
legacy pre-production protection leaves past production URLs accessible. Its
Skew Protection can route pinned clients to prior deployments; a custom
threshold or deletion can exclude old deployments. `waitUntil` continues after
the response within the function's duration. These are platform capabilities,
not verified project settings in this audit. Sources:
[Deployment Protection](https://vercel.com/docs/deployment-protection),
[Skew Protection](https://vercel.com/docs/skew-protection),
[waitUntil lifetime](https://vercel.com/docs/functions/functions-api-reference/vercel-functions-package),
[deployment removal](https://vercel.com/docs/deployments/managing-deployments).

Implementable release sequence, still pending lead-owned execution:

1. Ship the fully bound code with credential refresh disabled. Inventory all
   deployed aliases/URLs, active rollout/rollback targets, worker endpoints,
   automation exceptions and any local/server processes sharing these settings.
   Current repo has no Vercel cron configuration; that does not prove no
   external scheduler. The separate Python Section11 worker authenticates with
   an HMAC and can outlive a browser; include it in drain checks. GitHub's
   manually dispatched push workflow uses its separate credential/authority;
   do not silently reconfigure it as part of app refresh.
2. Route production exclusively to the bound build, end any mixed rolling
   release, prevent pinned requests reaching earlier builds where applicable,
   and disable/remove every invocable incompatible deployment/worker. Merely
   protecting a URL behind credentials or an automation bypass is not proof
   that no old authorized writer can invoke it. Deletion/removal is a concrete
   option but loses instant rollback for that deployment; preserve a compatible
   rebuild/rollback plan. No deletion was performed here.
3. Prevent new incompatible invocations, then drain at least the actual maximum
   function lifetime (currently300 seconds) plus verified routing propagation;
   check logs/control-plane state. Do not assume deployment removal cancels
   already-running work. If any process cannot be fenced/drained, keep refresh
   disabled.
4. Persist a server-managed rollout attestation binding current build/deployment
   allowlist, completed factory audit, environment/binding and fencing evidence.
   `writerGate` must read this authoritative state and require the current
   deployment to be allowed; no client field or hardcoded true callback. Recheck
   immediately before prepared claim as the standalone service already does.
   Revoke the gate before any incompatible rollback or replacement. Long-term,
   an external centrally enforced write lease/proxy can replace one-time old
   deployment retirement only if **all** writers actually participate.

No live Vercel inventory/protection state was inspected or altered; these
conditions cannot presently be marked satisfied. Current standalone gate
injection tests prove protocol behavior, not platform fencing.

### Required integration regressions before enabling refresh

Add real middleware/config HTTP tests proving missing session/hostile Origin,
read-only actor, forged actor/owner, local bypass and unbound/recreated auth
record cannot enroll. Two sessions of the shared user must be recognized as the
same current actor without manufacturing historical ownership. If a one-time
claim policy is introduced, test exact scoped proof, concurrent claims,
athlete/key drift and revoked proof; default remains denial.

Exercise actual new config endpoint plus every factory row in the checklist:
warm old config in two independent settings-service instances, lose the CAS
reply, let an old read settle, then require fresh B transport and original
legacy stores/UUIDs. Include cross-actor/environment and third-key conflicts,
existing template/attachment/recurrence/direct-write receipt recovery, old
captured webhook/background config and explicit gate withdrawal/rollback.
Gate validation also needs lead-owned deployment inventory/pinned URL checks
and drain evidence; a mocked boolean alone cannot satisfy that release gate.
