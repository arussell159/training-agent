# Save to Workout Library browser acceptance

The new workflow copies the last committed workout into an explicitly selected native workout-library folder. It must not save, consume or silently replace the source editor's unsaved draft. The reference observation supporting this distinction is recorded in the final Save to Workout Library section of `REFERENCE.md`.

`tools/trainingpeaks-workout-template-check.mjs` passed all 15 groups twice against frozen build 75053/backend 881 (index SHA256 `AB25480CAEDACE4A41453522E4F36C6150CDCD9E58634C340A742DB9F39319B9`). Final evidence, executed harness, hashes, actual HTTP readbacks, provider-write ledger, screenshot and strict network results are in `artifacts/frozen75053-browser-verification/template`. Both runs verified exact synthetic cleanup. These are bounded local functional checks, not certification of TrainingPeaks numerical or pixel parity.

Build 83370/backend 881 previously passed the first four groups, then exposed a real runtime crash after successful Add: an undetailed `training-context-updated` event made the calendar merge read `undefined.context_scope`, replacing the source editor with the error fallback. Native template creation and exact synthetic cleanup were independently verified, but dirty-source retention failed. Evidence remains in `artifacts/frozen83370-template-add-context-event-crash`. Build 75053 fixes the publisher using library-only invalidation; the passing suite now verifies the editor and its unsaved instructions remain intact.

Three first-run harness findings are separately preserved: the intentionally pulsing Add Block needs a real center-pointer action; Playwright's native-option `isDisabled()` returned false despite the actual option's disabled attribute and native property being true; and undated library DTOs intentionally normalize editable-model dates to `2000-01-01`. The backend independently confirmed that the encrypted committed model retains its original source date while the public library projection uses that sentinel. The runner corrects only those platform/DTO expectations, retains exact prescription checks, verifies the source date is unchanged and requires scheduled copies to adopt their requested destination dates.

The runner uses actual Strength creation, subtype/time/planned controls, native folder selection and Add. Independent readbacks compare the committed private prescription and human native description with the new template, then schedule a separate calendar copy through the real HTTP scheduling service. This does not certify the scheduling UI. The template and source retain independent identities, with no copied comments, activity pairing, attachments or private model JSON in the native description.

Verified checks include:

- Ordinary workout Save creates no workout-library record or native library write.
- Save to Workout Library is unavailable on an unsaved new workout; menu Escape and dialog Cancel preserve the editor and make no write.
- The folder list is real, required, account-bound and independently verified; empty title, unavailable/read-only folder and stale permissions cannot write.
- Add uses the source's committed revision while an unsaved instruction change remains visible and dirty in the editor.
- Subtype, explicit/cleared time assignment, exact exercise/set values and manual planned values survive private template hydration and a scheduled independent copy.
- Held Add locks dialog and source actions; repeat activation cannot dispatch a second operation.
- Definite rejection permits explicit correction/retry; unresolved outcomes retain immutable source, revision, title, folder, account and operation identity.
- A lost reply followed by a fresh session recovers the same operation with `reconcileOnly`, never another first-write POST.
- Wrong successful response identity, account changes and source/folder conflicts preserve the appropriate retained draft or pending recovery rather than broadening or duplicating the action.
- Verified changed/deleted/rejected outcomes can only clear recovery through the explicit acknowledgement/review actions; inspection itself is read-only.
- Exact created-template/calendar/exercise cleanup, provider-write accounting, runtime/network checks and frozen artifact hashes are mandatory.

The runner will not create placeholder folders, rewrite a native provider inventory to fake success, infer that a successful ordinary Save added a template, or treat the private exercise catalog as the workout-template library. Any missing real preview hook or unsupported UI lifecycle will be recorded explicitly instead of being represented as a passing test.

An initial build-75053 run reached 13 groups before a harness expectation failed: an Add intercepted before the service registers an operation cannot later return a bound `unconfirmed` receipt. The existing independent service test and implementation require `404 TEMPLATE_OPERATION_NOT_FOUND` for that unknown operation. The corrected oracle verifies this exact response, retained pending identity, disabled Add/Cancel, absence of acknowledgement controls and zero native first writes during recheck. Evidence is preserved in `artifacts/frozen75053-template-unknown-operation-oracle-failure`.

That same initial run recorded one aborted HTML-startup `training-updates` fetch during the explicit reload phase. The two passing runs added phase/timestamp/navigation evidence and retained the strict cancellation gate; neither reproduced it. The initial cancellation's precise cause remains unproven, and no cancellation allowlist was added. Template cleanup uses the strictly created-ID-only synthetic hook because a local template-delete UI is not implemented. Native-provider behavior, full live account operation, and a 1% image-difference target remain unverified by this suite.
