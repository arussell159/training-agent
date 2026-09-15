# Open Triathlon Coach app

AR Performance's training app connects to your own Intervals.icu account using its official public API. The coaching policy and Action operation catalogue come from [Open Triathlon Coach for ChatGPT](https://github.com/Takethis88/Open-Triathlon-Coach-for-ChatGPT), retained under its MIT licence. This is a local API-runtime adaptation, not the author's hosted custom GPT.

## Setup

Requires Node.js 20+ and an Intervals.icu account.

1. Install dependencies: `npm install` and `npm --prefix ui install`.
2. Build: `npm run build`.
3. Start: `npm start`; open http://localhost:4173.
4. Open Settings → Intervals.icu. Enter your personal API key and save. The backend validates it with a read-only profile request before storing it.
5. Keep your existing OpenAI connection for coaching. Configure Supabase for durable Settings storage; notifications remain optional.

Your athlete ID resolves automatically through `/athlete/0`. No browser cookies or TrainingPeaks account are needed. Generate/revoke keys in [Intervals.icu Settings](https://intervals.icu/settings).

Settings saves now persist in Supabase, including Intervals.icu/OpenAI credentials, model, notification delivery keys and appearance. Saved application settings override older local/environment application keys, so an updated API key is remembered after reloads and cold starts.

Never paste credentials into coach chat. Stored settings are AES-256-GCM encrypted and kept in a backend-only Supabase table. The Settings API returns connection status and public preferences only, never saved credentials. This is a single-user application: protect access to the app's Settings API with deployment access control and HTTPS; database row-level security does not authenticate callers of your backend API.

## Supabase Settings setup

1. Run `app-backend/supabase/settings.sql` in your existing Supabase project's SQL editor. New installations can run the full `schema.sql` instead. Browser roles have no access to the settings table; the backend uses the secret/service-role key.
2. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in the hosting environment and redeploy. Local development can bootstrap these through the git-ignored backend config file. They must exist outside Supabase to unlock it.
3. Recommended before the first save: set `SETTINGS_ENCRYPTION_KEY` to a stable random secret of at least 32 characters in the backend environment. Without it, encryption derives from the Supabase secret. Keep the original encryption material: changing it makes existing saved settings unreadable. With a dedicated stable key, the Supabase service secret can be rotated without losing settings.
4. Open Settings and save the Intervals.icu key again. Success is reported only after Supabase confirms persistence. The key is validated with a read-only Intervals.icu request first.

`SETTINGS_SCOPE` defaults to `default`; use a distinct stable scope per installation sharing a database. Settings are not pruned with the 90-day training records. There is no local-file fallback for failed saves. Cache writes remain best-effort in `/tmp` on Vercel and never turn a verified calendar change into a failed write.

## Training and calendar

- Reads athlete/sport settings, 90 days of activities/wellness and 60 days of upcoming calendar events.
- Threshold pace is converted from metres/second; durations are converted from seconds.
- Paired planned/completed sessions are combined to avoid counting the same activity twice.
- Drag a planned calendar event to save its new date to Intervals.icu. Time and multiday duration are preserved, and the saved date is read back to verify success.
- Calendar event copy/delete controls also verify results. Completed activities themselves are read-only.
- Chat uses upstream Intervals.icu read operations. Chat calendar creation/wellness changes return previews only; they are not silently applied.
- Scheduled reviews remain advisory. Old provider-specific structured review patches are refused.
- Missing data is unavailable, not an invented measurement. Sync failures are labelled; stored training data is not a live connection.

The old TrainingPeaks MCP source and transports have been removed. Existing local coaching conversations and historical data are preserved; old TrainingPeaks cache files are not read. No private GPT Knowledge files were supplied by the upstream repository.

## Development and tests

`npm run dev` starts the UI; run `npm start` separately for API requests.
`npm test` runs backend tests using mock credentials and provider responses.
`npm run build` type-checks and builds the UI.
