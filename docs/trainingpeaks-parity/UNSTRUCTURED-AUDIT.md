# Title-only workouts and interval-builder boundary

The reference inspection confirmed a Run and Day off can save with a title and no duration, distance or description. The saved entry reopens with those totals empty. This slice implements that observed behavior without fabricating an interval or zero-valued prescription. AR branding and navigation remain intact.

## Canonical model and presentation

The shared model uses `unstructured:true` only with an empty `steps` list. Simple creation selects this form when duration and distance are absent. Positive manually entered totals remain independent of the prescription. Native human descriptions are exactly empty when the user left Description empty; serialized editor models, planned totals and private variant data stay out of the provider description.

Brick, Day off and Custom retain explicit private variants on native `Other` workouts. Their identity is independent of the title and survives reload. Deliberately choosing a normal sport removes the variant. Create/details/editor planned-value adapters use the presentation sport for visible fields and units while the interval model retains its native provider sport. Brick's completed-only Elevation Loss cannot be edited as a planned value. The equipment component receives the presentation sport for its independent Brick bike/shoe controls.

Opening Build Workout removes the unstructured exemption from the builder copy. The original saved model is not mutated. An empty builder remains invalid and cannot save or export; adding a real block creates a structured prescription. Title-only saved workouts expose Text export; device formats remain disabled until intervals exist. The calendar and detail views render no invented interval profile for the empty prescription.

## Save lifecycle

Both creation and existing details keep Save & Close visible until the actual provider and description writes resolve. Busy dismissal and duplicate writes are blocked. A definite failure leaves the popup, edited title/values/description and error available for correction or retry. A description-only save does not require a duration or create a planned-values mutation. Existing pending-create identity and reconciliation behavior remain intact.

## Verification and limits

Six independent UI regressions cover the canonical builder boundary, immutable empty-description pending recovery, delayed provider/description saves, duplicate/busy protection, retained drafts on each write failure and description-only saves. Existing creation and sport/unit suites also pass. The new suite is part of `npm run test:ui`.

`tools/trainingpeaks-unstructured-check.mjs` is a localhost-only disposable-provider browser runner. It checks actual rejected and delayed creation/details saves, native empty-description bodies, authoritative editor readback, full reload, Text download, disabled no-step device exports, invalid empty builder then real block conversion, Day off identity and deletion of its owned records. An unchanged existing empty builder may close without saving; the runner verifies it performs no provider write and preserves the original freeform prescription.

The first browser pass caught a real stale Text-export title after a metadata rename. The failure is retained in `artifacts/unstructured-stale-export-failure.log`. Saved calendar popups now export by authoritative server ID instead of passing a potentially stale compact model; the backend compact projection also refreshes provider-owned name/date/sport. The backend adds independent rename/move/editor/export coverage. All eight browser groups passed with zero runtime errors after the final integrated cancellation/export fixes build (`artifacts/unstructured-final-browser.log` and `artifacts/trainingpeaks-unstructured/results.json`). Owned synthetic records were removed and the preview stopped.

These checks do not establish numerical TrainingPeaks visual parity, unobserved native Brick/Custom sport semantics or complete device behavior.
