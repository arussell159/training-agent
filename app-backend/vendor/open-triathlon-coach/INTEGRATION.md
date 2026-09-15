# Application integration

Upstream: https://github.com/Takethis88/Open-Triathlon-Coach-for-ChatGPT
Pinned commit: eee623bc79a158a50405adb0195aa7afb52f4da6
Original files and MIT attribution are retained. `API instructions.md` is loaded unchanged.
The downloaded repository's nested git metadata is omitted.

This is an API-runtime adaptation, not the hosted custom GPT. The public repository's
knowledge manifest is empty. Private GPT Knowledge files and its ChatGPT model/session
configuration are not available from this repository.

`lib/triathlon-coach-adapter.mjs` derives all 22 tool definitions from the original
OpenAPI Action schema. Platform-specific transport claims are overridden separately
for this application's TrainingPeaks connection. Legacy prompt instructions, fixed
eight-day context injection and cross-conversation memory are bypassed in coach chat.
Daily reviews load the same upstream policy and retain advisory-only delivery.

| Operation | TrainingPeaks mapping |
| --- | --- |
| getAthlete / getAthleteProfile | Existing athlete profile, goals and recorded comments; settings provenance disclosed |
| listSportSettings / getSportSettings | Existing recorded zones/thresholds; missing fields unavailable |
| listActivities / listEvents | Athlete-scoped fitness/v6 workouts for requested dates |
| getActivity / getEvent | Athlete-scoped fitness/v6 workout detail |
| getActivityIntervals | Source workout detail and planned structure; recorded interval telemetry not invented |
| listWellness / getWellnessForDate | Dated consolidated metrics and performance reporting, with model constants disclosed |
| listWorkouts | Existing locally saved library, identified as local |
| createEvent | Planned swim/bike/run payload preview; seconds converted to decimal hours; execution not enabled |
| listFolders | Unavailable; no verified library-folder endpoint |
| getTrainingPlan | Unavailable; no verified assigned-plan endpoint |
| getPowerCurves / getPaceCurves / getHRCurves / getPowerHRCurve | Unavailable; summary metrics are not time-series curves |
| listRoutes / getWeatherForecast | Unavailable; no verified equivalent in current connection |
| updateWellness | Unavailable; no verified wellness-write endpoint |

No new athlete facts, thresholds, constraints, sensor readings or health observations
were created. Added metadata describes source units, provenance and unavailable
capabilities. Stored profile values remain existing application values, not a claim
that they were newly verified by TrainingPeaks. A creation preview is a draft, not a
change to the athlete's calendar. Imported Intervals.icu workout text is a description,
not a validated TrainingPeaks structured workout.

Verification uses mocked model calls and does not send private athlete data or modify
TrainingPeaks workouts. Outstanding capabilities require verified provider endpoints
and a confirmation/verification path before they can be enabled.
