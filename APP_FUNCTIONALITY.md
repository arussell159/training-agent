# Application Functionality Contract

This document is the source of truth for rebuilding the AR Performance application after removal of the previous UI. It records behavior, data, and safety requirements without preserving any former visual implementation.

## Rebuild constraint

- Build the new interface from a blank frontend.
- Every suitable interface element must come from the shadcn component system at <https://ui.shadcn.com/>.
- Initialize shadcn with preset `b1Ymqvgiu`.
- Do not restore or copy the deleted layout, CSS, components, generated assets, or frontend package configuration.
- The service layer in `app-backend/` and the MCP server in `src/` are retained independently of the future UI.

## Product purpose

The app is an athlete-facing triathlon coaching workspace. It combines a 90-day training history, the current TrainingPeaks plan, recovery and performance signals, concise AI coaching, controlled workout adjustments, workout feedback, and connection settings. The current coaching phase is taper for IRONMAN 70.3 Waco.

## Required destinations and workflows

The former routes describe required capabilities, not required page designs:

| Destination | Required behavior |
| --- | --- |
| `/` | Performance overview with today's workout, HRV, resting heart rate, fitness/CTL, fatigue/ATL, form/TSB, recovery/readiness, recent compliance, planned-versus-completed training, and weekly duration progress. |
| `/coach` | Coach conversation using athlete context and a clean text composer; display a proposed workout adjustment, its reason and risk; require explicit approval or rejection before applying it. |
| `/today` | Today's workout goal and structure; show any recommendation; support the same explicit approval flow and resolved state as Coach. |
| `/calendar` and `/week` | Current week, workload, focus, taper progress, workout status, load, risk, and coach notes. |
| `/library` | Search and filter reusable workouts by sport; show title, duration, purpose, and tags; allow a workout to enter a scheduling workflow. |
| `/workout/:id` | Workout goal, description/structure, duration, load, status, risk, coach guidance, and post-workout feedback submission. |
| `/settings` | Connection status and credential entry for TrainingPeaks, OpenAI, and Supabase; athlete zones; race details; notification preferences; reconnect/save actions. Never return stored secrets to the browser. |

Calendar workout cards use discipline color only on the sport icon. Their proportional workout profiles sit directly along the card bottom in neutral gray without a nested panel. Each desktop week summary is a discipline-time donut chart with a total and per-discipline durations.

The application also had persistent access to primary navigation, recent coach conversations, workout search, settings, account context, online/offline state, retry behavior, and success/error feedback.

### Sidebar requirement for the fresh build

- Use a persistent shadcn sidebar with no dropdown navigation.
- Primary items must appear in this exact order: Home, Coach, Calendar, Library, Settings.
- After Settings, show a non-interactive `Conversations` subheading.
- Under that subheading, show the five most recent conversations in recency order.
- Provide an explicit expand/show-more control to reveal older conversations; it must not turn the primary navigation into a dropdown.
- Conversation items open the selected conversation and expose a clear selected state.
- On mobile, keep a compact sticky title header without a menu button and provide direct bottom navigation for Home, Coach, Calendar, Library, and Settings.

### Settings requirement

- On mobile, Settings replaces the app content with a full-height `Menu` surface and hides the bottom navigation. It has a close control, labeled groups, rounded shadcn cards, neutral icons, current-value summaries, and chevrons.
- Mobile settings details open inside that surface with a clear Back control; closing Settings returns to Home.
- On desktop, Settings is a spacious, centered page with a title, supporting copy, and separate grouped cards for Connections, Athlete, and Preferences. Each row exposes its status and a Manage action.
- Preserve functional credential entry for TrainingPeaks, OpenAI, and Supabase; athlete zones and race context; theme selection; and workout-notification timing and delivery controls.

### Home dashboard requirement

