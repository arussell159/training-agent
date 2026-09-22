# Database-quiet workout imports

## Startup refresh

On the first eligible startup after sign-in, the app requests one GitHub `auto-sync.yml` refresh while the cached dashboard remains usable. This is bundled into the existing authenticated startup lease request; there is no immediate full Intervals/Supabase rewrite just because the app opened. It reuses the manual-sync durable dispatch claim, including active-run deduplication and uncertain-write handling, without initializing application report generation.

The app checks the mirror immediately after startup and continues the existing two-minute, visible/online-only addition checks. A newly seen activity triggers the existing protected incremental import. No placeholder workout is invented, and no successful workflow dispatch is presented as proof that a workout was imported. GitHub run/commit time and the mirror read cache can delay discovery.

The startup request is once per mounted application load, not on focus, page rerenders, normal hint checks or ordinary sync retries. An explicit retry of a displayed startup error may reconcile/retry the request through the same durable claim. A browser reload starts a new startup request, but an already-active app-dispatched run is reused. This does not deduplicate an independently scheduled GitHub run. The startup dispatch uses the existing Supabase-backed claim once; unchanged idle checks remain database-free. The 24-hour historical-record policy below is unchanged.

## Scope

The open application's two-minute background timer checks **only the configured private GitHub `latest.json` mirror** for a previously unseen completed activity ID. It no longer calls the Supabase-backed `/api/sync` on every tick. This reuses the source export/report pipeline; it does not install an Intervals webhook or change the data repository's schedule.

After one authenticated startup baseline, unchanged checks make zero Supabase reads/writes, zero Intervals reads/writes and zero model requests. The narrow hint uses server-side GitHub credentials only. A newly observed ID invokes the ordinary authenticated import, saves the changed records, and replaces the baseline. An automatic mirror-driven import does not dispatch a second GitHub sync.

Initial page/session loading, deliberate Refresh, actual edits, and actual new-workout imports still use Supabase. This is not a claim that every page/function in the application never reads the database. Existing sessions/pages must reload after deployment to load the new timer.

## Historical record policy

`incrementalSnapshot` filters per-workout/archival write batches by stable content, preserving already-imported completed workouts from 24 hours after their actual end. UTC activity start plus elapsed duration takes precedence over paired calendar dates. A timezone-aware local recording time is the fallback; where the recording clock is unavailable, the verified saved import timestamp supplies storage age, not a guessed workout end.

Already saved historical records are preserved even when a later provider response changes, deletes, re-pairs or omits them. A genuinely unseen older upload may be inserted once when it enters the import window. Unchanged recent workouts are not rewritten. Changed workouts within the first 24 hours can settle when a real import/explicit refresh occurs; there is no separate periodic database settling job. Future planned workouts and explicitly authorized edits remain editable. Full cached dashboard snapshots still contain retained history, but the individual historical workout/archive records are not updated by these imports.

Periodic pruning was removed from `persistTrainingContext`; opening a page is not an archive-cleanup instruction. No stored data is deleted or migrated by this change.

## Delivery and freshness tradeoffs

Addition detection follows GitHub source availability (the existing source schedule is nominally 15 minutes), then the foreground app's hint check. It is not instant and does not operate in a closed/hidden browser. Only IDs in the mirror's `recent_activities` window are visible to this detector. Very old late uploads outside that window require explicit refresh/backfill.

An idle timer does not fetch wellness/calendar-only changes or corrections to an existing activity ID. Use Refresh for those; regular source/report workflows remain independent. Saved source timestamps are not relabeled fresh just because an unchanged check succeeded. Stale/invalid source, missing GitHub configuration and failed authentication pause or back off rather than silently returning to heavy Supabase polling. Three failed new-workout imports pause retries pending explicit attention.

## Narrow hint capability and authentication boundary

The normal app session gate is unchanged for data access, settings, mutations, lease creation and actual imports. A signed, purpose-scoped hint is issued only after that gate verifies the real session and baseline. It is bound to the HttpOnly session cookie hash, origin, current app-password epoch, configured repository/branch and original session expiry (never more than 90 days). It is kept in page memory; it contains known activity IDs, not credentials or workout metrics. GitHub credentials never leave the backend.

The hint endpoint accepts no destination, URL, action or data write. It validates its signature and browser binding before the one allowed GitHub source read; its sole successful response is a `changed` boolean. This deliberately avoids remote session/settings lookup on idle hints, including on a cold serverless instance. Individual server-side session revocation is enforced by the unchanged full import/data gate, not a database query on the boolean hint. Local logout removes the required cookie; password/secret rotation invalidates the hint immediately. Expired capabilities stop checks and require an explicit restart; they do not automatically renew through Supabase.

## Verification

Tests cover 1,000 idle coordinator checks; cold-instance hint requests restricted to GitHub; single new-workout import/deduplication; tampered/expired/wrong-session/origin/repository capabilities; no heavy fallback on source errors; 24-hour boundaries and local timestamps; unchanged-row filtering; late uploads; frozen pairing/deletion preservation; and explicit edit handling. The integration acceptance run also imports the actual server with all network requests intercepted, then exercises the hint route without any Supabase access. Test fixtures are synthetic, not athlete evidence.

The separate frontend authentication timer now checks the already verified session expiry locally, not Supabase. Logout propagation and server authorization on real requests remain. A remotely revoked session may continue showing already cached content until the next actual protected request; no new protected data or mutations are authorized by the local clock. Report views also no longer run an unbounded status timer: opening the view, new training context, and deliberate actions trigger reads.
