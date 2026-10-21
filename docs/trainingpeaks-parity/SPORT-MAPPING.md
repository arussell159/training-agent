# Workout sport mapping — 2026-10-20

## Source and meaning

The lead agent observed the signed-in TrainingPeaks chooser; this backend task did not navigate that browser. Provider identifiers below were checked against the current public [Intervals.icu OpenAPI schema](https://intervals.icu/api/v1/docs), specifically `components.schemas.SportInfo.properties.type.enum` and the event category enums. Native text and provider readback use the [official planned-workout upload contract](https://forum.intervals.icu/t/uploading-planned-workouts-to-intervals-icu/63624).

TrainingPeaks labels and provider identifiers are different interfaces. The mapping must be explicit; identifiers such as `CrossTraining`, `MountainBike`, and `NordicSkiing` are not present in the current provider enum and are rejected before a provider request.

| Reference label | Provider/model value | Default structured target | Scope |
| --- | --- | --- | --- |
| Run | `Run` | Existing absolute running pace | Supported |
| Bike | `Ride` | Existing absolute cycling power | Supported |
| Swim | `Swim` | Existing swim pace and pool convention | Supported |
| Strength | `WeightTraining` | None | Supported duration/distance and interval session; exercise-library strength programming is separate |
| Walk | `Walk` | None | Supported |
| Mtn Bike | `MountainBikeRide` | Existing absolute cycling power | Added; distinct provider identity retained |
| Rowing | `Rowing` | None | Added; no cycling target or threshold invented |
| XC-Ski | `NordicSki` | None | Added; no cycling target or threshold invented |
| Crosstrain | `Workout` | None | Explicit generic cross-training mapping; does not claim a dedicated `CrossTraining` enum or map to `Crossfit` |
| Other | `Other` | None | Supported |
| Brick | `Other` + private `variant: "brick"` | None | Exact app presentation retained; native mixed-leg execution semantics are unavailable and not invented |
| Day off | `Other` + private `variant: "day-off"` | None | Title-only freeform plan supported; provider remains WORKOUT, with no native REST category or promised scheduling enforcement |
| Custom | `Other` + private `variant: "custom"` | None | Exact app presentation retained; provider sees generic Other, never an invented Custom type |

Existing `VirtualRide`, `VirtualRun`, and `TrailRun` models remain supported. The shared `workoutSports` list governs draft creation and model validation, preventing mismatched whitelists.

Simple sessions with positive duration/distance use an untargeted native step. Blank plans use explicit `unstructured: true` with no steps, no device definition heading, and null summary duration/distance. A user may explicitly add a supported structured target; the absence of a target does not imply zero watts or an invented pace. See [freeform contract and limits](UNSTRUCTURED.md).

## Threshold safety

Exact provider sport settings take priority. Cycling variants may fall back to cycling settings, and run/swim variants to their respective families. Other sports no longer borrow cycling FTP or cycling zones when their settings are missing. Missing settings yield null thresholds and no fabricated zone choices. Exact rowing pace zones display `/500 m`; exact Nordic skiing pace zones display `/km`.

## Preservation across surfaces

Creation and editing write the canonical model sport to `event.type` and verify the readback. Save/reload retains that sport, steps, and record identity. Library templates and scheduling retain the raw provider type. Calendar aggregation currently groups mountain biking with Bike for cycling totals/pairing; the embedded `editor_model.sport` preserves `MountainBikeRide` for the editor. Display labels should use this canonical model value where available rather than changing persisted type to match a label.

FIT downloads now use Garmin's installed official SDK enums: walking/generic, cycling/mountain, rowing/generic, crossCountrySkiing/generic, and training/cardioTraining. The earlier missing mappings could throw a TypeError for Walk and newly supported sports. Independent decoding now checks the resulting sport/subsport, open target, duration, step count and FIT integrity. Generic cardio export does not imply sport-specific device support.

Mountain-bike timed power prescriptions also use the existing cycling ZWO/MRC/ERG encoders. Non-cycling sports remain explicitly rejected by these cycling-only formats; FIT or Text retain their supported prescriptions.

## Verification evidence

- Four new canonical types each pass draft creation, provider save/readback, reload, editing, and a second reload with unchanged identity.
- Simple time-only sessions pass for ten calendar sports; the four additions also pass distance-only provider verification.
- Invalid reference labels and nonexistent identifiers fail before any provider call.
- Non-cycling zone tests independently assert no borrowed cycling settings and correctly calculated rowing/skiing pace labels.
- FIT regression independently decodes all five newly mapped sports including existing Walk.
- Provider double parses native instructions separately from production serialization; these tests verify the app/provider contract, not a live TrainingPeaks or device-delivery equivalence claim.
- Final complete backend run after sport and export regressions: **606 passed, zero failures** (`artifacts/backend-parity-sports-tests.log`). Backend Prettier and affected-file whitespace checks pass.

No live test workouts or production account settings were changed by this task.
