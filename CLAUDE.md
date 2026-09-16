# Intervals.icu coaching app — development notes

See README.md for setup. The retired TrainingPeaks MCP transport/source has been removed.

- Backend: app-backend/server.mjs; UI: ui/src; serverless entry: api/handler.mjs.
- Durable Settings: lib/settings-store.mjs and supabase/settings.sql. App credentials/preferences are encrypted in Supabase; backend Supabase bootstrap credentials remain in environment/local configuration. Saved application values take precedence over legacy environment defaults. Never silently fall back to a local file after a failed save.
- Official provider transport: app-backend/lib/intervals.mjs. Personal API key uses Basic authentication with username API_KEY, kept in backend configuration/environment only.
- Never print, commit, or include user credentials in chat or test fixtures. Tests use dummy keys and mocked responses.
- Athlete-scoped calls use /athlete/0. Coaching policy is the exact vendored `vendor/section-11/SECTION_11.md`; deployment-specific data-access rules are in `SECTION_11_RUNTIME_INSTRUCTIONS`.
- Calendar IDs are event:<numeric id>; completed activity IDs are activity:<id>. Only calendar events are editable.
- Intervals.icu source moving_time is seconds, distance is metres, threshold_pace is speed in m/s. Do not import old decimal-hour provider assumptions.
- Date moves patch start/end local dates only, preserving time and multiday span. Read back mutations before reporting success; never blindly retry uncertain writes.
- Chat tools expose a live Section 11 compatibility snapshot and explicit read-only Intervals.icu operations. No chat write tool is registered.
- Daily reviews remain advisory; legacy unsupported structured patches must fail safely.
- npm test runs backend tests; npm run build checks/builds the UI.
- Preserve historical athlete records and conversations. Supabase snapshots are provider-tagged so old provider data is not mistaken for current Intervals.icu data.
