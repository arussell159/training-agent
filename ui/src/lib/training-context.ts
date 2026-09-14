export interface TrainingHistoryItem {
  workout_date: string
  planned?: { duration_minutes?: number; tss?: number }
  completed?: { duration_minutes?: number }
  recovery?: { hrv?: number | null; resting_hr?: number | null }
}

export interface PlannedWorkout {
  id: string
  day: string
  date: string
  workout_date?: string
  sport: string
  title: string
  duration: string
  goal: string
  details?: string
  status: "completed" | "today" | "upcoming"
  load?: number
  plannedDurationMinutes?: number
  actualDurationMinutes?: number
  planned?: { duration_minutes?: number; tss?: number }
  completed_data?: { duration_minutes?: number; tss?: number }
  scheduled_start_at?: string | null
  structure?: string | null
}

export interface LibraryWorkout {
  id: string
  sport: string
  title: string
  duration: string
  purpose: string
  tags?: string[]
}

export type DailyReviewStatus =
  | "pending_approval"
  | "proceed_as_planned"
  | "applying"
  | "apply_failed"
  | "approved"
  | "denied"
  | "expired"
  | "cancelled"

export interface DailyWorkoutReviewItem {
  workout_id: string
  title: string
  sport: string
  original: {
    duration_minutes: number
    tss: number
    description: string
    coach_comments: string
  }
  priority: "key" | "supporting" | "recovery"
  target_flexibility: string
  action:
    | "follow_as_written"
    | "reduce_target"
    | "add_recovery"
    | "shorten"
    | "remove_repetitions"
    | "substitute_easy"
    | "rest"
    | "increase_modestly"
  proposed_change: string | null
  reason: string
  execution_guidance: {
    target_range: string
    additional_recovery_limit: string
    stop_main_set_when: string
    fueling_note: string
  }
  applied_at?: string | null
}

export interface DailyWorkoutReview {
  id: string
  conversation_id: string
  local_date: string
  revision: number
  status: DailyReviewStatus
  summary: string
  reason: string
  relevant_observations: string[]
  workouts: DailyWorkoutReviewItem[]
  changes_proposed: boolean
  conversation_text: string
  apply_error?: string | null
}

export interface CoachConversationMessage {
  id: string
  role: "assistant" | "user"
  content: string
  created_at: string
  proposal?: unknown
  error?: boolean
}

export interface CoachConversationSummary {
  id: string
  title: string
  kind: "conversation" | "daily_review"
  review_id: string | null
  pinned: boolean
  preview: string
  created_at: string
  updated_at: string
}

export interface CoachConversation extends CoachConversationSummary {
  athlete_id: string
  messages: CoachConversationMessage[]
}

export interface NotificationPreferences {
  enabled: boolean
  reviewTime: string
  timeZone: string
  deliveryAvailable: boolean
  hasSubscription: boolean
  subscriptionCount: number
  publicKey: string | null
  lastDeliveryError: string | null
}

export interface TrainingContext {
  athlete: {
    name?: string
    race?: string
    race_date?: string
    phase?: string
    zones?: {
      bike_ftp?: number
      run_threshold_pace?: string
      swim_css?: string
      threshold_hr?: number
    }
  }
  metrics: {
    fitness?: number
    fatigue?: number
    form?: number
    recovery?: number
  }
  wellness?: { hrv?: number | null; resting_hr?: number | null }
  history: TrainingHistoryItem[]
  planned: PlannedWorkout[]
  library?: LibraryWorkout[]
  source?: string
  synced_at?: string
  sync_error?: string | null
}

const anchor = new Date("2026-09-14T12:00:00Z")

const fallbackHistory: TrainingHistoryItem[] = Array.from(
  { length: 90 },
  (_, index) => {
    const date = new Date(anchor)
    date.setUTCDate(date.getUTCDate() - (89 - index))
    const planned = index % 7 === 5 ? 0 : 42 + ((index * 11) % 58)
    const missed = index % 17 === 0

    return {
      workout_date: date.toISOString().slice(0, 10),
      planned: { duration_minutes: planned },
      completed: {
        duration_minutes: missed
          ? 0
          : Math.round(planned * (0.86 + (index % 8) * 0.025)),
      },
      recovery: {
        hrv: 48 + ((index * 5) % 13),
        resting_hr: 46 + ((index * 3) % 7),
      },
    }
  }
)

