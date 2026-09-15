# Changelog

## Unreleased

### Changed

- Added a ChatGPT plan and custom-Action compatibility matrix.
- Documented successful end-to-end validation on Plus.
- Documented that a tested Free account could open the GPT but did not expose the Intervals.icu Action.
- Marked Go and managed-workspace compatibility as unverified.
- Added a safe Action-unavailable fallback that never asks for an athlete ID or API key.
- Incremented the production instruction revision to `1.0.3`.

## 0.9.0-rc1 — 2026-07-21

Release candidate for production OAuth and public repository upload.

### Changed

- Renamed the public project to **Open Triathlon Coach for ChatGPT**.
- Merged the tested threshold-pace and metric/imperial corrections into the OAuth schema and production instructions.
- Fixed all athlete-scoped endpoints to `/athlete/0`.
- Aligned every document to OAuth scope string `ACTIVITY:READ,WELLNESS:WRITE,CALENDAR:WRITE,LIBRARY:READ,SETTINGS:READ`.
- Replaced the outdated Pro-mode recommendation with the highest Action-compatible reasoning recommendation.
- Clarified the disabled GPT-level model-improvement setting without overriding user plan and Data Controls.
- Updated the landing page and privacy policy to the current brand and policy baseline.
- Added device-data dependency guidance for Garmin, Zwift, power meters, smart trainers, heart-rate sensors, and other sources.
- Added a public knowledge-base copyright and licence policy.
- Added builder setup, security guidance, acceptance tests, and automated consistency validation.

### Removed from the public pack

- Private Basic-auth DEV schemas and overrides.
- Personal athlete ID placeholders.
- Rigid universal CTL/TSB labels.
- Obsolete branding and earlier schema variants.
- Any credentials, personal athlete data, or private training recap.
