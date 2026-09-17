# Application functionality

AR Performance is a training workspace connected to Intervals.icu. It displays training history, calendar workouts, recorded activity analysis, recovery metrics, annual plans, and connection settings.

## Pages

| Destination     | Behavior                                                                                                        |
| --------------- | --------------------------------------------------------------------------------------------------------------- |
| Home            | Training dashboard with provider metrics and workout details.                                                   |
| Calendar / Week | Planned and completed sessions; create, edit, move, copy, and delete editable calendar events.                  |
| Coach           | Private GitHub/OpenAI chat using the official Section 11 protocol, with a link to the upstream setup assistant. |
| Library         | Workout library.                                                                                                |
| Annual Plan     | Create and edit annual plans and race events.                                                                   |
| Settings        | Intervals.icu and Supabase connections, athlete zones, race details, and appearance, sign-in, and passkeys.     |

The former AI implementation has been removed. The app has one password/passkey sign-in shared by every page and API, with optional 90-day remembered sessions. The Coach page has a message composer, session-only conversation, source sync timestamp, stop/retry controls and new-chat action. Each turn reads `latest.json` and `DOSSIER.md` from the configured private GitHub repository; other training files and official report templates are read on demand. The backend sends the exact supplied persistent coach prompt on every model request, fetches the full official protocol from GitHub as a resource, includes core protocol rules verbatim, and supplies the complete current private dossier. It calls OpenAI Responses with `store: false`. Credentials remain server-side. The coach can prepare calendar workout previews using Section 11 push.py in the private GitHub data repository. The athlete reviews the exact plan and clicks Add to Intervals.icu to dispatch its confirmed write. The app tracks the matching workflow outcome and never retries an uncertain write automatically. Calendar proposal records persist encrypted separately from chat. The model cannot confirm writes, edit GitHub files, delete workouts or execute arbitrary scripts. There are no generated workout comments, scheduled reviews or review notifications. Workout buttons generate saved Section 11 pre-workout reports on the scheduled day and post-workout reports after completion and GitHub sync. Calendar summaries offer reports for completed Monday-Sunday weeks; ATP rows offer reports for completed consecutive weeks in the same period. Every report requires a click and is stored encrypted with a server-enforced generation lock once complete. New completed activity IDs trigger the GitHub auto-sync workflow, with the post-workout button disabled until the activity data is exported. The original setup link remains available.

## Provider and persistence

- Intervals.icu uses a personal API key with Basic authentication and athlete-scoped calls through /athlete/0.
- Application settings are encrypted in Supabase. Browser responses contain connection status and public preferences, never saved credentials.
- Backend Supabase bootstrap credentials remain in local configuration or the hosting environment.
- Training sync retains provider data and completed activity archives. Cached views speed up authenticated browsing and identify sync failures. App entry requires a verified server session.
- Historical records already in storage are preserved; retired AI records are not used by any feature.
- Calendar IDs use event:<id>; completed activity IDs use activity:<id>. Completed recordings are read-only.
- Verify provider mutations by reading back saved results. Never blindly retry an uncertain write.
- Provider durations are seconds, distances are metres, and threshold pace is speed in m/s.

## Service surface

The backend serves settings, training context and sync, activity summaries and analysis, calendar actions, workout editing, annual plans, and athlete comments. Authentication runs before API routing; signed-out requests are rejected. Unknown authenticated API routes return JSON 404 responses. Client-side page routes fall back to the built frontend.

See [README.md](README.md) for setup and [docs/workout-editor.md](docs/workout-editor.md) for the workout editor contract.

## Validation

- npm test runs backend tests with mock credentials and provider responses.
- npm run build type-checks and builds the UI.
- npm run lint checks the UI.
- Keep navigation, labels, focus states, loading states, errors, and mobile layouts usable.
