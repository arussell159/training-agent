import type { TrainingContext } from "@/lib/training-context"
import { dashboardToday } from "@/lib/dashboard-metrics"
import { RecoveryTrendCard, SleepCard } from "./section-cards"
import { NutritionHomeCard } from "./nutrition-summary"
import { EventsCard } from "./race-events"
import { HomePhoto } from "./home-photo"
import { MobileHomeHeading } from "./mobile-home-heading"

export function MobileHomeDetails({ context }: { context: TrainingContext }) {
  return (
    <>
      <section className="home-recovery-section" aria-label="Daily snapshot">
        <MobileHomeHeading title="Daily snapshot" />
        <div className="home-recovery-grid">
          <RecoveryTrendCard context={context} metric="hrv" />
          <RecoveryTrendCard context={context} metric="resting_hr" />
          <SleepCard context={context} showTrend />
          <NutritionHomeCard date={dashboardToday(context)} compact />
        </div>
      </section>
      <section className="home-race-section" aria-label="Race calendar">
        <MobileHomeHeading
          title="On the horizon"
          action="View plan"
          item="Annual Plan"
        />
        <div className="home-race-photo-card">
          <HomePhoto photo="bike-bridge" frame="race" />
          <EventsCard context={context} />
        </div>
      </section>
    </>
  )
}