- Base Home on the shadcn `dashboard-01` block and preset `b1Ymqvgiu`.
- Make today's workout the large left-hand headline card spanning both metric rows, with purpose, duration, training load, and no sport pill or gradient.
- Build its workout profile from the named set: interval width must be proportional to duration or distance (for example, 400 is four times the width of 100).
- Place equal-width HRV and resting-heart-rate cards side by side to its upper right, with one TrainingPeaks card beneath them.
- Show HRV and resting heart rate with compact trend charts whose shaded moving-baseline bands carry the expected range; do not use separate range footers. Hovering reports the date, that day's value, and its seven-day average.
- In the TrainingPeaks card, show Fitness/CTL, Fatigue/ATL, and Form/TSB as three side-by-side units.
- Show TrainingPeaks fitness/CTL with fatigue/ATL and form/TSB beneath it.
- Compare exactly seven unique days in the current week in hours, combining multiple same-day workouts. The gray planned duration is the shell filled by completed duration in blue, with both totals shown.
- Show completed duration only, grouped week over week across the latest 90 days.
- On mobile, keep the workout and TrainingPeaks cards full width, place HRV and resting heart rate side by side, reduce chart height without removing data, and preserve touch-accessible tooltips.
- Opening a workout on mobile must use a dedicated, glanceable page rather than a dialog. It includes a sticky Back control, date/status, duration, load, a discipline-colored icon, a profile derived from the actual workout steps, and plain-text Warm Up/Main Set/Warm Down instructions. Back restores the prior dashboard or calendar scroll position.

## Safety and mutation rules

1. Reading context and asking the coach are non-mutating.
2. Any AI-proposed TrainingPeaks or workout change must clearly show the current plan, proposed change, reason, and risk level.
3. The user must explicitly approve before the client calls the workout mutation endpoint. Rejecting keeps the original workout.
4. Post-workout feedback is submitted intentionally by the user.
5. Connection credentials are write-only in the interface. Status responses expose booleans only.
6. Treat failed live sync as degraded operation, not loss of local data.

The existing local workout endpoint records an approved recommendation locally; it does not itself enforce the approval gate. The future client must preserve that gate unless server-side enforcement is added.

## HTTP service contract

Run the retained local service with `npm run app:server`. It listens on `PORT` or `4173`, serves the built UI from `ui/dist`, and exposes the JSON endpoints below.

| Method and path | Request | Response/behavior |
| --- | --- | --- |
| `GET /api/config` | — | `{ trainingPeaksConnected, openAIConnected, supabaseConnected, supabaseNeedsUrl }`. |
| `POST /api/config` | Optional `TP_AUTH_COOKIE`, `OPENAI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Merges non-empty values into local configuration and returns connection booleans. |
| `POST /api/coach` | `{ message: string }` | Concise context-aware coaching as `{ message }`; message is required. |
| `GET /api/context/status` | — | Supabase readiness, 90-day retention, and missing-project-URL status. |
| `GET /api/training-context` | — | Athlete, metrics, history, current-week plan, comments, library, source, sync state, and 90-day retention. |
| `PATCH /api/workouts/:id` | `{ change: string }` | Marks the local planned workout as changed and records the approved recommendation. |
| `POST /api/comments` | `{ workoutId, body }` | Creates a post-workout comment. |
| `GET/PATCH /api/notification-settings` | Notification enablement, local review time, and IANA time zone | Returns safe delivery status and stores the athlete preference; never returns VAPID private material. |
| `POST/DELETE /api/push-subscriptions` | Browser Push API subscription | Registers or removes a device used for workout-review delivery. |
| `GET /api/daily-reviews` and `GET /api/daily-reviews/:id` | — | Lists saved reviews or opens the exact persisted coach review used by a notification. |
| `POST /api/daily-reviews/:id/approve` | — | Revalidates the live schedule, recovery, and workout state, applies the exact displayed patch to TrainingPeaks, then verifies the write. |
| `POST /api/daily-reviews/:id/deny` | — | Records denial and leaves TrainingPeaks unchanged. |
| `POST /api/start` | — | Starts the compiled TrainingPeaks MCP child process. |
| `POST /api/stop` | — | Stops the child process. |
| `GET /api/status` | — | Child-process running state, PID, and recent logs. |

Unknown non-file routes fall back to the built frontend so client-side destinations remain reachable.

## Core data shapes

### Workout

```ts
type Sport = "Bike" | "Run" | "Swim" | "Recovery"
type Risk = "low" | "medium" | "high"

