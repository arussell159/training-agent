# Intervals.icu training app — development notes

See README.md for setup. The retired TrainingPeaks MCP transport/source has been removed.

- Backend: app-backend/server.mjs; UI: ui/src; serverless entry: api/handler.mjs.
- Durable Settings: lib/settings-store.mjs and supabase/settings.sql. App credentials/preferences are encrypted in Supabase; backend Supabase bootstrap credentials remain in environment/local configuration. Saved application values take precedence over legacy environment defaults. Never silently fall back to a local file after a failed save.
- Official provider transport: app-backend/lib/intervals.mjs. Personal API key uses Basic authentication with username API_KEY, kept in backend configuration/environment only.
- Never print, commit, or include user credentials in chat or test fixtures. Tests use dummy keys and mocked responses.
- Athlete-scoped calls use /athlete/0.
- Calendar IDs are event:<numeric id>; completed activity IDs are activity:<id>. Only calendar events are editable.
- Intervals.icu source moving_time is seconds, distance is metres, threshold_pace is speed in m/s. Do not import old decimal-hour provider assumptions.
- Date moves patch start/end local dates only, preserving time and multiday span. Read back mutations before reporting success; never blindly retry uncertain writes.
- npm test runs backend tests; npm run build checks/builds the UI.
- Preserve historical athlete records. Supabase snapshots are provider-tagged so old provider data is not mistaken for current Intervals.icu data.

The Coach page contains the new GitHub/OpenAI chat plus the upstream setup link. See `github-coach-source.mjs`, `github-coach.mjs`, and `coach-http.mjs`. Only `/api/coach/session` and `/api/coach/message` are active; old AI routes remain removed. Workout coach buttons stay disabled. Use the exact athlete-supplied persistent prompt in `app-backend/coach/PROJECT_INSTRUCTIONS.md` on every Responses request. Fetch the full official Section 11 protocol as a resource, include its core rules verbatim, and expose the complete document through the section reader. Do not substitute the shorter web-chat contract or example data. GitHub and OpenAI keys and the app password come only from server environment variables. `app-auth.mjs` gates every API before routing, with remembered app sessions and verified passkeys. Authentication state uses encrypted, atomic compare-and-swap updates in a separate origin-specific `app_settings` scope via `app-auth-store.mjs`. Keep challenges single-use and browser-bound, and preserve password fallback. Protect model calls and source data with the app session gate; do not reuse the old AI data/settings stores. Source tools are read-only. The calendar proposal tool only runs a GitHub preview; the authenticated app confirmation button alone dispatches the stored workout plan with confirm=true. Preserve the encrypted atomic dispatch claim, exact run correlation and explicit unknown outcomes in coach-calendar.mjs. Conversations are held in page memory only; calendar proposals have a separate encrypted Supabase record. There is no scheduled review service or application AI credential setting.
