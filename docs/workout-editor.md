# Planned workout editor

Use the plus button on a calendar day to open a new workout draft for that date. Opening it does not create an event; Create Workout saves and verifies the new event. Click a planned workout profile, or choose **Edit Workout** from the ellipsis beside Close in the workout preview. Both open the same editor. The mobile workout page also supports profile clicks and its workout menu. Editing a structured planned workout's description opens this editor too.

The editor loads the current event from Intervals.icu, including ramps, ranges, repeat groups, units and cadence. The compact header places the workout name, duration and distance beside the block palette and saved blocks. Steps and repeat controls are edited directly in the central list. There is no separate properties sidebar, imported-instructions panel, role selector, target-type selector, pool-length input, export-details panel, or idle draft-status text.

Saving generates the readable instructions from the current structure, without an import acknowledgement. Existing coaching notes and recovered swim drill instructions remain in the model and generated outline. Unsupported steps and options still block overwrite. Source distance units are retained. Missing pool length defaults to 25 yards; existing explicit lengths remain intact. New pool work steps and imported pool work without an explicit lap setting default to lap-button ending while preserving planned distance; rests remain timed. Swim/run blocks default to pace and bike blocks to power.

## Editing

- Drag palette handles to an insertion gap; click a block to append. Use **Add step** within a card to insert after it. Drag step handles to move an interval or a complete group. Arrow buttons are equivalent move controls.
- Drag a chart bar's right edge to change its duration/distance; drag its body vertically to change a supported target. Numeric controls provide exact values. Time resizing snaps to five seconds.
- Use checkboxes or Shift-click for multi-selection, then duplicate, delete, group or bulk-edit. Grouping requires adjacent siblings. Ungrouping expands all executed repetitions, preserving recovery arithmetic.
- Blue repeat cards show only “Repeats [count] times” and the group actions above their intervals. Loaded sets appear as nested repeat cards. Existing recovery and final-recovery semantics are preserved. Add-step buttons belong to intervals, including recovery intervals, rather than the group.
- Units are fixed: run targets use min/mile, bike targets use watts, and swim targets use min/100y. Distance fields show miles or swim yards. There are no unit selectors or cadence-goal controls. Imported prescriptions retain their original values until edited; numeric fields convert compatible targets into the fixed units. Power percentages require a known FTP for absolute conversion. Existing cadence prescriptions remain intact when another field is edited, and pace export always includes a unit.
- Time fields display hh:mm:ss. Desktop input accepts compact HHMMSS digits: `0600` becomes `00:06:00`, `30` becomes `00:00:30`, and `10000` becomes `01:00:00`. Mobile opens scroll wheels for hours, minutes, and seconds; Done applies the selection and Cancel leaves the duration unchanged. Measure and target shape sit beside the step title. Training-zone dropdowns load the actual saved sport boundaries from Intervals.icu; closed zones fill editable numeric ranges, while open-ended zones retain native zone prescriptions without invented limits. The extra X beside the zone selector is removed; the step trash action remains. The provider defines [zone boundaries as percentages of threshold](https://forum.intervals.icu/t/server-side-data-model-for-scripts/25781).
- Preset and saved blocks show their actual miniature profiles without visible names. Saving a selected block requires no name. My blocks are scoped to the connection and stored in this browser. Insertions are deep copies with independent IDs. Drafts are also local and scoped to the connection/event. Undo/redo keeps up to 100 states.
- Ctrl/Command S saves, Z undoes, Shift Z redoes, D duplicates, G groups, A selects top-level steps, and Delete removes selection. Text inputs retain native editing shortcuts.

One shared canonical model drives the editor, totals, readable outline, export, and the saved workout's preview. Clicking a chart interval selects its whole repeat group and scrolls the editor list to that card, keeping the dialog header and footer fixed. Repeat counts are centered. Hover and selection highlight the whole group. Chart ticks use ordinary HTML text to avoid SVG font stretching. Time charts show only quarter-hour timestamps (0:15, 0:30, 0:45, 1:00, 1:15). Distance-only charts retain explicit distance tick units. The visible chart title, axis description, and gesture instructions are removed. Mixed distance workouts with no convertible pace show a disclosed 60-second chart placeholder for unknown durations; those placeholders do not inflate totals. Open steps never produce a falsely exact total. The power-load estimate integrates squared relative power, including ramps; it is explicitly not normalized-power TSS.

## Persistence and safety

`GET /api/workouts/event:<id>/editor` reads a fresh event, revision, and a projection of the athlete’s sport-zone settings. Failed zone lookup leaves manual editing available and reports that zones could not load. `PUT` validates the draft, freshly reads the event again, rejects stale revisions, and sends only `name`, `type`, and native structured `description` to the existing event endpoint. An explicit date edit also patches start/end dates while preserving time and span. Existing-event updates never create another event or send `workout_doc` as a writable field. New workouts use a separate POST endpoint with a stable operation ID, native structured description, and a provider readback. An uncertain create locks the draft for reconciliation; retries read the same operation rather than creating a duplicate. No activity mutation endpoint is called.

Native text follows the [Intervals.icu workout builder format](https://forum.intervals.icu/t/workout-builder/1163), with [explicit absolute pace units](https://forum.intervals.icu/t/specify-workouts-using-absolute-pace/115846). Updates use the [documented event PUT and GET endpoints](https://forum.intervals.icu/t/api-access-to-intervals-icu/609).

Readable instructions and lossless editor data are stored in fenced sections of the description, separate from the native device definition. This preserves grouping, labels, notes and final-recovery choices even when a nested group must expand into equivalent native steps. They are hidden from the app's readable workout description. The provider parser's returned steps are independently checked for executed count, target type/value/units/ramp, end condition, cadence, role, duration/distance totals and preserved event metadata. Text equality alone is not success. A later reload checks that the native text and editor data still agree.

Uncertain writes are resolved with a read before any retry, always against the same event ID. Permission errors, newer remote edits and verification failures retain the draft. Verified events refresh the preview, calendar cache and coaching context. Previously saved planned-workout recommendations are not reused after a newer workout edit. If the remote save succeeds but the durable local refresh fails, the response explicitly reports the pending refresh.

Intervals.icu documents no atomic conditional event PUT/ETag. Fresh revision checks and per-event process serialization detect existing conflicts, but cannot eliminate another service changing the event in the narrow interval between the final GET and PUT.

## Export limits

- Nested repeats and omitted final recoveries may expand to equivalent executed steps. Their original editor grouping remains in the stored canonical model.
- Stroke/drill/equipment details and custom step labels remain in readable instructions; device-specific drill fields and step prompts are not guaranteed. “Other” maps to the device's Active role.
- Lap-button steps export `Press lap` with their planned time or distance. Intervals.icu documents the [lap option alongside distance prescriptions](https://forum.intervals.icu/t/distanced-based-workouts-supported/9973); actual device behavior depends on the integration/device.
- Saved blocks and drafts do not synchronize across devices.

## Verification

Run `npm test` for all backend tests, then `npm run build`.

The isolated API uses port 4185, separate from the running app. The isolated browser harness uses the real editor and backend save service with an independent, deliberately limited provider parser double. It never reads credentials or contacts a live account:

```powershell
node tools/workout-editor-preview.mjs
# In a second terminal:
cd ui
npx vite --config tests/workout-editor.vite.config.ts
```

Open `http://127.0.0.1:5175/tests/workout-editor.html`.

Verified in the browser on 2026-09-16:

- Bike load/edit/save/reload, repeat count and omitted final recovery, whole-group reorder, palette insertion between steps, horizontal duration resize, vertical intensity change, and undo.
- Failed save with retained draft and successful retry.
- Run pace range edits and display conversion from min/mile to min/km while retaining the original prescription through save/reload.
- A 390×844 mobile swim workflow with changed yard distance, drill instructions, timed rest, and accessible save controls.
- Mobile multi-selection, bulk duration edits with immediate totals, and the keep-editing/discard guard.
- Configured bike/swim/run zone autofill; hh:mm:ss duration and repeat changes through save/reload; quarter-hour ticks beyond one hour; unnamed saved-profile reuse; interval insertion inside a repeat; and mobile blue repeat cards.
- The simplified central step cards, compact header, profile-click entry, save without an import checkbox, and mobile swim lap/distance/rest save-and-reload cycle.

These are isolated round trips, not live event-write verification. The live conversion-only FIT endpoint returned HTTP 500 for all three test sports; no live calendar event was modified. Physical touch-device behavior and Garmin/other device delivery have not been verified. Pointer and touch sensors, touch-action handling, and numeric/move-button alternatives are implemented.


Release checks also cover: a 180-second main interval versus a 180-second aggregate repeat made of 30-second leaves; calendar-day draft creation; one verified POST; uncertain-create reconciliation; and editing the created event.

Browser verification on 2026-09-17 covered all three compact duration examples, the mobile wheel's scroll and keyboard selection, Done/Cancel, and verified fixture save/readback. All three sports show their fixed target units without unit selectors or the zone X. Automated tests cover absolute and threshold-based target conversion, native open-zone preservation, and compact duration save/reload.