interface Workout {
  id: string
  day: string
  date: string
  workout_date?: string
  sport: Sport
  title: string
  duration: string
  goal: string
  details: string
  status: "completed" | "today" | "upcoming"
  risk: Risk
  changed?: boolean
  load?: number
  recommendation?: string
  plannedDurationMinutes?: number
  actualDurationMinutes?: number
}
```

### Structured coach decision

The deleted client included this richer decision shape and fallback behavior. A future structured coach endpoint may restore it; until then `/api/coach` returns plain message text.

```ts
interface CoachDecision {
  summary: string
  risk_level: "low" | "medium" | "high"
  reason: string
  recommendation: string
  proposed_trainingpeaks_change: string | null
  needs_user_approval: boolean
  short_message_to_user: string
  pre_activity_comment: string
  workout_description: string
}
```

Training context also includes athlete identity, race and zones; fitness, fatigue, form, recovery, compliance and readiness metrics; up to 90 days of completed/planned sessions and recovery signals; athlete comments; and library entries.

## Data sources and fallback order

1. With `TP_AUTH_COOKIE`, the service exchanges the TrainingPeaks cookie for a short-lived bearer token and fetches workouts, performance, and wellness data.
2. Live TrainingPeaks context is cached in memory for five minutes and on disk for degraded operation.
3. If live sync fails, return the TrainingPeaks disk cache plus local comments/library and a `sync_error`.
4. If no cache is usable, return local context plus the sync error.
5. Without TrainingPeaks credentials, return local context with source `local-live`.
6. The coach uses local 90-day context and coaching configuration, enriched by Supabase context when configured and reachable.
7. Supabase context retains 90 days and supports coaching config, workout context, athlete comments, upserts, and pruning.

## Coaching behavior

- Be direct, specific, brief, and avoid generic motivation.
- Review the planned session, recent execution, recovery, comments, and upcoming week before advising.
- Account for heat, wind, terrain, sleep, pool conditions, and workout intent instead of treating every deviation as failure.
- During taper, prefer small changes that protect freshness while retaining short, controlled intensity.
- Keep threshold and sub-threshold work controlled and repeatable.
- Keep ordinary answers to one to four short sentences, but provide the complete title and structured session when asked to create a workout.
- State the current plan, proposed change, reason, and risk for any workout adjustment, then require explicit approval or rejection before recording the change.
- The server checks once per minute for a due daily review. It deduplicates by athlete and local date, saves the exact review in a coach conversation before attempting Web Push, retries failed delivery, and rechecks the calendar before sending. The app server must run continuously in production, but the PWA does not need to be open.
- Send the latest ten user/assistant messages with each coaching request so follow-up questions retain their conversational context.
- Ground coaching answers in the live TrainingPeaks context, falling back to the TrainingPeaks disk cache before local seed data. Resolve relative dates against the current date and use completed duration/load for completed-workout reviews.
- Use the OpenAI Responses API with `store: false`; the default model is `gpt-5-mini`. Proxy server-sent `response.output_text.delta` events so replies render incrementally.
- Render Coach and saved sidebar conversations with the shadcn Message Scroller, preserving the athlete's reading position while new content arrives and providing a jump-to-latest control.
- Keep the composer pinned above the mobile navigation with no divider, use the placeholder `Ask about training...`, and omit suggested prompt chips. The text box grows upward through four lines, then scrolls internally.

Generated workout titles follow `Discipline – Main Purpose + Key Set`, begin with Run, Bike, Swim, Brick, or Strength, omit minor structure, use consistent interval notation, and stay near 45 characters when practical. The complete live rules remain in `app-backend/coaching-config.json`.

## Preserved local seed behavior

The retained local service seeds an athlete profile for Alex Russell, IRONMAN 70.3 Waco on 2026-09-27, taper phase, sport zones, readiness/performance metrics, 90 days of history, the current seven-day plan, existing feedback, and three library workouts. Approved adjustments and new comments persist in `app-backend/local-data.json`, which remains ignored by Git.

## Rebuild acceptance criteria

- All destinations above remain reachable or are intentionally consolidated with no lost workflow.
- Live, cached, and local fallback states are distinguishable.
- No workout mutation can occur from an AI suggestion without explicit approval.
- Loading, empty, offline, success, and error states are covered.
- Keyboard access, visible focus, labels, and responsive navigation are present.
- Secrets never appear in client responses or logs.
- The frontend can be deleted and recreated without affecting MCP or stored athlete context.
