// Pure synthetic fixtures. This module has no backend, environment or network imports.
import { createDesktopPerformanceFixtures } from "./desktop-performance-fixtures.mjs";
export const dateKey = (date) => date.toISOString().slice(0, 10);
export const dateShift = (date, days) => {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return dateKey(value);
};
export const validDate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && dateKey(parsed) === value;
};

const sessions = [
  [
    0,
    "Run",
    "Easy aerobic run with relaxed strides",
    50,
    48,
    8500,
    43,
    "Keep the effort conversational. Finish with six relaxed strides.",
  ],
  [
    1,
    "Swim",
    "Technique and aerobic endurance — catch, rotation and breathing",
    60,
    58,
    2400,
    48,
    "Warm up, then alternate technique drills and smooth aerobic repeats.",
  ],
  [
    1,
    "Strength",
    "Strength and mobility: posterior chain, hips and trunk stability",
    35,
    32,
    0,
    22,
    "Three rounds of split squats, hinges and controlled core work.",
  ],
  [
    2,
    "Bike",
    "Threshold intervals — 3 × 12 minutes with steady recovery",
    90,
    87,
    43000,
    91,
    "Build power smoothly. Keep cadence comfortable and hold the final interval.",
  ],
  [
    3,
    "Run",
    "Recovery jog — recording with missing training load",
    35,
    34,
    5500,
    null,
    "Stay in zone 1–2 and finish feeling fresh.",
  ],
  [
    4,
    "Swim",
    "Race pace development — controlled 100s and long aerobic finish",
    65,
    63,
    2600,
    63,
    "Repeat 12 × 100 at race pace, then finish with 400 easy.",
  ],
  [
    4,
    "Run",
    "Easy mobility walk — explicitly zero training load",
    25,
    24,
    4800,
    0,
    "Practice the transition and settle into a smooth race rhythm.",
  ],
  [
    5,
    "Bike",
    "Long zone 2 endurance ride with fueling rehearsal and rolling hills",
    180,
    177,
    82000,
    136,
    "Take in 70–90g carbohydrate per hour and stay controlled on the hills.",
  ],
];

const structure = (sport, minutes, index) => {
  if (sport === "Strength") return null;
  const bike = sport === "Bike",
    swim = sport === "Swim";
  const target = (value) =>
    bike ? { power: { value, units: "watts" } } : { pace: { value, units: "pace_zone" } };
  if (index === 3)
    return JSON.stringify({
      steps: [
        { duration: 900, text: "Warm up", ...target(bike ? 140 : 2) },
        {
          reps: 3,
          steps: [
            { duration: 720, text: "Threshold effort", ...target(bike ? 238 : 4) },
            { duration: 300, text: "Steady recovery", ...target(bike ? 125 : 1) },
          ],
        },
        { duration: 1440, text: "Aerobic finish", ...target(bike ? 165 : 2) },
      ],
    });
  const duration = minutes * 60;
  return JSON.stringify({
    steps: [
      {
        duration: duration * 0.2,
        ...(swim ? { distance: Math.round(minutes * 8) } : {}),
        text: "Warm up",
        ...target(bike ? 130 : 1),
      },
      {
        duration: duration * 0.6,
        ...(swim ? { distance: Math.round(minutes * 25) } : {}),
        text: "Aerobic work",
        ...target(bike ? 175 : 2),
      },
      {
        duration: duration * 0.2,
        ...(swim ? { distance: Math.round(minutes * 8) } : {}),
        text: "Cool down",
        ...target(bike ? 115 : 1),
      },
    ],
  });
};

