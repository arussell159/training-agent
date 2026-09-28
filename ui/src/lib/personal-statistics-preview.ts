export type PerformanceRecord = {
  id?: string
  date: string
  sport: string
  name: string
  distance_meters: number
  duration_seconds: number
  elevation_meters: number
  achievements?: Array<{ type?: string; distance?: number; secs?: number; value?: number }>
}
export type PerformanceData = { records: PerformanceRecord[]; today: string; source: string; synced_at: string }

const previewStorageKey = "training-agent:performance-preview:v1"

const runEfforts = [400, 804.672, 1000, 1609.344, 3218.688, 5000, 10000, 15000, 16093.44, 20000, 21097.5, 30000, 42195]
const bikeEfforts = [8046.72, 10000, 16093.44, 20000, 30000, 40000, 50000, 90000, 80467.2, 144840.96, 100000, 160934.4, 180000]
const swimEfforts = [91.44, 182.88, 365.76, 548.64, 731.52, 914.4, 1931.2128, 3862.4256]

function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function previewForToday(today: string): PerformanceData {
  const anchor = new Date(`${today}T12:00:00Z`)
  const records: PerformanceData["records"] = []
  const sampleWorkouts = [
    { sport: "Run", day: 1, distance: 5200, speed: 3.35, elevation: 45, title: "Easy run" },
    { sport: "Bike", day: 2, distance: 29000, speed: 7.1, elevation: 210, title: "Endurance ride" },
    { sport: "Run", day: 3, distance: 8100, speed: 3.25, elevation: 68, title: "Tempo run" },
    { sport: "Swim", day: 4, distance: 1600, speed: 1.02, elevation: 0, title: "Pool swim" },
    { sport: "Bike", day: 5, distance: 47000, speed: 7.7, elevation: 380, title: "Group ride" },
    { sport: "Run", day: 6, distance: 12500, speed: 3.05, elevation: 115, title: "Long run" },
  ]

  for (let week = 0; week < 104; week += 1) {
    for (const workout of sampleWorkouts) {
      const date = new Date(anchor)
      date.setUTCDate(date.getUTCDate() - week * 7 - workout.day)
      const dateKey = date.toISOString().slice(0, 10)
      if (dateKey > today) continue
      const longRide = workout.sport === "Bike" && week === 24
      const bigClimb = workout.sport === "Bike" && week === 13
      const distance = longRide ? 160934 : workout.distance
      const elevation = bigClimb ? 1850 : longRide ? 1240 : workout.elevation
      const effortDistances = workout.sport === "Run" ? runEfforts : workout.sport === "Bike" ? bikeEfforts : swimEfforts
      const effortSpeed = workout.sport === "Run" ? 4.1 : workout.sport === "Bike" ? 7.8 : 1.02
      const improvement = 1 + week * 0.00055
      records.push({
        id: `preview-${workout.sport.toLowerCase()}-${dateKey}`,
        date: dateKey,
        sport: workout.sport,
        name: longRide ? "Century ride" : bigClimb ? "Mountain climb" : workout.title,
        distance_meters: distance,
        duration_seconds: distance / workout.speed,
        elevation_meters: elevation,
        achievements: effortDistances.map(meters => ({
          type: "BEST_PACE",
          distance: meters,
          secs: Math.round(meters / effortSpeed * improvement),
        })),
      })
    }
  }

  return { records, today, source: "local-placeholder", synced_at: new Date().toISOString() }
}

/** Preview-only activity data persisted to this browser, never to the app API or Supabase. */
export function loadLocalPerformancePreview(): PerformanceData {
  const today = localDate(new Date())
  try {
    const saved = localStorage.getItem(previewStorageKey)
    if (saved) {
      const parsed = JSON.parse(saved) as PerformanceData
      if (parsed.source === "local-placeholder" && parsed.today === today && Array.isArray(parsed.records)) return parsed
    }
    const preview = previewForToday(today)
    localStorage.setItem(previewStorageKey, JSON.stringify(preview))
    return preview
  } catch {
    return previewForToday(today)
  }
}