export const fallbackTrainingContext: TrainingContext = {
  athlete: {
    name: "Alex Russell",
    race: "IRONMAN 70.3 Waco",
    race_date: "2026-09-27",
    phase: "Taper",
    zones: {
      bike_ftp: 278,
      run_threshold_pace: "7:12/mi",
      swim_css: "1:38/100yd",
      threshold_hr: 168,
    },
  },
  metrics: { fitness: 71, fatigue: 67, form: 4, recovery: 62 },
  history: fallbackHistory,
  planned: [
    {
      id: "mon",
      day: "MON",
      date: "Sep 14",
      sport: "Swim",
      title: "Swim – 6x100 Aerobic + 4x50 Build",
      duration: "45 min",
      goal: "Stay relaxed and sharpen feel for the water.",
      status: "completed",
      load: 31,
      plannedDurationMinutes: 45,
      actualDurationMinutes: 43,
    },
    {
      id: "tue",
      day: "TUE",
      date: "Sep 15",
      sport: "Bike",
      title: "Bike – 3x8min 70.3 Pace",
      duration: "1h 05m",
      goal: "Keep race power familiar without carrying fatigue forward.",
      status: "today",
      load: 54,
      plannedDurationMinutes: 65,
      actualDurationMinutes: 0,
    },
    {
      id: "wed",
      day: "WED",
      date: "Sep 16",
      sport: "Run",
      title: "Run – Aerobic",
      duration: "40 min",
      goal: "Keep cadence sharp while protecting freshness.",
      status: "upcoming",
      load: 36,
      plannedDurationMinutes: 40,
    },
    {
      id: "thu",
      day: "THU",
      date: "Sep 17",
      sport: "Swim",
      title: "Swim – 8x100 70.3 Pace",
      duration: "50 min",
      goal: "Rehearse smooth race rhythm with controlled breathing.",
      status: "upcoming",
      load: 42,
      plannedDurationMinutes: 50,
    },
    {
      id: "fri",
      day: "FRI",
      date: "Sep 18",
      sport: "Recovery",
      title: "Rest day",
      duration: "—",
      goal: "Absorb the week and arrive fresh for Saturday.",
      status: "upcoming",
      load: 0,
      plannedDurationMinutes: 0,
    },
    {
      id: "sat",
      day: "SAT",
      date: "Sep 19",
      sport: "Bike",
      title: "Brick – 2x15min 70.3 Pace + 20min Easy",
      duration: "1h 40m",
      goal: "Confirm pacing and fueling; finish with more available.",
      status: "upcoming",
      load: 86,
      plannedDurationMinutes: 100,
    },
    {
      id: "sun",
      day: "SUN",
      date: "Sep 20",
      sport: "Run",
      title: "Run – Aerobic",
      duration: "50 min",
      goal: "Keep this easy and finish the week feeling better.",
      status: "upcoming",
      load: 44,
      plannedDurationMinutes: 50,
    },
  ],
  source: "local-preview",
}

export async function loadTrainingContext(forceRefresh = false) {
  try {
    const response = await fetch(`/api/training-context${forceRefresh ? "?refresh=1" : ""}`, {
      headers: { Accept: "application/json" },
    })
    if (!response.ok) throw new Error(`Training context ${response.status}`)
    const context = (await response.json()) as TrainingContext
    if (context.sync_error && /authentication|401|403|expired|credential/i.test(context.sync_error)) {
      window.dispatchEvent(new CustomEvent("trainingpeaks-auth-expired"))
    }
    return context
  } catch {
    return fallbackTrainingContext
  }
}

export async function loadDailyReview(id: string) {
  const response = await fetch(`/api/daily-reviews/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) throw new Error(`Daily review ${response.status}`)
  return (await response.json()) as DailyWorkoutReview
}

export async function loadCoachConversations() {
  const response = await fetch("/api/conversations?limit=500", {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) throw new Error(`Conversation history ${response.status}`)
  return (await response.json()) as CoachConversationSummary[]
}

export async function loadCoachConversation(id: string) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) throw new Error(`Conversation ${response.status}`)
  return (await response.json()) as CoachConversation
}

export function durationMinutes(workout: PlannedWorkout) {
  if (Number.isFinite(workout.plannedDurationMinutes)) {
    return Number(workout.plannedDurationMinutes)
  }
  if (Number.isFinite(workout.planned?.duration_minutes)) {
    return Number(workout.planned?.duration_minutes)
  }

  const hours = Number(workout.duration.match(/(\d+)h/)?.[1] ?? 0)
  const minutes = Number(workout.duration.match(/(\d+)\s*m/)?.[1] ?? 0)
  return hours * 60 + minutes
}

export function completedMinutes(workout: PlannedWorkout) {
  if (Number.isFinite(workout.actualDurationMinutes)) {
    return Number(workout.actualDurationMinutes)
  }
  if (Number.isFinite(workout.completed_data?.duration_minutes)) {
    return Number(workout.completed_data?.duration_minutes)
  }
  return workout.status === "completed" ? durationMinutes(workout) : 0
}
