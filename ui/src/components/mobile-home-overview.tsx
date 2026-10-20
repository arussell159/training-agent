import { lazy, Suspense, useEffect, useRef, useState } from "react"
import {
  Activity,
  ArrowUpRight,
  Bike,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  Footprints,
  HeartPulse,
  Waves,
} from "lucide-react"
import { dailyWorkouts, dashboardToday } from "@/lib/dashboard-metrics"
import type { PlannedWorkout, TrainingContext } from "@/lib/training-context"
import { plannedDistanceLabel } from "@/lib/workout-distance"
import { formatWorkoutTss, workoutTime } from "@/lib/workout-metrics"
import { MobileHomeDetailsSkeleton } from "@/components/loading-layouts"
import { Skeleton } from "@/components/ui/skeleton"
import { HomePhoto, sessionPhoto } from "@/components/home-photo"
import { PageErrorBoundary } from "./page-error-boundary"
export { MobileHomeHeading } from "./mobile-home-heading"

const MobileHomeDetails = lazy(() =>
  import("./mobile-home-details").then((module) => ({
    default: module.MobileHomeDetails,
  }))
)

function shiftDay(day: string, offset: number) {
  const date = new Date(`${day}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + offset)
  return date.toISOString().slice(0, 10)
}

function navigate(item: string) {
  window.dispatchEvent(new CustomEvent("app-navigate", { detail: { item } }))
}

function SportIcon({ sport, size = 20 }: { sport: string; size?: number }) {
  const Icon = /swim/i.test(sport)
    ? Waves
    : /bike|ride/i.test(sport)
      ? Bike
      : /run|walk/i.test(sport)
        ? Footprints
        : /strength|gym/i.test(sport)
          ? Dumbbell
          : Activity
  return <Icon size={size} aria-hidden="true" />
}

function Hero({
  context,
  loading,
}: {
  context: TrainingContext
  loading: boolean
}) {
  const today = dashboardToday(context)
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay()
  const monday = shiftDay(today, -((weekday + 6) % 7))
  const week = Array.from({ length: 7 }, (_, index) =>
    dailyWorkouts(context, shiftDay(monday, index))
  ).flat()
  const completed = week.filter(
    (workout) => workout.status === "completed"
  ).length
  const progress = week.length ? Math.min(1, completed / week.length) : 0
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: context.athlete.time_zone || "America/Chicago",
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date())
  )
  const greeting =
    hour < 12
      ? "Good morning,"
      : hour < 17
        ? "Good afternoon,"
        : "Good evening,"
  const name = context.athlete.name?.trim()
  const names = name?.split(/\s+/) || []
  const fitness = context.metrics.fitness
  const form = context.metrics.form
  const format = (value?: number) =>
    value != null && Number.isFinite(value) ? Math.round(value) : "—"

  return (
    <section
      className="home-athlete-hero"
      aria-label="Your training overview"
      aria-busy={loading || undefined}
    >
      <HomePhoto photo="finish-texas" frame="hero" />
      <div className="home-hero-copy">
        <p className="home-greeting">{greeting}</p>
        {loading ? (
          <Skeleton className="home-name-skeleton" />
        ) : (
          <h2 className="home-athlete-name">
            {names.length ? (
              <>
                {names[0]}{" "}
                {names.length > 1 && <span>{names.slice(1).join(" ")}</span>}
              </>
            ) : (
              <>
                YOUR <span>TRAINING</span>
              </>
            )}
          </h2>
        )}
        <button
          type="button"
          className="home-phase-link"
          onClick={() => navigate("Annual Plan")}
        >
          <Activity size={14} aria-hidden="true" />
          <span>{context.athlete.phase || "Your training plan"}</span>
          <ChevronRight size={14} aria-hidden="true" />
        </button>
        <p className="home-overview-date">
          {new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", {
            weekday: "long",
            month: "long",
            day: "numeric",
            timeZone: "UTC",
          })}
        </p>
      </div>
      <div className="home-hero-stats">
        <div className="home-hero-stat">
          <span className="home-stat-label">This week</span>
          <div
            className="home-week-ring"
            aria-label={
              loading
                ? "Loading weekly sessions"
                : `${completed} of ${week.length} sessions completed this week`
            }
          >
            <svg viewBox="0 0 52 52" aria-hidden="true">
              <circle cx="26" cy="26" r="22" className="home-ring-track" />
              <circle
                cx="26"
                cy="26"
                r="22"
                className="home-ring-progress"
                strokeDasharray={`${progress * 138.23} 138.23`}
              />
            </svg>
            <strong>
              {loading ? "—" : week.length ? completed : "—"}
              {!loading && week.length > 0 && <small>/{week.length}</small>}
            </strong>
          </div>
        </div>
        <div className="home-hero-stat">
          <span className="home-stat-label">Fitness · CTL</span>
          <div className="home-fitness-value">
            <Activity size={18} aria-hidden="true" />
            <strong>{loading ? "—" : format(fitness)}</strong>
          </div>
        </div>
        <div className="home-hero-stat">
          <span className="home-stat-label">Form</span>
          <div className="home-form-value">
            <HeartPulse size={22} aria-hidden="true" />
            <strong>
              {loading
                ? "—"
                : `${form != null && Math.round(form) > 0 ? "+" : ""}${format(form)}`}
            </strong>
          </div>
        </div>
      </div>
    </section>
  )
}

function Sessions({
  context,
  loading,
  onWorkoutOpen,
}: {
  context: TrainingContext
  loading: boolean
  onWorkoutOpen: (workout: PlannedWorkout) => void
}) {
  const today = dashboardToday(context)
  const [day, setDay] = useState(today)
  const [activeCard, setActiveCard] = useState(0)
  const carousel = useRef<HTMLDivElement>(null)
  const sessions = dailyWorkouts(context, day)
  const sessionIds = sessions.map((workout) => workout.id).join("\u0000")
  useEffect(() => {
    setDay(today)
  }, [today])
  useEffect(() => {
    setActiveCard(0)
    carousel.current?.scrollTo({ left: 0, behavior: "instant" })
  }, [day, sessionIds])
  const label =
    day === today
      ? "Today’s sessions"
      : day === shiftDay(today, 1)
        ? "Tomorrow’s sessions"
        : day === shiftDay(today, -1)
          ? "Yesterday’s sessions"
          : new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
              timeZone: "UTC",
            })

  return (
    <section
      className="home-sessions"
      aria-label="Daily workouts"
      aria-busy={loading || undefined}
    >
      <div className="home-section-heading">
        <h2>{label}</h2>
        <div className="home-day-controls">
          {day !== today && (
            <button type="button" onClick={() => setDay(today)}>
              Today
            </button>
          )}
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setDay((value) => shiftDay(value, -1))}
          >
            <ChevronLeft size={17} />
          </button>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => setDay((value) => shiftDay(value, 1))}
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </div>
      <div
        className="home-session-carousel"
        ref={carousel}
        role="region"
        aria-label={`${label}. Scroll to see all sessions.`}
        tabIndex={0}
        onScroll={() => {
          const element = carousel.current
          const first = element?.firstElementChild
          if (element && first)
            setActiveCard(
              Math.min(
                sessions.length - 1,
                Math.max(
                  0,
                  Math.round(
                    element.scrollLeft /
                      (first.getBoundingClientRect().width + 12)
                  )
                )
              )
            )
        }}
      >
        {loading ? (
          <div className="home-session-loading">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="mt-4 h-10 w-4/5" />
            <Skeleton className="mt-6 h-4 w-3/5" />
          </div>
        ) : sessions.length ? (
          sessions.map((workout) => (
            <button
              type="button"
              className="home-session-tile"
              key={workout.id}
              aria-label={`Open ${workout.title}`}
              onClick={() => onWorkoutOpen(workout)}
            >
              <HomePhoto
                photo={sessionPhoto(workout.sport, workout.id)}
                frame="session"
              />
              <div className="home-session-topline">
                <span>
                  <SportIcon sport={workout.sport} size={16} />
                  {workout.sport}
                </span>
                <span className="home-session-status">
                  {workout.status === "completed" ? (
                    <>
                      <Check size={12} />
                      Completed
                    </>
                  ) : (
                    "Planned"
                  )}
                </span>
              </div>
              <h3>{workout.title}</h3>
              <div className="home-session-bottom">
                <span className="home-session-metrics">
                  <span>
                    <Clock3 size={13} aria-hidden="true" />
                    {workoutTime(workout).value}
                  </span>
                  <span>{formatWorkoutTss(workout)}</span>
                  <span>{plannedDistanceLabel(workout)}</span>
                </span>
                <span className="home-session-open">
                  <ArrowUpRight size={19} aria-hidden="true" />
                </span>
              </div>
            </button>
          ))
        ) : (
          <div className="home-rest-day">
            <span className="home-rest-icon">
              <Activity size={22} aria-hidden="true" />
            </span>
            <h3>No workout scheduled</h3>
            <p>Your calendar is clear for this day.</p>
            <button type="button" onClick={() => navigate("Calendar")}>
              View calendar
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
      {sessions.length > 1 && !loading && (
        <div className="home-carousel-pagination" aria-label="Choose a session">
          {sessions.map((workout, index) => (
            <button
              type="button"
              key={workout.id}
              aria-label={`Show session ${index + 1}: ${workout.title}`}
              aria-current={activeCard === index ? "true" : undefined}
              onClick={() => {
                const tile = carousel.current?.children[index]
                tile?.scrollIntoView({
                  inline: "center",
                  block: "nearest",
                  behavior: window.matchMedia(
                    "(prefers-reduced-motion: reduce)"
                  ).matches
                    ? "instant"
                    : "smooth",
                })
              }}
            >
              <span />
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function MobileHomeOverview({
  context,
  loading,
  onWorkoutOpen,
}: {
  context: TrainingContext
  loading: boolean
  onWorkoutOpen: (workout: PlannedWorkout) => void
}) {
  const detailRegion = useRef<HTMLDivElement>(null)
  const [detailsVisible, setDetailsVisible] = useState(false)
  useEffect(() => {
    const element = detailRegion.current
    if (!element) return
    if (typeof IntersectionObserver === "undefined") {
      setDetailsVisible(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setDetailsVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: "120px 0px" }
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  return (
    <>
      <Hero context={context} loading={loading} />
      <Sessions
        context={context}
        loading={loading}
        onWorkoutOpen={onWorkoutOpen}
      />
      <div ref={detailRegion} className="home-deferred-details">
        <PageErrorBoundary resetKey="home-details">
          <Suspense fallback={<MobileHomeDetailsSkeleton />}>
            {detailsVisible && !loading ? (
              <MobileHomeDetails context={context} />
            ) : (
              <MobileHomeDetailsSkeleton />
            )}
          </Suspense>
        </PageErrorBoundary>
      </div>
    </>
  )
}
