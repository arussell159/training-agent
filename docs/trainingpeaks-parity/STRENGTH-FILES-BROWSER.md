# Strength device-file browser acceptance

`tools/trainingpeaks-strength-files-check.mjs` passes 10 groups on frozen build 40937, backend gate 850, index SHA-256 `5a88fd076860a2d424d2022336f081be3a5d13cc5cdb19954d1f9d487b7aaead`. Evidence is preserved under `artifacts/frozen40937-browser-verification/files`.

That first pass covered functionality, not dialog geometry. An additional actual-open measurement on the same build reproduced a styling defect: concatenated class names prevented the scoped upload CSS from applying, leaving computed max-width 384 px, radius 14 px, padding 16 px and the generic ring instead of the required 640 px / 8 px / 24 px / dedicated shadow. The strict geometry failure and screenshots are preserved in `artifacts/frozen40937-files-upload-visual-failure`. The runner now measures settled dialog geometry after disabling entrance animations and keeps those assertions for the next fix build. The original functional pass does not certify visual parity.

The repaired dialog passes 11 groups on frozen build 83370/backend 881 (index SHA-256 `375ea55f585d6a3929b10801452857e47db5502b9be0288ffb5e162c18cdf1a5`). The added group verifies settled 640 px width, viewport limit, 8 px radius and the recorded 24 px / 48 px shadow; the original ten functional groups still pass. Actual-open screenshots, computed geometry and raw workflow evidence are preserved in `artifacts/frozen83370-browser-verification/files`. This checks those specific properties, not whole-image pixel parity.

The affected recheck also passes all 11 groups on frozen build 75053/backend 881 (index `AB25480CAEDACE4A41453522E4F36C6150CDCD9E58634C340A742DB9F39319B9`), with exact cleanup and unchanged strict runtime/network gates. Evidence is in `artifacts/frozen75053-browser-verification/files`.

Run only against a fresh isolated synthetic localhost preview:

```powershell
node tools/desktop-preview.mjs --calendar-edits --port=5213
$env:APP_TEST_ORIGIN='http://127.0.0.1:5213'
node tools/trainingpeaks-strength-files-check.mjs
```

The actual UI checks new/pending-save Files availability, saved direct-page identity, the accessible Upload Device File dialog, empty Cancel, unsupported extensions and oversized files, native Browse, single-file drop, rejection of multiple dropped files, and held-upload locking. Escape, Ctrl+S and additional actions cannot dismiss the pending upload or mutate its parent workout. Explicit retries after 400/403/503 preserve exactly the original file bytes and saved workout ID. Malformed successful responses with an empty activity list or wrong linked ID cannot show verified success.

Upload HTTP is explicitly intercepted and passed through the real production `uploadWorkoutRecording` service with a declared synthetic provider oracle. That oracle independently checks the actual multipart file bytes/name, SHA-256 external ID, paired event ID and subsequent readback. A second upload of the same file follows the real service's existing-pair readback and makes no second synthetic native POST. A separate source-only oracle preflight also verified two attempts produced one synthetic multipart write.

This does not certify a live Intervals.icu upload or provider parsing of a watch file. The synthetic upload provider is separate from the disposable preview provider; the preview's native ledger must remain unchanged throughout intercepted upload checks. Only creation and confirmed deletion of the disposable Strength workout mutate that preview. Exact native baseline restoration and private 404 are checked after cleanup. Runtime/network failures and a changed frozen frontend hash fail the runner; only the deliberately injected, counted upload errors are exempted.

The successful browser run had no runtime errors or unexpected network failures. Existing backend multipart/readback tests provide additional service coverage; this bounded UI result does not establish pixel or whole-product parity.