export function createDesktopPreviewFixtures(now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const anchor = new Date(`${today}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() - ((anchor.getUTCDay() + 6) % 7));
  const monday = dateKey(anchor),
    version = `local-preview-${today}`;
  const rows = (start, end) => {
    const result = [];
    const first = new Date(`${start}T12:00:00Z`);
    first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
    for (
      let cursor = new Date(first);
      dateKey(cursor) <= end && result.length < 1500;
      cursor.setUTCDate(cursor.getUTCDate() + 7)
    ) {
      for (let index = 0; index < sessions.length; index++) {
        const [offset, sport, title, planned, recorded, distance, tss, goal] = sessions[index];
        const date = dateShift(dateKey(cursor), offset);
        if (date < start || date > end) continue;
        const completed = date <= today,
          unknown = completed && tss === null,
          id = `preview-${date}-${index}`,
          bike = sport === "Bike";
        const prescribed = {
          duration_seconds: planned * 60,
          distance_meters: distance,
          tss,
          intensity_factor: tss === null ? null : bike ? 0.78 : 0.74,
          average_speed: distance ? distance / (planned * 60) : null,
        };
        const actual = completed
          ? {
              ...prescribed,
              duration_seconds: recorded * 60,
              elapsed_time_seconds: (recorded + 2) * 60,
              distance_meters: distance * 0.98,
              tss: tss === null ? null : Math.round(tss * 0.96),
              average_hr: 143,
              max_hr: 167,
              min_hr: 102,
              average_cadence: bike ? 86 : 168,
              min_cadence: bike ? 66 : 148,
              max_cadence: bike ? 103 : 181,
              calories: recorded * 9,
              average_power: bike ? 187 : null,
              normalized_power: bike ? 195 : null,
              max_power: bike ? 375 : null,
              elevation_gain: bike ? 410 : sport === "Swim" ? 0 : 42,
              temperature_c: 21,
              humidity_percent: 56,
            }
          : null;
        result.push({
          id: completed ? `activity:${id}` : `event:${id}`,
          activity_id: completed ? id : null,
          activity_revision: version,
          date,
          workout_date: date,
          day: new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", {
            weekday: "long",
            timeZone: "UTC",
          }),
          sport,
          title,
          duration: `${planned}m`,
          goal,
          details: `${goal}\n\nSynthetic local preview. No provider data or database is connected.`,
          structure: structure(sport, planned, index),
          status: completed ? "completed" : "upcoming",
          plannedDurationMinutes: planned,
          actualDurationMinutes: completed ? recorded : undefined,
          planned: unknown ? null : { duration_minutes: planned, tss },
          load: unknown ? 0 : tss,
          completed_data: completed
            ? { duration_minutes: recorded, tss: tss === null ? 0 : Math.round(tss * 0.96) }
            : undefined,
          workout_summary: { planned: unknown ? null : prescribed, completed: actual },
          scheduled_start_at: completed ? null : `${date}T06:30:00`,
          recorded_start_local: completed ? `${date}T06:30:00` : null,
          device_name: completed ? "Synthetic recording" : null,
        });
      }
    }
    return result;
  };
  const context = (start = dateShift(monday, -84), end = dateShift(monday, 84), scope = "full") => {
    const workouts = rows(start, end);
    return {
      athlete: {
        name: "Local preview athlete",
        time_zone: "America/Chicago",
        phase: "Build",
        zones: { bike_ftp: 250, run_threshold_pace: "7:15", swim_css: "1:45", threshold_hr: 167 },
      },
      metrics: { fitness: 64, fatigue: 70, form: -6 },
      wellness: { hrv: 58, resting_hr: 48, sleep: 28800 },
      wellness_history: Array.from({ length: 14 }, (_, index) => ({
        date: dateShift(today, index - 13),
        hrv: 52 + ((index * 7) % 15),
        restingHR: 46 + ((index * 3) % 7),
        sleepSecs: 28800,
        sleepScore: 86,
        sleepQuality: 4,
      })),
      planned: workouts,
      history: workouts.filter((row) => row.status === "completed"),
      source: "isolated-local-preview",
      context_scope: scope,
      retention_days: 90,
      display_range: { start, end },
      cached_ranges: [{ start, end }],
      version,
      cache_scope: "isolated-desktop-preview-v1",
      synced_at: now.toISOString(),
    };
  };
  const targets = { calories: 2400, protein: 160, carbs: 260, fat: 65, fiber: null };
  const entries = [
    {
      id: "breakfast",
      name: "Greek yogurt with berries and toasted oats",
      meal: "breakfast",
      quantity: 1,
      unit: "bowl",
      calories: 574,
      protein: 38,
      carbs: 66,
      fat: 18,
      fiber: 8,
      source: "manual",
      notes: "Synthetic breakfast",
      barcode: null,
      imageUrl: null,
    },
    {
      id: "lunch",
      name: "Grilled chicken, brown rice and avocado",
      meal: "lunch",
      quantity: 1,
      unit: "bowl",
      calories: 683,
      protein: 46,
      carbs: 63,
      fat: 23,
      fiber: 8,
      source: "manual",
      notes: "Synthetic lunch",
      barcode: null,
      imageUrl: null,
    },
  ];
  const nutrition = (date = today) => ({
    date,
    day: { revision: 1, entries },
    targets,
    targetsRevision: 1,
    aiAvailable: false,
    localPreview: true,
    week: Array.from({ length: 7 }, (_, index) => ({
      date: dateShift(date, index - 6),
      logged: true,
      targets,
      totals:
        index === 6
          ? { calories: 1257, protein: 84, carbs: 129, fat: 41, fiber: 16 }
          : {
              calories: 1980 + index * 73,
              protein: 125 + index * 5,
              carbs: 201 + index * 6,
              fat: 53 + index * 2,
              fiber: 22,
            },
    })),
  });
  const lookup = (id) => {
    const native = id.match(/^i9(\d{4})(\d{2})(\d{2})(\d)$/);
    const original = native ? `preview-${native[1]}-${native[2]}-${native[3]}-${native[4]}` : id;
    const match = original.match(/^preview-(\d{4}-\d{2}-\d{2})-(\d)$/);
    const workout =
      match && validDate(match[1])
        ? rows(match[1], match[1]).find(
            (row) => row.activity_id === original || row.id === `event:${original}`
          )
        : undefined;
    return native && workout ? { ...workout, id: `activity:${id}`, activity_id: id } : workout;
  };
  const analysis = (id) => {
    const workout = lookup(id);
    if (!workout?.workout_summary.completed) return null;
    const values = workout.workout_summary.completed,
      duration = values.duration_seconds,
      bike = workout.sport === "Bike",
      count = Math.min(1201, Math.ceil(duration / 10) + 1);
    return {
      version: 8,
      duration,
      points: Array.from({ length: count }, (_, index) => {
        const fraction = index / (count - 1);
        return {
          time: fraction * duration,
          distance: fraction * values.distance_meters,
          speed: Math.max(0.2, values.average_speed * (0.94 + 0.06 * Math.sin(index / 13))),
          heartRate: Math.round(137 + 12 * Math.sin(index / 17)),
          cadence: bike
            ? Math.round(84 + 6 * Math.sin(index / 9))
            : Math.round(165 + 5 * Math.sin(index / 9)),
          power: bike ? Math.round(184 + 37 * Math.sin(index / 19)) : null,
          elevation: workout.sport === "Swim" ? null : 180 + 24 * Math.sin(index / 31),
        };
      }),
      laps: [0, 1, 2, 3].map((index) => ({
        id: `lap-${index + 1}`,
        label: `Lap ${index + 1}`,
        kind: "lap",
        start: (duration * index) / 4,
        end: (duration * (index + 1)) / 4,
        distance: values.distance_meters / 4,
        heartRate: 143,
        speed: values.average_speed,
        power: bike ? 187 : null,
      })),
      intervals: [],
    };
  };
  const events = [
    {
      id: "preview-race",
      name: "Lakeside Olympic Triathlon",
      date: dateShift(monday, 47),
      sport: "Triathlon",
      distance: "Olympic",
      priority: "A",
      goal: "Controlled pacing and a strong finish",
      targetCtl: 72,
      source: "local-preview",
    },
  ];
  const weeks = Array.from({ length: 18 }, (_, index) => ({
    id: `preview-week-${index}`,
    startDate: dateShift(monday, (index - 8) * 7),
    endDate: dateShift(monday, (index - 8) * 7 + 6),
    phase: index < 8 ? "Base 2" : index < 14 ? "Build 1" : "Peak",
    phaseWeek: (index % 3) + 1,
    recovery: index % 4 === 3,
    targetHours: index % 4 === 3 ? 7.5 : 10,
    targetTss: index % 4 === 3 ? 330 : 440,
    weeksToEvent: 14 - index,
    countdownEventId: "preview-race",
    locked: false,
    manual: false,
    notes: "Synthetic training week: balance endurance, technique, and recovery.",
    focus: "Aerobic endurance and consistent fueling",
    limiters: "",
    restrictions: "",
    recoveryStatus: "",
    allocation: { swim: 2, bike: 4.5, run: 2.5, strength: 1 },
    projectedCtl: 60 + index,
    projectedAtl: 66 + index,
    projectedTsb: -6,
    rampRate: 1,
  }));
  const plan = {
    id: "preview-plan",
    name: "Local triathlon season",
    startDate: weeks[0].startDate,
    endDate: weeks.at(-1).endDate,
    mode: "manual",
    methodology: "hours",
    recoveryCycle: 4,
    baseline: 64,
    background: "Synthetic demonstration plan",
    currentFitness: "Consistent endurance training",
    availability: { swim: 3, bike: 4, run: 3, strength: 2 },
    events,
    weeks,
    conflicts: [],
    assumptions: ["All data is synthetic. Saving is disabled."],
    source: {
      source_id: "local-preview",
      passage_id: "synthetic",
      title: "Local preview",
      url: "#local-preview",
      claim: "Synthetic data",
      application: "Visual preview only",
    },
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    revision: 1,
    revisionHistory: [],
    isDraft: false,
  };
  const performance = createDesktopPerformanceFixtures({ today, now, context, dateShift });
  const performanceEffort = (id, type, duration, distance) => {
    const workout = lookup(id),
      recording = analysis(id);
    const available = false;
    const base = { available, activity_id: id, type, source: "synthetic-local-preview" };
    if (
      !recording ||
      !["Ride", "Run", "Swim"].includes(type) ||
      workout.sport !== (type === "Ride" ? "Bike" : type)
    )
      return { ...base, reason: "This synthetic recording is unavailable." };
    const history = performance.performanceHistory(type);
    const peak = [...history.weeks, ...history.months]
      .flatMap((period) => period.peaks)
      .find(
        (peak) =>
          peak.activity_id === id &&
          (type === "Ride"
            ? peak.duration_seconds === duration
            : Math.abs((peak.distance_meters ?? 0) - distance) <= (type === "Swim" ? 0.5 : 0.01))
      );
    if (!peak || peak.value == null)
      return { ...base, reason: "This synthetic effort is unavailable." };
    const elapsed = type === "Ride" ? duration : peak.elapsed_seconds;
    if (!(elapsed > 0) || elapsed > recording.duration)
      return { ...base, reason: "This synthetic effort is longer than its recording." };
    const start = Math.min(90, (recording.duration - elapsed) / 2),
      end = start + elapsed;
    return {
      ...base,
      available: true,
      value: peak.value,
      duration_seconds: type === "Ride" ? duration : null,
      distance_meters: peak.distance_meters,
      start_seconds: start,
      end_seconds: end,
      chart_start_seconds: start,
      chart_end_seconds: end,
    };
  };
  return {
    today,
    monday,
    version,
    context,
    ...performance,
    performanceEffort,
    nutrition,
    lookup,
    analysis,
    events,
    annualPlans: { plans: [plan], activeId: plan.id },
  };
}
