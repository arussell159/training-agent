# AR Performance training app

This training app connects to your own Intervals.icu account using its official public API. The Coach page provides a fresh, private chat backed by your GitHub training-data repository, the official Section 11 protocol, and OpenAI. It also links to the [Section 11 Setup Assistant on GitHub](https://github.com/CrankAddict/section-11/blob/main/SETUP_ASSISTANT.md). Workout, weekly and completed ATP block reports are generated manually and saved in place.

## Setup

Requires Node.js 20+ and an Intervals.icu account.

1. Install dependencies: `npm install` and `npm --prefix ui install`.
2. Build: `npm run build`.
3. Configure Supabase as described below, then set `APP_PASSWORD` (at least 20 characters) in the server environment. Existing installations can keep `COACH_ACCESS_PASSWORD`; it is used as the app password when `APP_PASSWORD` is unset.
4. Start: `npm start`; open http://localhost:4173 and sign in. If using `.env.local`, start with `node --env-file=.env.local app-backend/server.mjs`.
5. Open Settings → Intervals.icu. Enter your personal API key and save. The backend validates it with a read-only profile request before storing it.

Your athlete ID resolves automatically through `/athlete/0`. No browser cookies or TrainingPeaks account are needed. Generate/revoke keys in [Intervals.icu Settings](https://intervals.icu/settings).

Settings saves now persist in Supabase, including Intervals.icu credentials and appearance. Saved application settings override older local/environment application keys, so an updated API key is remembered after reloads and cold starts.

Stored settings are AES-256-GCM encrypted and kept in a backend-only Supabase table. The Settings API returns connection status and public preferences only, never saved credentials. This is a single-user application. One app session protects every backend API, including Settings, training data and Coach. HTTPS is required on hosted deployments.

## Supabase Settings setup

1. Run `app-backend/supabase/settings.sql` in your existing Supabase project's SQL editor. New installations can run the full `schema.sql` instead. Browser roles have no access to the settings table; the backend uses the secret/service-role key.
2. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the hosting environment and redeploy. Local development can bootstrap these through the git-ignored backend config file. They must exist outside Supabase to unlock it.
3. Recommended before the first save: set `SETTINGS_ENCRYPTION_KEY` to a stable random secret of at least 32 characters in the backend environment. Without it, encryption derives from the Supabase secret. Keep the original encryption material: changing it makes existing saved settings unreadable. With a dedicated stable key, the Supabase service secret can be rotated without losing settings.
4. Open Settings and save the Intervals.icu key again. Success is reported only after Supabase confirms persistence. The key is validated with a read-only Intervals.icu request first.

`SETTINGS_SCOPE` defaults to `default`; use a distinct stable scope per installation sharing a database. Settings are not pruned with the 90-day training records. There is no local-file fallback for failed saves. Cache writes remain best-effort in `/tmp` on Vercel and never turn a verified calendar change into a failed write.

## App sign-in and passkeys

The app uses the same login on every page. “Remember me” defaults on and retains a session for 90 days. Turning it off creates a browser-session cookie with a 24-hour server limit. The existing coach password works for app login; `APP_PASSWORD` takes precedence when configured. Password fields support browser password-manager saving and autofill.

After the first password login, the app offers passkey registration. The device owner completes the browser or operating-system prompt. A registered passkey becomes the preferred login method, with password fallback. Settings → Sign-in & passkeys supports adding/removing passkeys and signing out of the current device. Passkey changes require authentication within the last 10 minutes.

Use `APP_ORIGIN=https://training-agent-omega.vercel.app` for this production deployment (no trailing slash). Without an explicit origin, Vercel’s production URL environment variable is used. Origins are checked on every API request; passkey signatures require the expected origin, RP ID, challenge and user verification. For local testing use a `localhost` URL, such as `http://localhost:4173`; numeric `127.0.0.1` addresses support password login only. Local and production credentials are separate: register your everyday passkey on the deployed app.

Authentication state is encrypted in a separate origin-specific scope of the existing backend-only `app_settings` table. No additional SQL migration is needed. Updates compare the previously encrypted record atomically, so serverless instances cannot consume a challenge twice or overwrite another session update. Challenges last five minutes and are bound to the requesting browser. Password attempts are limited across instances to 10 per 15 minutes. Active sessions and pending challenges are bounded and expired entries are pruned during writes.

Cookies are HttpOnly, SameSite=Strict, and Secure on HTTPS; session tokens are stored only as hashes in the encrypted record. Logout revokes the token in Supabase and clears browser training caches. Password rotation invalidates existing sessions; registered passkeys remain available. If Supabase is unavailable, API authentication fails closed. Keep the original encryption key when rotating database credentials.

## Training and calendar

- Reads athlete/sport settings, 90 days of activities/wellness and 60 days of upcoming calendar events.
- Threshold pace is converted from metres/second; durations are converted from seconds.
- Paired planned/completed sessions are combined to avoid counting the same activity twice.
- Drag a planned calendar event to save its new date to Intervals.icu. Time and multiday duration are preserved, and the saved date is read back to verify success.
- Calendar event copy/delete controls also verify results. Completed activities themselves are read-only.
- Missing data is unavailable, not an invented measurement. Sync failures are labelled; stored training data is not a live connection.

The old chat implementation, generated workout comments, scheduled reviews, conversation database APIs, AI settings, custom coaching prompts, and bundled Section 11 installation have been removed. Existing historical database records are preserved and are not used by the new chat.

## GitHub and OpenAI coach

The GitHub Actions sync is the data pipeline. No local computer or Supabase sync worker is required. Set these **server-only** environment variables in Vercel Production, then redeploy:

| Variable                      | Value                                                                                         |
| ----------------------------- | --------------------------------------------------------------------------------------------- |
| `TRAINING_DATA_GITHUB_TOKEN`  | Fine-grained token: Contents read-only and Actions read/write, restricted to your training repository |
| `TRAINING_DATA_GITHUB_REPO`   | `arussell159/my-training-data` (or your own `owner/repository`)                               |
| `TRAINING_DATA_GITHUB_BRANCH` | `main`                                                                                        |
| `OPENAI_API_KEY`              | OpenAI project API key                                                                        |
| `APP_PASSWORD`                | Unique app password of at least 20 characters; existing `COACH_ACCESS_PASSWORD` is a fallback |
| `OPENAI_MODEL`                | Optional; defaults to `gpt-5.4-mini`, which supports Responses function calling               |

Keep secrets out of frontend variables and the Settings API. For a local integration test, put the same variables in a git-ignored `.env.local` and run `node --env-file=.env.local app-backend/server.mjs` after building the UI. Do not commit that file. Open `/coach` on the backend's port (4173 by default). Vercel variables are not automatically available locally.

The `/api/coach/session` and `/api/coach/message` endpoints use the app session. The old coach login/logout endpoints are removed. Concurrent model requests have a per-instance limit; configure spending limits in the OpenAI project separately.

Every question re-reads the private branch revision, `latest.json` and `DOSSIER.md`. Other JSON files are read on demand from the same commit, with a refresh tool when today's activities are missing. Large JSON files return explicit navigable indexes rather than truncated data. A missing or invalid source fails clearly; fictional example data is never a fallback. Sync timestamps over one hour old are labelled delayed, and the coach is instructed to refresh and avoid current readiness advice from stale data.

The exact athlete-supplied prompt is stored in `app-backend/coach/PROJECT_INSTRUCTIONS.md` and sent unchanged in the `instructions` field of every Responses request, including new messages and tool continuations. It replaces the shorter web-chat contract. The full official `SECTION_11.md` is fetched from `CrankAddict/section-11`, checked for updates every ten minutes, and kept only in server memory. Core behavioral, validation and source-trust sections are included verbatim on every request. The complete protocol index and read-only section tool provide access to the rest; the first model request must select relevant protocol sections. The document is not rewritten or summarized. The full private dossier is included anew for each question. See `app-backend/coach/README.md` for the resource contract. The four report templates supplied by the athlete are bundled unchanged in `app-backend/coach/reports/`, each pinned by SHA-256; the report hierarchy uses the current upstream protocol revision. There is no generated rule summary or vendored upstream installation. Up to eight model requests and twelve source tool calls can contribute to latency and API costs. Temporary token rate limits get at most two bounded retries per request; billing-quota errors fail without retries. All work shares a four-minute total timeout. The configured five-minute Vercel function duration requires Fluid compute on Hobby plans.

The model can read sources and prepare calendar proposals. It cannot execute code, edit source files, change the dossier, or confirm a calendar write. Athlete data and the dossier are sent to OpenAI to answer the question. Responses use `store: false`; this is not a promise of zero provider retention. Chat history lives only in page memory and clears on navigation/reload; it is not written to Supabase, browser storage, or the application's logs. Remote images and links in generated answers are not loaded.

### Coach calendar push through GitHub

The data repository must contain `push.py` at its root and `.github/workflows/push-workout.yml`. Deployment copies are in `app-backend/coach/github/`: `push.py` is the upstream Section 11 v0.6 script, unchanged; the workflow retains its commands and existing `ATHLETE_ID` / `INTERVALS_KEY` secrets, passes inputs as data instead of shell interpolation, and exposes correlated preview/write results. Install both files together. The app token needs **Actions: Read and write**, in addition to **Contents: Read-only**, on the data repository. No local sync process is needed. `COACH_TIME_ZONE` defaults to `America/Chicago` and controls local workout dates in the app and runner.

Ask the coach to prepare planned workouts, review the exact dates, sports and step descriptions on the calendar card, then click **Add to Intervals.icu** after the GitHub preview passes. The model's tool only dispatches `confirm=false`. Only the authenticated button endpoint dispatches `confirm=true`, using the immutable server-stored payload. Bike, run and swim are supported as separate sessions. Existing workouts are retained; this feature does not replace, move or delete them. Previews expire after 24 hours.

Calendar proposals and their outcomes are stored encrypted in a separate Supabase `app_settings` scope (no new SQL migration). Atomic claims prevent repeated clicks or multiple Vercel instances from dispatching the same write twice. Stable external IDs accompany the entire batch. Unknown outcomes are retained, never automatically retried, and direct the athlete to check the calendar and linked GitHub run. A successful dispatch only means queued; the app reports added only after the matching workflow's `push.py` result is `applied`. GitHub keeps the private result artifact for seven days. The app retains at most 100 recent proposal records, pruning records older than 30 days when a new proposal is created; old IDs cannot be confirmed after pruning.

### Saved Section 11 reports and workout sync

Today's planned sessions show **Generate pre-workout report** at the bottom of their details. Completed sessions replace the pre-workout report with **Generate post-workout report** in the same location. Completed Monday–Sunday weeks have a report in the desktop calendar summary. On mobile, weekly and block reports live at the bottom of Home with period selectors. The ATP shows a block report after consecutive weeks with the same period label finish; recovery weeks remain part of that period. Dates follow the athlete's time zone. Generation always requires a button press.

Reports use the same exact persistent prompt, fresh private dossier and official Section 11 protocol as chat, plus the athlete's exact supplied template and the official hierarchy. Training data is pinned to its GitHub commit; supplied templates have independent content hashes. Field labels, ordering, conditional omissions, source units and interpretation lengths follow the templates, with no extra commentary. Weekly and block cards show a one-sentence preview and open the full formatted report in a details popup. Same-day pre-workout continuation requires a fresh Feel/soreness/symptoms check-in before generation. Historical reports use dated history, not today's rolling metrics relabelled as an old period. Previously saved reports provide continuity to the next report level. Missing essential data or an incomplete model response leaves the report retryable; it does not mark an apology as completed.

Completed report text, subject, timestamps and source revisions persist encrypted in separate Supabase `app_settings` records. Atomic claims prevent duplicate generation across tabs and server instances. A completed report remains readable and cannot be regenerated. Navigating away does not cancel the server's save. This persistence is separate from the session-only Coach conversation and requires no database migration.

When fresh provider data introduces a completed activity, the app dispatches `.github/workflows/auto-sync.yml` in the private training-data repository. Install the copy in `app-backend/coach/github/auto-sync.yml`: it retains the scheduled sync and adds an optional `request_id`, a correlated run name and concurrency control. It uses the existing `ATHLETE_ID` and `INTERVALS_KEY` secrets. The application token needs **Actions: Read and write** and **Contents: Read-only**; installing the workflow itself needs workflow-edit access. No local sync daemon is required.

The post-workout button stays disabled until that exact activity ID appears in `latest.json`, with its interval record when the export says it has intervals. A green Actions run alone is insufficient. Optional missing streams do not block reports indefinitely. Sync progress and a run link appear beside the disabled button; failed or incomplete syncs can be retried manually. First imports do not dispatch a run per historical activity. Opening a recent unsynced completed session can catch up a missed completion notification. Workouts outside the export window and weeks/blocks without sufficient history show an explicit limitation.

## Development and tests

`npm run dev` starts the UI; run `npm start` separately for API requests.
`npm test` runs backend tests using mock credentials and provider responses.
`npm run build` type-checks and builds the UI.
